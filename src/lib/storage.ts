import type {
  AgentActivity,
  Artifact,
  ChecklistItem,
  DecisionLogEntry,
  EmailThread,
  ExecutionEvidence,
  ExpandContractPhase,
  FogMap,
  FogMapItem,
  GeneratedTicketKind,
  LLMSource,
  ReviewAxis,
  ReviewAxisRecord,
  ReviewFinding,
  SddGate,
  SmellTag,
  TelemetryActivityType,
  Ticket,
  TicketOrigin,
  VerificationCheck,
  WorkNote,
  WorkTelemetryEvent,
} from '../types'
import { DEMO_TICKETS, DEMO_ACTIVITIES, DEMO_EMAILS } from './demo-data'
import { recordTelemetry } from './telemetry'

const TICKETS_KEY = 'mnemosync_tickets'
const ACTIVITY_KEY = 'mnemosync_agent_activity'
const EMAILS_KEY = 'mnemosync_emails'
const SEEDED_KEY = 'mnemosync_seeded_v2' // bump suffix to re-seed richer demo data

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function now(): string {
  return new Date().toISOString()
}

// Ticket storage

export function sanitizeTicket(raw: Record<string, unknown>): Ticket {
  return {
    id: String(raw.id ?? generateId()),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    source: validateSource(raw.source),
    status: validateStatus(raw.status),
    origin: validateOrigin(raw.origin) ?? defaultOrigin(raw),
    ...(validateGeneratedKind(raw.generatedKind) ? { generatedKind: validateGeneratedKind(raw.generatedKind) } : {}),
    ...(typeof raw.projectProgressId === 'string' ? { projectProgressId: raw.projectProgressId } : {}),
    ...(typeof raw.sddSpecId === 'string' ? { sddSpecId: raw.sddSpecId } : {}),
    ...(validateSddGate(raw.sddGate) ? { sddGate: validateSddGate(raw.sddGate) } : {}),
    blockedBy: sanitizeStringArray(raw.blockedBy),
    ...(typeof raw.delivers === 'string' ? { delivers: raw.delivers } : {}),
    acceptanceCriteria: sanitizeChecklistItems(raw.acceptanceCriteria),
    verificationChecks: sanitizeVerificationChecks(raw.verificationChecks),
    ...(sanitizeFogMap(raw.fogMap) ? { fogMap: sanitizeFogMap(raw.fogMap) } : {}),
    ...(sanitizeExpandContractPlan(raw.expandContractPlan) ? { expandContractPlan: sanitizeExpandContractPlan(raw.expandContractPlan) } : {}),
    ...(sanitizeExecutionEvidence(raw.executionEvidence) ? { executionEvidence: sanitizeExecutionEvidence(raw.executionEvidence) } : {}),
    ...(sanitizeReview(raw.review) ? { review: sanitizeReview(raw.review) } : {}),
    ...(typeof raw.receiptRequired === 'boolean' ? { receiptRequired: raw.receiptRequired } : {}),
    receiptIds: sanitizeStringArray(raw.receiptIds),
    workNotes: sanitizeWorkNotes(raw.workNotes),
    artifacts: sanitizeArtifacts(raw.artifacts),
    decisionLog: sanitizeDecisionLog(raw.decisionLog),
    createdAt: String(raw.createdAt ?? now()),
    updatedAt: String(raw.updatedAt ?? now()),
  }
}

function validateSource(s: unknown): Ticket['source'] {
  if (s === 'Pi' || s === 'Codex' || s === 'Claude Cowork') return s
  return 'Pi'
}

function validateStatus(s: unknown): Ticket['status'] {
  if (s === 'todo' || s === 'in-progress' || s === 'done' || s === 'blocked') return s
  return 'todo'
}

function validateOrigin(value: unknown): TicketOrigin | undefined {
  if (
    value === 'demo' ||
    value === 'browser-ui' ||
    value === 'agent-runtime' ||
    value === 'imported' ||
    value === 'local-bridge' ||
    value === 'registry-sync'
  ) return value
  return undefined
}

function defaultOrigin(raw: Record<string, unknown>): TicketOrigin {
  return isDemoSeedTicket(raw) ? 'demo' : 'browser-ui'
}

function isDemoSeedTicket(raw: Record<string, unknown>): boolean {
  return typeof raw.id === 'string' && /^t(?:[1-9]|1[0-2])$/.test(raw.id)
}

function validateGeneratedKind(value: unknown): GeneratedTicketKind | undefined {
  if (value === 'sdd-gate-placeholder' || value === 'sdd-task-execution' || value === 'manual') return value
  return undefined
}

function validateSddGate(value: unknown): SddGate | undefined {
  if (
    value === 'uninitialized' ||
    value === 'requirements:draft' ||
    value === 'requirements:approved' ||
    value === 'design:draft' ||
    value === 'design:approved' ||
    value === 'tasks:draft' ||
    value === 'tasks:approved' ||
    value === 'implementation:in-progress' ||
    value === 'implementation:done' ||
    value === 'review:done' ||
    value === 'invalid-status' ||
    value === 'stale-path'
  ) return value
  return undefined
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function sanitizeWorkNotes(raw: unknown): WorkNote[] {
  if (!Array.isArray(raw)) return []
  return raw.map((n: unknown) => {
    if (typeof n === 'object' && n !== null) {
      const obj = n as Record<string, unknown>
      return {
        id: String(obj.id ?? generateId()),
        text: String(obj.text ?? ''),
        createdAt: String(obj.createdAt ?? now()),
        ...(validateKnowledgeKind(obj.kind) ? { kind: validateKnowledgeKind(obj.kind) } : {}),
        evidenceRefs: sanitizeStringArray(obj.evidenceRefs),
      }
    }
    return { id: generateId(), text: String(n), createdAt: now() }
  })
}

function sanitizeArtifacts(raw: unknown): Artifact[] {
  if (!Array.isArray(raw)) return []
  return raw.map((a: unknown) => {
    const obj = (a as Record<string, unknown>) ?? {}
    return {
      id: String(obj.id ?? generateId()),
      type: validateArtifactType(obj.type),
      label: String(obj.label ?? ''),
      url: obj.url ? String(obj.url) : undefined,
      createdAt: String(obj.createdAt ?? now()),
      ...(obj.status === 'available' || obj.status === 'missing' || obj.status === 'unavailable' ? { status: obj.status } : {}),
    }
  })
}

function validateArtifactType(value: unknown): Artifact['type'] {
  if (
    value === 'commit' ||
    value === 'pr' ||
    value === 'file' ||
    value === 'url' ||
    value === 'research-note' ||
    value === 'prototype' ||
    value === 'spike' ||
    value === 'source' ||
    value === 'verification-evidence'
  ) return value
  return 'url'
}

function sanitizeDecisionLog(raw: unknown): DecisionLogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map((d: unknown) => {
    const obj = (d as Record<string, unknown>) ?? {}
    return {
      id: String(obj.id ?? generateId()),
      timestamp: String(obj.timestamp ?? now()),
      decision: String(obj.decision ?? ''),
      reasoning: String(obj.reasoning ?? ''),
      gateType: obj.gateType === 'one-way' ? 'one-way' : 'two-way',
      reversibility: (obj.reversibility === 'high' || obj.reversibility === 'medium' || obj.reversibility === 'low') ? obj.reversibility : 'medium',
      ...(validateKnowledgeKind(obj.kind) ? { kind: validateKnowledgeKind(obj.kind) } : {}),
      evidenceRefs: sanitizeStringArray(obj.evidenceRefs),
    }
  })
}

function validateKnowledgeKind(value: unknown): WorkNote['kind'] | undefined {
  if (value === 'fact' || value === 'assumption' || value === 'decision' || value === 'preference' || value === 'open-question') return value
  return undefined
}

function sanitizeChecklistItems(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item: unknown) => {
    const obj = (item as Record<string, unknown>) ?? {}
    return {
      id: String(obj.id ?? generateId()),
      text: String(obj.text ?? ''),
      checked: Boolean(obj.checked),
    }
  })
}

function sanitizeVerificationChecks(raw: unknown): VerificationCheck[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeVerificationCheck)
}

function sanitizeVerificationCheck(raw: unknown): VerificationCheck {
  const obj = (raw as Record<string, unknown>) ?? {}
  return {
    id: String(obj.id ?? generateId()),
    commandOrCheck: String(obj.commandOrCheck ?? obj.command ?? ''),
    ...(typeof obj.expected === 'string' ? { expected: obj.expected } : {}),
    ...(obj.result === 'passed' || obj.result === 'failed' || obj.result === 'not-run' ? { result: obj.result } : {}),
    ...(typeof obj.evidenceRef === 'string' ? { evidenceRef: obj.evidenceRef } : {}),
  }
}

function sanitizeFogMap(raw: unknown): FogMap | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  return {
    destination: String(obj.destination ?? ''),
    decisionsSoFar: sanitizeStringArray(obj.decisionsSoFar),
    items: sanitizeFogMapItems(obj.items),
    outOfScope: sanitizeStringArray(obj.outOfScope),
  }
}

function sanitizeFogMapItems(raw: unknown): FogMapItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item: unknown) => {
    const obj = (item as Record<string, unknown>) ?? {}
    return {
      id: String(obj.id ?? generateId()),
      type: validateFogItemType(obj.type),
      state: validateFogItemState(obj.state),
      text: String(obj.text ?? ''),
      blockedBy: sanitizeStringArray(obj.blockedBy),
      evidenceRefs: sanitizeStringArray(obj.evidenceRefs),
    }
  })
}

function validateFogItemType(value: unknown): FogMapItem['type'] {
  if (value === 'research' || value === 'prototype' || value === 'grilling' || value === 'task') return value
  return 'task'
}

function validateFogItemState(value: unknown): FogMapItem['state'] {
  if (value === 'frontier' || value === 'blocked' || value === 'not-yet-specified') return value
  return 'frontier'
}

function sanitizeExpandContractPlan(raw: unknown): Ticket['expandContractPlan'] {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  return {
    expand: sanitizeExpandContractPhases(obj.expand),
    migrate: sanitizeExpandContractPhases(obj.migrate),
    contract: sanitizeExpandContractPhases(obj.contract),
  }
}

function sanitizeExpandContractPhases(raw: unknown): ExpandContractPhase[] {
  if (!Array.isArray(raw)) return []
  return raw.map((phase: unknown) => {
    const obj = (phase as Record<string, unknown>) ?? {}
    return {
      id: String(obj.id ?? generateId()),
      label: String(obj.label ?? ''),
      status: validatePhaseStatus(obj.status),
      verificationChecks: sanitizeVerificationChecks(obj.verificationChecks),
    }
  })
}

function validatePhaseStatus(value: unknown): ExpandContractPhase['status'] {
  if (value === 'pending' || value === 'in-progress' || value === 'done' || value === 'blocked') return value
  return 'pending'
}

function sanitizeExecutionEvidence(raw: unknown): ExecutionEvidence | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  return {
    ...(typeof obj.testSeam === 'string' ? { testSeam: obj.testSeam } : {}),
    ...(obj.firstFailingCheck ? { firstFailingCheck: sanitizeVerificationCheck(obj.firstFailingCheck) } : {}),
    ...(obj.passingCheck ? { passingCheck: sanitizeVerificationCheck(obj.passingCheck) } : {}),
    ...(typeof obj.refactorNote === 'string' ? { refactorNote: obj.refactorNote } : {}),
    ...(obj.finalVerification ? { finalVerification: sanitizeVerificationCheck(obj.finalVerification) } : {}),
  }
}

function sanitizeReview(raw: unknown): Ticket['review'] {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  return {
    spec: sanitizeReviewAxisRecord(obj.spec, 'Spec'),
    standards: sanitizeReviewAxisRecord(obj.standards, 'Standards'),
    ...(typeof obj.reviewedAt === 'string' ? { reviewedAt: obj.reviewedAt } : {}),
    ...(typeof obj.reviewer === 'string' ? { reviewer: obj.reviewer } : {}),
  }
}

function sanitizeReviewAxisRecord(raw: unknown, axis: ReviewAxis): ReviewAxisRecord {
  const obj = (raw as Record<string, unknown>) ?? {}
  return {
    verdict: validateReviewVerdict(obj.verdict),
    findings: sanitizeReviewFindings(obj.findings, axis),
  }
}

function validateReviewVerdict(value: unknown): ReviewAxisRecord['verdict'] {
  if (value === 'approved' || value === 'approved-with-follow-ups' || value === 'needs-fixes') return value
  return 'needs-fixes'
}

function sanitizeReviewFindings(raw: unknown, axis: ReviewAxis): ReviewFinding[] {
  if (!Array.isArray(raw)) return []
  return raw.map((finding: unknown) => {
    const obj = (finding as Record<string, unknown>) ?? {}
    return {
      id: String(obj.id ?? generateId()),
      axis,
      severity: obj.severity === 'info' || obj.severity === 'warning' || obj.severity === 'blocker' ? obj.severity : 'warning',
      message: String(obj.message ?? ''),
      refs: sanitizeStringArray(obj.refs),
      smellTags: sanitizeSmellTags(obj.smellTags),
    }
  })
}

function sanitizeSmellTags(raw: unknown): SmellTag[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((tag): tag is SmellTag =>
    tag === 'mysterious-name' ||
    tag === 'duplicated-code' ||
    tag === 'feature-envy' ||
    tag === 'data-clumps' ||
    tag === 'primitive-obsession' ||
    tag === 'repeated-switches' ||
    tag === 'shotgun-surgery' ||
    tag === 'divergent-change' ||
    tag === 'speculative-generality' ||
    tag === 'message-chains' ||
    tag === 'middle-man' ||
    tag === 'refused-bequest',
  )
}

function ensureSeeded(): void {
  if (localStorage.getItem(SEEDED_KEY)) return
  localStorage.setItem(TICKETS_KEY, JSON.stringify(DEMO_TICKETS))
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(DEMO_ACTIVITIES))
  localStorage.setItem(EMAILS_KEY, JSON.stringify(DEMO_EMAILS))
  localStorage.setItem(SEEDED_KEY, '1')
}

export function loadTickets(): Ticket[] {
  ensureSeeded()
  try {
    const raw = localStorage.getItem(TICKETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((t: unknown) => sanitizeTicket((t as Record<string, unknown>) ?? {}))
  } catch {
    return []
  }
}

export function saveTickets(tickets: Ticket[]): boolean {
  try {
    localStorage.setItem(TICKETS_KEY, JSON.stringify(tickets))
    return true
  } catch {
    console.warn('FindMnemo: Failed to save tickets')
    return false
  }
}

// Browser-runtime helper only. External agents need a local bridge or browser
// automation before their tickets should be treated as live agent-created work.
export function agentCreateTicket(
  title: string,
  description: string,
  source: LLMSource,
  sessionId?: string,
): Ticket | null {
  const ticket: Ticket = {
    id: generateId(),
    title,
    description,
    source,
    status: 'in-progress',
    origin: 'agent-runtime',
    workNotes: [{ id: generateId(), text: `Agent started work. Session: ${sessionId ?? 'unknown'}`, createdAt: now() }],
    artifacts: [],
    decisionLog: [],
    createdAt: now(),
    updatedAt: now(),
  }
  const tickets = loadTickets()
  tickets.push(ticket)
  if (!saveTickets(tickets)) return null
  recordTelemetry({
    ticket,
    activityId: 'ticket-created',
    label: 'Create work ticket',
    type: 'intake',
    actor: source,
    transition: { toState: ticket.status },
    tags: ['ticket', 'created'],
  })
  return ticket
}

export function createTicket(
  title: string,
  description: string,
  source: Ticket['source'],
): Ticket | null {
  const ticket: Ticket = {
    id: generateId(),
    title,
    description,
    source,
    status: 'todo',
    origin: 'browser-ui',
    workNotes: [],
    artifacts: [],
    decisionLog: [],
    createdAt: now(),
    updatedAt: now(),
  }
  const tickets = loadTickets()
  tickets.push(ticket)
  if (!saveTickets(tickets)) return null
  recordTelemetry({
    ticket,
    activityId: 'ticket-created',
    label: 'Create work ticket',
    type: 'intake',
    actor: 'Henry',
    transition: { toState: ticket.status },
    tags: ['ticket', 'created'],
  })
  return ticket
}

function statusTransitionActivity(
  fromState: Ticket['status'],
  toState: Ticket['status'],
): { activityId: string; label: string; type: TelemetryActivityType; tags: string[]; result: WorkTelemetryEvent['result'] } {
  const transitionKey = `${fromState}->${toState}`
  switch (transitionKey) {
    case 'todo->in-progress':
      return { activityId: 'ticket-work-started', label: 'Start work', type: 'execute', tags: ['ticket', 'start-work'], result: { status: 'success' } }
    case 'blocked->in-progress':
      return { activityId: 'ticket-resumed', label: 'Resume work', type: 'execute', tags: ['ticket', 'resume'], result: { status: 'success' } }
    case 'in-progress->blocked':
      return { activityId: 'ticket-blocked', label: 'Block work', type: 'execute', tags: ['ticket', 'blocked'], result: { status: 'exception', reasonCode: 'blocked', message: 'Ticket marked blocked' } }
    case 'todo->blocked':
      return { activityId: 'ticket-blocked', label: 'Block work', type: 'execute', tags: ['ticket', 'blocked', 'fast-track-block'], result: { status: 'exception', reasonCode: 'blocked', message: 'Ticket blocked before work started' } }
    case 'in-progress->done':
      return { activityId: 'ticket-completed', label: 'Complete work', type: 'close', tags: ['ticket', 'completed'], result: { status: 'success' } }
    case 'blocked->done':
      return { activityId: 'ticket-completed', label: 'Complete work (was blocked)', type: 'close', tags: ['ticket', 'completed', 'from-blocked'], result: { status: 'success' } }
    case 'todo->done':
      return { activityId: 'ticket-completed', label: 'Complete work (fast-track)', type: 'close', tags: ['ticket', 'completed', 'fast-track'], result: { status: 'success' } }
    default:
      return { activityId: 'ticket-status-changed', label: 'Change ticket status', type: 'execute', tags: ['ticket', 'status-change'], result: { status: 'success' } }
  }
}

export function updateTicketStatus(
  id: string,
  status: Ticket['status'],
  actor: LLMSource | 'Henry' = 'Henry',
): Ticket[] {
  const tickets = loadTickets()
  const ticket = tickets.find((t) => t.id === id)
  if (ticket) {
    const fromState = ticket.status
    ticket.status = status
    ticket.updatedAt = now()
    const meta = statusTransitionActivity(fromState, status)
    recordTelemetry({
      ticket,
      activityId: meta.activityId,
      label: meta.label,
      type: meta.type,
      actor,
      timestamp: ticket.updatedAt,
      transition: { fromState, toState: status },
      result: meta.result,
      acceptedOutcome: status === 'done',
      tags: meta.tags,
    })
  }
  saveTickets(tickets)
  return tickets
}

export type WorkNoteKind = 'general' | 'recovery' | 'handoff' | 'decision' | 'milestone'

export function addWorkNote(
  id: string,
  text: string,
  actor: LLMSource | 'Henry' = 'Henry',
  kind: WorkNoteKind = 'general',
): Ticket[] {
  const tickets = loadTickets()
  const ticket = tickets.find((t) => t.id === id)
  if (ticket) {
    const note = { id: generateId(), text, createdAt: now() }
    ticket.workNotes.push(note)
    ticket.updatedAt = note.createdAt

    const kindLabels: Record<WorkNoteKind, { activityId: string; label: string }> = {
      general: { activityId: 'work-note-added', label: 'Add work note' },
      recovery: { activityId: 'recovery-note-added', label: 'Add recovery note' },
      handoff: { activityId: 'handoff-note-added', label: 'Add handoff note' },
      decision: { activityId: 'decision-note-added', label: 'Add decision note' },
      milestone: { activityId: 'milestone-note-added', label: 'Add milestone note' },
    }
    const meta = kindLabels[kind]

    recordTelemetry({
      ticket,
      activityId: meta.activityId,
      label: meta.label,
      type: 'review',
      actor,
      timestamp: note.createdAt,
      evidence: [{
        id: note.id,
        sourceRef: `mnemosync://ticket/${ticket.id}/note/${note.id}`,
        label: `${kind.charAt(0).toUpperCase() + kind.slice(1)} note`,
        classification: 'private-work-data',
      }],
      tags: ['ticket', 'work-note', `note-${kind}`],
    })
  }
  saveTickets(tickets)
  return tickets
}

export function addDecisionLogEntry(
  id: string, decision: string, reasoning: string,
  gateType: DecisionLogEntry['gateType'], reversibility: DecisionLogEntry['reversibility'],
  actor: LLMSource | 'Henry' = 'Henry',
): Ticket[] {
  const tickets = loadTickets()
  const ticket = tickets.find((t) => t.id === id)
  if (ticket) {
    const entry = { id: generateId(), timestamp: now(), decision, reasoning, gateType, reversibility }
    ticket.decisionLog.push(entry)
    ticket.updatedAt = entry.timestamp
    recordTelemetry({
      ticket,
      activityId: 'decision-recorded',
      label: 'Record decision',
      type: 'decide',
      actor,
      timestamp: entry.timestamp,
      decision: {
        id: entry.id,
        selectedPath: entry.decision,
        rationale: entry.reasoning,
        decidingAuthority: actor,
      },
      tags: ['ticket', 'decision', gateType, `reversibility-${reversibility}`],
    })
  }
  saveTickets(tickets)
  return tickets
}

export function addArtifact(
  id: string,
  type: Artifact['type'],
  label: string,
  url?: string,
  actor: LLMSource | 'Henry' = 'Henry',
): Ticket[] {
  const tickets = loadTickets()
  const ticket = tickets.find((t) => t.id === id)
  if (ticket) {
    const artifact = { id: generateId(), type, label, url, createdAt: now() }
    ticket.artifacts.push(artifact)
    ticket.updatedAt = artifact.createdAt
    recordTelemetry({
      ticket,
      activityId: 'artifact-attached',
      label: 'Attach work artifact',
      type: 'execute',
      actor,
      timestamp: artifact.createdAt,
      evidence: [{
        id: artifact.id,
        sourceRef: artifact.url ?? `mnemosync://ticket/${ticket.id}/artifact/${artifact.id}`,
        label: artifact.label,
        classification: 'private-work-data',
      }],
      tags: ['ticket', 'artifact', artifact.type],
    })
  }
  saveTickets(tickets)
  return tickets
}

export function deleteTicket(id: string): Ticket[] {
  const tickets = loadTickets().filter((t) => t.id !== id)
  saveTickets(tickets)
  return tickets
}

// Agent activity tracking

export function loadAgentActivity(): AgentActivity[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY)
    if (!raw) return getDefaultActivities()
    return JSON.parse(raw)
  } catch {
    return getDefaultActivities()
  }
}

function getDefaultActivities(): AgentActivity[] {
  ensureSeeded()
  const ts = now()
  return [
    { id: 'agent-pi', agent: 'Pi', state: 'idle', currentTask: 'No active task', lastActive: ts },
    { id: 'agent-codex', agent: 'Codex', state: 'idle', currentTask: 'No active task', lastActive: ts },
    { id: 'agent-claude', agent: 'Claude Cowork', state: 'idle', currentTask: 'No active task', lastActive: ts },
  ]
}

export function saveAgentActivity(activities: AgentActivity[]): boolean {
  try {
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activities))
    return true
  } catch { return false }
}

export function updateAgentState(agent: LLMSource, state: AgentActivity['state'], currentTask: string, sessionId?: string): AgentActivity[] {
  const activities = loadAgentActivity()
  const entry = activities.find((a) => a.agent === agent)
  if (entry) {
    entry.state = state
    entry.currentTask = currentTask
    entry.lastActive = now()
    if (sessionId) entry.sessionId = sessionId
  }
  saveAgentActivity(activities)
  return activities
}

// Email tracking

export function loadEmails(): EmailThread[] {
  ensureSeeded()
  try {
    const raw = localStorage.getItem(EMAILS_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch { return [] }
}

export function saveEmails(emails: EmailThread[]): boolean {
  try {
    localStorage.setItem(EMAILS_KEY, JSON.stringify(emails))
    return true
  } catch { return false }
}

export function ingestEmails(threads: EmailThread[]): EmailThread[] {
  const existing = loadEmails()
  const existingIds = new Set(existing.map((e) => e.messageId))
  const newThreads = threads.filter((t) => !existingIds.has(t.messageId))
  const merged = [...existing, ...newThreads]
  saveEmails(merged)
  return merged
}
