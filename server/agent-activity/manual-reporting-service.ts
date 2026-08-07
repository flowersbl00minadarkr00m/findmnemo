import { randomUUID } from 'node:crypto'
import {
  parseAssignmentEvent,
  parseAssignmentEventV1,
  parseAssignmentEventV2,
  type AgentFamily,
  type AgentKind,
  type AssignmentEvent,
  type AssignmentEventV2,
  type AssignmentEvidenceKind,
  type PreciseExecutionSurface,
} from '../../shared/agent-activity-contract.js'
import type { AgentActivityIngestReceipt, AgentActivityRepository } from './agent-activity-repository.js'
import type { AgentActivityService } from './agent-activity-service.js'
import { MANUAL_ACTIVITY_ADAPTER_VERSION, type ActivityCapabilityRegistry } from './capability-manifests.js'
import type { SnapshotMode, SnapshotService } from './snapshot-service.js'
import type { ReporterEventDraft } from './reporter/sanitizer.js'

export type ManualReportAction = 'start' | 'update' | 'wait' | 'block' | 'needs-action' | 'complete' | 'fail' | 'cancel' | 'snapshot'
type LegacyAssignmentEvent = Extract<AssignmentEvent, { schema: 'findmnemo.assignment-event.v1' }>

export interface ManualReportInput {
  integrationId: string
  agent: AgentKind
  agentFamily?: AgentFamily
  executionSurface?: PreciseExecutionSurface
  action: ManualReportAction
  assignmentId: string
  generation?: number
  summary: string
  projectRef: AssignmentEvent['assignment']['projectRef']
  targetRef?: AssignmentEvent['assignment']['targetRef']
  modelLabel?: string | null
  evidenceKind: Extract<AssignmentEvidenceKind, 'mcp-tool' | 'manual-command'>
  snapshot?: { requestId: string; mode: SnapshotMode; coverageStartedAt: string }
}

export type ManualReportReceipt = AgentActivityIngestReceipt & {
  supportLevel: 'manual'
  evidenceKind: 'mcp-tool' | 'manual-command'
  agentFamily?: AgentFamily
  executionSurface?: PreciseExecutionSurface
  modelLabel?: string | null
  snapshot?: ReturnType<SnapshotService['get']>
}

interface ManualReportingDependencies {
  repository: AgentActivityRepository
  activities: AgentActivityService
  capabilities: ActivityCapabilityRegistry
  snapshots?: SnapshotService
  clock?: () => Date
  eventId?: () => string
}

export class ManualReportingService {
  private readonly dependencies: ManualReportingDependencies
  private readonly clock: () => Date
  private readonly eventId: () => string

  constructor(dependencies: ManualReportingDependencies) {
    this.dependencies = dependencies
    this.clock = dependencies.clock ?? (() => new Date())
    this.eventId = dependencies.eventId ?? randomUUID
  }

  report(value: unknown): ManualReportReceipt {
    const input = parseInput(value)
    let snapshot = input.snapshot
    if (input.action === 'snapshot' && !snapshot) {
      if (!this.dependencies.snapshots) throw new Error('SNAPSHOT_SERVICE_UNAVAILABLE')
      const requested = this.dependencies.snapshots.request({ integrationId: input.integrationId, mode: 'explicit-report' })
      snapshot = { requestId: requested.requestId, mode: requested.mode, coverageStartedAt: this.clock().toISOString() }
    }
    const template = eventFor(input, snapshot, this.eventId(), this.clock().toISOString(), 1)
    const candidate = eventFor(input, snapshot, template.eventId, template.observation.observedAt, this.dependencies.repository.expectedSequenceFor(template))
    const parsed = parseAssignmentEvent(candidate)
    this.dependencies.capabilities.validate(capabilityEventFor(input, snapshot, template.eventId, template.observation.observedAt, candidate.observation.sequence))
    const receipt = this.dependencies.activities.ingestValidated(parsed.event, parsed.receiptCodes)
    const snapshotReceipt = parsed.event.snapshot
      ? this.dependencies.snapshots?.recordEvent({ integrationId: parsed.event.integrationId, ...parsed.event.snapshot }, receipt.outcome, receipt.reasonCode)
      : undefined
    return {
      ...receipt,
      supportLevel: 'manual',
      evidenceKind: input.evidenceKind,
      ...(input.agentFamily && input.executionSurface
        ? { agentFamily: input.agentFamily, executionSurface: input.executionSurface, modelLabel: parsed.event.modelLabel }
        : {}),
      ...(snapshotReceipt ? { snapshot: snapshotReceipt } : {}),
    }
  }
}

export function manualReportEvent(
  input: ManualReportInput,
  eventId: string,
  observedAt: string,
  sequence: number,
  snapshot = input.snapshot,
): { event: AssignmentEvent; receiptCodes: ReturnType<typeof parseAssignmentEvent>['receiptCodes'] } {
  const candidate = eventFor(input, snapshot, eventId, observedAt, sequence)
  return candidate.schema === 'findmnemo.assignment-event.v2'
    ? parseAssignmentEventV2(candidate)
    : parseAssignmentEventV1(candidate)
}

function eventFor(input: ManualReportInput, snapshot: ManualReportInput['snapshot'], eventId: string, observedAt: string, sequence: number): AssignmentEvent {
  if (input.agentFamily && input.executionSurface) return preciseEventFor(input, snapshot, eventId, observedAt, sequence)
  return capabilityEventFor(input, snapshot, eventId, observedAt, sequence)
}

function capabilityEventFor(input: ManualReportInput, snapshot: ManualReportInput['snapshot'], eventId: string, observedAt: string, sequence: number): LegacyAssignmentEvent {
  const mapped = actionMapping(input.action)
  return {
    schema: 'findmnemo.assignment-event.v1', eventId, integrationId: input.integrationId, agent: input.agent,
    adapterVersion: MANUAL_ACTIVITY_ADAPTER_VERSION, agentVersion: null,
    assignment: {
      originAssignmentId: input.assignmentId, generation: input.generation ?? 1,
      summary: { text: input.summary, source: input.evidenceKind === 'mcp-tool' ? 'explicit-agent-tool' : 'explicit-user' },
      projectRef: input.projectRef, ...(input.targetRef ? { targetRef: input.targetRef } : {}),
    },
    observation: {
      sequence, kind: mapped.kind, ...(mapped.reportedState ? { reportedState: mapped.reportedState } : {}), observedAt,
      ...(mapped.reasonCode ? { reasonCode: mapped.reasonCode } : {}), evidenceKind: input.action === 'snapshot' ? 'snapshot' : input.evidenceKind,
      ...(mapped.terminalOutcome ? { terminalEvidence: { kind: input.evidenceKind === 'manual-command' ? 'user-confirmed' : 'agent-explicit', outcome: mapped.terminalOutcome } } : {}),
    },
    ...(input.modelLabel === undefined ? {} : { modelLabel: input.modelLabel }),
    ...(snapshot ? { snapshot } : {}),
  }
}

function preciseEventFor(input: ManualReportInput, snapshot: ManualReportInput['snapshot'], eventId: string, observedAt: string, sequence: number): AssignmentEventV2 {
  if (!input.agentFamily || !input.executionSurface) throw new Error('MANUAL_REPORT_INVALID')
  const legacy = capabilityEventFor(input, snapshot, eventId, observedAt, sequence)
  return {
    schema: 'findmnemo.assignment-event.v2',
    eventId,
    integrationId: input.integrationId,
    agentFamily: input.agentFamily,
    executionSurface: input.executionSurface,
    adapterVersion: MANUAL_ACTIVITY_ADAPTER_VERSION,
    agentVersion: null,
    assignment: legacy.assignment,
    observation: legacy.observation,
    ...(input.modelLabel === undefined
      ? {}
      : { model: input.modelLabel === null ? null : { label: input.modelLabel, source: 'host-reported', confidence: 'reported' } }),
    ...(snapshot ? { snapshot } : {}),
  }
}

export function manualReportDraft(input: ManualReportInput, eventId: string, observedAt: string, snapshot = input.snapshot): ReporterEventDraft {
  const mapped = actionMapping(input.action)
  return {
    eventId, integrationId: input.integrationId, agent: input.agent, adapterVersion: MANUAL_ACTIVITY_ADAPTER_VERSION, agentVersion: null,
    originAssignmentId: input.assignmentId, generation: input.generation ?? 1,
    summary: { text: input.summary, source: input.evidenceKind === 'mcp-tool' ? 'explicit-agent-tool' : 'explicit-user' },
    projectRef: input.projectRef, ...(input.targetRef ? { targetRef: input.targetRef } : {}),
    kind: mapped.kind, ...(mapped.reportedState ? { reportedState: mapped.reportedState } : {}), observedAt,
    ...(mapped.reasonCode ? { reasonCode: mapped.reasonCode } : {}), evidenceKind: input.action === 'snapshot' ? 'snapshot' : input.evidenceKind,
    ...(mapped.terminalOutcome ? { terminalEvidence: { kind: input.evidenceKind === 'manual-command' ? 'user-confirmed' : 'agent-explicit', outcome: mapped.terminalOutcome } } : {}),
    ...(input.modelLabel === undefined ? {} : { modelLabel: input.modelLabel }), ...(snapshot ? { snapshot } : {}),
  }
}

function actionMapping(action: ManualReportAction): Pick<AssignmentEvent['observation'], 'kind' | 'reportedState' | 'reasonCode'> & { terminalOutcome?: 'completed' | 'failed' | 'cancelled' } {
  if (action === 'start') return { kind: 'started', reportedState: 'active' }
  if (action === 'update') return { kind: 'heartbeat', reportedState: 'active' }
  if (action === 'wait') return { kind: 'waiting', reportedState: 'waiting', reasonCode: 'explicit-wait' }
  if (action === 'block') return { kind: 'blocked', reportedState: 'blocked', reasonCode: 'explicit-block' }
  if (action === 'needs-action') return { kind: 'needs-action', reportedState: 'needs-action', reasonCode: 'input-required' }
  if (action === 'complete') return { kind: 'completed', terminalOutcome: 'completed' }
  if (action === 'fail') return { kind: 'failed', terminalOutcome: 'failed' }
  if (action === 'cancel') return { kind: 'cancelled', terminalOutcome: 'cancelled' }
  return { kind: 'snapshot', reportedState: 'active' }
}

const INPUT_KEYS = new Set(['integrationId', 'agent', 'agentFamily', 'executionSurface', 'action', 'assignmentId', 'generation', 'summary', 'projectRef', 'targetRef', 'modelLabel', 'evidenceKind', 'snapshot'])
const ACTIONS = new Set<ManualReportAction>(['start', 'update', 'wait', 'block', 'needs-action', 'complete', 'fail', 'cancel', 'snapshot'])

function parseInput(value: unknown): ManualReportInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MANUAL_REPORT_INVALID')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key))) throw new Error('MANUAL_REPORT_INVALID')
  if (typeof input.integrationId !== 'string' || typeof input.agent !== 'string' || typeof input.action !== 'string' || !ACTIONS.has(input.action as ManualReportAction) || typeof input.assignmentId !== 'string' || typeof input.summary !== 'string') throw new Error('MANUAL_REPORT_INVALID')
  const hasFamily = input.agentFamily !== undefined
  const hasSurface = input.executionSurface !== undefined
  if (hasFamily !== hasSurface) throw new Error('MANUAL_REPORT_INVALID')
  if (hasFamily && (
    typeof input.agentFamily !== 'string' ||
    typeof input.executionSurface !== 'string' ||
    input.agent !== legacyAgentForFamily(input.agentFamily as AgentFamily)
  )) throw new Error('MANUAL_REPORT_INVALID')
  if (input.evidenceKind !== 'mcp-tool' && input.evidenceKind !== 'manual-command') throw new Error('MANUAL_REPORT_INVALID')
  if (!input.projectRef || typeof input.projectRef !== 'object' || Array.isArray(input.projectRef)) throw new Error('MANUAL_REPORT_INVALID')
  if ((input.action === 'snapshot') !== Boolean(input.snapshot)) {
    if (input.action !== 'snapshot' || input.snapshot !== undefined) throw new Error('MANUAL_REPORT_INVALID')
  }
  return input as unknown as ManualReportInput
}

function legacyAgentForFamily(family: AgentFamily): AgentKind {
  return family === 'claude' ? 'claude-code' : family === 'pi' ? 'pi' : 'codex-cli'
}
