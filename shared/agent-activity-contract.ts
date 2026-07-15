export const ASSIGNMENT_EVENT_SCHEMA_V1 = 'findmnemo.assignment-event.v1' as const
export const ASSIGNMENT_EVENT_MAX_BYTES = 16 * 1024

export const AGENT_KINDS = ['codex-cli', 'claude-code', 'pi'] as const
export const ASSIGNMENT_EVENT_KINDS = [
  'accepted', 'started', 'heartbeat', 'waiting', 'blocked', 'needs-action',
  'resumed', 'completed', 'failed', 'cancelled', 'snapshot',
] as const
export const ASSIGNMENT_REPORTED_STATES = ['active', 'waiting', 'blocked', 'needs-action'] as const
export const ASSIGNMENT_EVIDENCE_KINDS = [
  'codex-hook', 'claude-hook', 'claude-task-hook', 'pi-extension',
  'mcp-tool', 'manual-command', 'snapshot',
] as const
export const TERMINAL_EVIDENCE_KINDS = ['claude-task-completed', 'agent-explicit', 'user-confirmed'] as const
export const TERMINAL_OUTCOMES = ['completed', 'failed', 'cancelled'] as const
export const SUMMARY_SOURCES = ['explicit-user', 'explicit-agent-tool', 'claude-task-subject', 'placeholder'] as const

export type AgentKind = (typeof AGENT_KINDS)[number]
export type AssignmentEventKind = (typeof ASSIGNMENT_EVENT_KINDS)[number]
export type AssignmentReportedState = (typeof ASSIGNMENT_REPORTED_STATES)[number]
export type AssignmentEvidenceKind = (typeof ASSIGNMENT_EVIDENCE_KINDS)[number]
export type TerminalEvidenceKind = (typeof TERMINAL_EVIDENCE_KINDS)[number]
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number]
export type SummarySource = (typeof SUMMARY_SOURCES)[number]

export interface AssignmentEventV1 {
  schema: typeof ASSIGNMENT_EVENT_SCHEMA_V1
  eventId: string
  integrationId: string
  agent: AgentKind
  adapterVersion: string
  agentVersion: string | null
  assignment: {
    originAssignmentId: string
    generation: number
    summary: { text: string; source: SummarySource }
    projectRef:
      | { kind: 'approved-project'; id: string }
      | { kind: 'unassigned' }
      | { kind: 'needs-review'; reviewToken: string }
    targetRef?:
      | { kind: 'ticket'; ticketId: string }
      | { kind: 'sdd-task'; projectId: string; specId: string; taskId: string }
  }
  observation: {
    sequence: number
    kind: AssignmentEventKind
    reportedState?: AssignmentReportedState
    observedAt: string
    reasonCode?: 'permission' | 'input-required' | 'agent-api-error' | 'explicit-wait' | 'explicit-block' | 'reporter-recovery'
    evidenceKind: AssignmentEvidenceKind
    originEvidenceId?: string
    terminalEvidence?: { kind: TerminalEvidenceKind; outcome: TerminalOutcome }
  }
  modelLabel?: string | null
  snapshot?: {
    requestId: string
    mode: 'current-session' | 'next-interaction' | 'explicit-report'
    coverageStartedAt: string
  }
}

export type AssignmentEventReceiptCode = 'SUMMARY_MINIMIZED'

export class AssignmentEventValidationError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AssignmentEventValidationError'
    this.code = code
  }
}

const ROOT_KEYS = ['schema', 'eventId', 'integrationId', 'agent', 'adapterVersion', 'agentVersion', 'assignment', 'observation', 'modelLabel', 'snapshot'] as const
const ASSIGNMENT_KEYS = ['originAssignmentId', 'generation', 'summary', 'projectRef', 'targetRef'] as const
const SUMMARY_KEYS = ['text', 'source'] as const
const OBSERVATION_KEYS = ['sequence', 'kind', 'reportedState', 'observedAt', 'reasonCode', 'evidenceKind', 'originEvidenceId', 'terminalEvidence'] as const
const TERMINAL_KEYS = ['kind', 'outcome'] as const
const SNAPSHOT_KEYS = ['requestId', 'mode', 'coverageStartedAt'] as const
const PROHIBITED_KEY = /(prompt|response|message|transcript|reasoning|thought|credential|authorization|cookie|environment|command.?history|raw|log|body|content|diff|file.?data|(?:access|refresh|auth|secret)?token)/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const SECRET_LIKE = /(?:bearer\s+[a-z0-9._~+/-]{12,}|(?:password|passwd|secret|api[_ -]?key)\s*[:=]|\bsk-[a-z0-9_-]{12,})/i

type JsonObject = Record<string, unknown>

export function parseAssignmentEventV1(input: unknown): { event: AssignmentEventV1; receiptCodes: AssignmentEventReceiptCode[] } {
  assertBoundedShape(input)
  const root = exactObject(input, ROOT_KEYS, '$')
  if (root.schema !== ASSIGNMENT_EVENT_SCHEMA_V1) fail('UNSUPPORTED_SCHEMA')

  const assignment = exactObject(root.assignment, ASSIGNMENT_KEYS, '$.assignment')
  const summary = exactObject(assignment.summary, SUMMARY_KEYS, '$.assignment.summary')
  const projectRef = parseProjectRef(assignment.projectRef)
  const targetRef = assignment.targetRef === undefined ? undefined : parseTargetRef(assignment.targetRef)
  const observation = exactObject(root.observation, OBSERVATION_KEYS, '$.observation')
  const terminalEvidence = observation.terminalEvidence === undefined
    ? undefined
    : parseTerminalEvidence(observation.terminalEvidence)

  const agent = enumValue(root.agent, AGENT_KINDS, 'INVALID_AGENT')
  const summaryText = boundedString(summary.text, 160, 'INVALID_SUMMARY')
  if (summaryText.trim().length === 0) fail('INVALID_SUMMARY')
  const summarySource = enumValue(summary.source, SUMMARY_SOURCES, 'INVALID_SUMMARY_SOURCE')
  const minimized = shouldMinimizeSummary(summaryText)
  const kind = enumValue(observation.kind, ASSIGNMENT_EVENT_KINDS, 'INVALID_EVENT_KIND')
  assertTerminalEvidence(kind, terminalEvidence)

  const snapshot = root.snapshot === undefined ? undefined : parseSnapshot(root.snapshot)
  if ((kind === 'snapshot') !== Boolean(snapshot)) fail('INVALID_SNAPSHOT')

  const event: AssignmentEventV1 = {
    schema: ASSIGNMENT_EVENT_SCHEMA_V1,
    eventId: uuidString(root.eventId, 64, 'INVALID_EVENT_ID'),
    integrationId: opaqueReference(root.integrationId, 64, 'INVALID_INTEGRATION_ID'),
    agent,
    adapterVersion: opaqueString(root.adapterVersion, 32, 'INVALID_ADAPTER_VERSION'),
    agentVersion: nullableBoundedString(root.agentVersion, 48, 'INVALID_AGENT_VERSION'),
    assignment: {
      originAssignmentId: opaqueString(assignment.originAssignmentId, 160, 'INVALID_ASSIGNMENT_ID'),
      generation: positiveInteger(assignment.generation, 'INVALID_GENERATION'),
      summary: minimized
        ? { text: placeholderSummary(agent), source: 'placeholder' }
        : { text: summaryText.trim(), source: summarySource },
      projectRef,
      ...(targetRef ? { targetRef } : {}),
    },
    observation: {
      sequence: positiveInteger(observation.sequence, 'INVALID_SEQUENCE'),
      kind,
      ...(observation.reportedState === undefined ? {} : { reportedState: enumValue(observation.reportedState, ASSIGNMENT_REPORTED_STATES, 'INVALID_REPORTED_STATE') }),
      observedAt: timestamp(observation.observedAt, 'INVALID_OBSERVED_AT'),
      ...(observation.reasonCode === undefined ? {} : { reasonCode: enumValue(observation.reasonCode, ['permission', 'input-required', 'agent-api-error', 'explicit-wait', 'explicit-block', 'reporter-recovery'] as const, 'INVALID_REASON_CODE') }),
      evidenceKind: enumValue(observation.evidenceKind, ASSIGNMENT_EVIDENCE_KINDS, 'INVALID_EVIDENCE_KIND'),
      ...(observation.originEvidenceId === undefined ? {} : { originEvidenceId: opaqueString(observation.originEvidenceId, 160, 'INVALID_EVIDENCE_ID') }),
      ...(terminalEvidence ? { terminalEvidence } : {}),
    },
    ...(root.modelLabel === undefined ? {} : { modelLabel: nullableSafeLabel(root.modelLabel, 80, 'INVALID_MODEL_LABEL') }),
    ...(snapshot ? { snapshot } : {}),
  }
  return { event, receiptCodes: minimized ? ['SUMMARY_MINIMIZED'] : [] }
}

function assertBoundedShape(input: unknown): void {
  let serialized: string
  try { serialized = JSON.stringify(input) } catch { fail('INVALID_JSON_VALUE') }
  if (typeof serialized! !== 'string') fail('INVALID_JSON_VALUE')
  if (new TextEncoder().encode(serialized).byteLength > ASSIGNMENT_EVENT_MAX_BYTES) fail('EVENT_TOO_LARGE')
  walk(input, 1)
}

function walk(value: unknown, depth: number): void {
  if (depth > 6) fail('EVENT_TOO_DEEP')
  if (Array.isArray(value)) fail('ARRAY_NOT_ALLOWED')
  if (value === null || typeof value !== 'object') return
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail('INVALID_OBJECT')
  for (const child of Object.values(value as JsonObject)) walk(child, depth + 1)
}

function exactObject(value: unknown, keys: readonly string[], path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_OBJECT')
  const object = value as JsonObject
  for (const key of Object.keys(object)) {
    if (!keys.includes(key)) fail(PROHIBITED_KEY.test(key) ? 'PRIVATE_KEY_NOT_ALLOWED' : `UNKNOWN_KEY:${path}.${key}`)
  }
  return object
}

function parseProjectRef(value: unknown): AssignmentEventV1['assignment']['projectRef'] {
  const base = exactObject(value, ['kind', 'id', 'reviewToken'], '$.assignment.projectRef')
  if (base.kind === 'approved-project') {
    exactKeysForVariant(base, ['kind', 'id'], '$.assignment.projectRef')
    return { kind: 'approved-project', id: opaqueReference(base.id, 128, 'INVALID_PROJECT_ID') }
  }
  if (base.kind === 'unassigned') {
    exactKeysForVariant(base, ['kind'], '$.assignment.projectRef')
    return { kind: 'unassigned' }
  }
  if (base.kind === 'needs-review') {
    exactKeysForVariant(base, ['kind', 'reviewToken'], '$.assignment.projectRef')
    return { kind: 'needs-review', reviewToken: opaqueReference(base.reviewToken, 128, 'INVALID_REVIEW_TOKEN') }
  }
  fail('INVALID_PROJECT_REF')
}

function parseTargetRef(value: unknown): NonNullable<AssignmentEventV1['assignment']['targetRef']> {
  const base = exactObject(value, ['kind', 'ticketId', 'projectId', 'specId', 'taskId'], '$.assignment.targetRef')
  if (base.kind === 'ticket') {
    exactKeysForVariant(base, ['kind', 'ticketId'], '$.assignment.targetRef')
    return { kind: 'ticket', ticketId: opaqueReference(base.ticketId, 128, 'INVALID_TICKET_ID') }
  }
  if (base.kind === 'sdd-task') {
    exactKeysForVariant(base, ['kind', 'projectId', 'specId', 'taskId'], '$.assignment.targetRef')
    return {
      kind: 'sdd-task',
      projectId: opaqueReference(base.projectId, 128, 'INVALID_PROJECT_ID'),
      specId: opaqueReference(base.specId, 128, 'INVALID_SPEC_ID'),
      taskId: opaqueReference(base.taskId, 64, 'INVALID_TASK_ID'),
    }
  }
  fail('INVALID_TARGET_REF')
}

function parseTerminalEvidence(value: unknown): NonNullable<AssignmentEventV1['observation']['terminalEvidence']> {
  const object = exactObject(value, TERMINAL_KEYS, '$.observation.terminalEvidence')
  return {
    kind: enumValue(object.kind, TERMINAL_EVIDENCE_KINDS, 'INVALID_TERMINAL_EVIDENCE'),
    outcome: enumValue(object.outcome, TERMINAL_OUTCOMES, 'INVALID_TERMINAL_OUTCOME'),
  }
}

function parseSnapshot(value: unknown): NonNullable<AssignmentEventV1['snapshot']> {
  const object = exactObject(value, SNAPSHOT_KEYS, '$.snapshot')
  return {
    requestId: opaqueReference(object.requestId, 64, 'INVALID_SNAPSHOT_REQUEST'),
    mode: enumValue(object.mode, ['current-session', 'next-interaction', 'explicit-report'] as const, 'INVALID_SNAPSHOT_MODE'),
    coverageStartedAt: timestamp(object.coverageStartedAt, 'INVALID_SNAPSHOT_TIME'),
  }
}

function assertTerminalEvidence(kind: AssignmentEventKind, evidence: AssignmentEventV1['observation']['terminalEvidence']): void {
  const terminal = TERMINAL_OUTCOMES.includes(kind as TerminalOutcome)
  if (!terminal && evidence) fail('UNEXPECTED_TERMINAL_EVIDENCE')
  if (terminal && (!evidence || evidence.outcome !== kind)) fail('TERMINAL_EVIDENCE_REQUIRED')
}

function exactKeysForVariant(object: JsonObject, keys: readonly string[], path: string): void {
  for (const key of Object.keys(object)) if (!keys.includes(key)) fail(`UNKNOWN_KEY:${path}.${key}`)
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, code: string): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) fail(code)
  return value as T[number]
}

function boundedString(value: unknown, maximum: number, code: string): string {
  if (typeof value !== 'string' || value.length === 0 || [...value].length > maximum) fail(code)
  return value
}

function opaqueString(value: unknown, maximum: number, code: string): string {
  const text = boundedString(value, maximum, code)
  if (hasControlCharacter(text)) fail(code)
  return text
}

function uuidString(value: unknown, maximum: number, code: string): string {
  const text = opaqueString(value, maximum, code)
  if (!UUID.test(text)) fail(code)
  return text
}

function opaqueReference(value: unknown, maximum: number, code: string): string {
  const text = opaqueString(value, maximum, code)
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(text)) fail(code)
  return text
}

function nullableBoundedString(value: unknown, maximum: number, code: string): string | null {
  return value === null ? null : opaqueString(value, maximum, code)
}

function nullableSafeLabel(value: unknown, maximum: number, code: string): string | null {
  if (value === null) return null
  const text = opaqueString(value, maximum, code)
  if (SECRET_LIKE.test(text)) fail(code)
  return text
}

function positiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(code)
  return Number(value)
}

function timestamp(value: unknown, code: string): string {
  const text = opaqueString(value, 40, code)
  if (!RFC3339_UTC.test(text) || Number.isNaN(Date.parse(text))) fail(code)
  return text
}

function shouldMinimizeSummary(value: string): boolean {
  return hasControlCharacter(value) || SECRET_LIKE.test(value)
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || codePoint === 127
  })
}

function placeholderSummary(agent: AgentKind): string {
  return `${{ 'codex-cli': 'Codex', 'claude-code': 'Claude Code', pi: 'Pi' }[agent]} work — name this assignment`
}

function fail(code: string): never { throw new AssignmentEventValidationError(code) }
