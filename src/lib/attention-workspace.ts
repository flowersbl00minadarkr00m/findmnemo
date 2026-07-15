import type { AgentActivityAssignmentSummaryDto, AgentActivityIntegrationDto, GmailCandidateDto, ReconciliationRunDto, ReconciliationSourceResultDto, SourceDescriptor } from '../../shared/companion-contract'
import type {
  AttentionAction,
  AttentionBucket,
  AttentionEvidence,
  AttentionItem,
  AttentionPriority,
  AttentionSourceStatus,
  AttentionTruthState,
  AttentionWorkspaceProjection,
  Ticket,
} from '../types'

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

const PRIORITY_ORDER: Record<AttentionPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

interface RankedAttentionItem extends AttentionItem { rank: number }

export interface AttentionProjectionInput {
  tickets: readonly Ticket[]
  gmailCandidates?: readonly GmailCandidateDto[]
  reconciliationSources?: readonly SourceDescriptor[]
  reconciliationRun?: ReconciliationRunDto
  reconciliationRuns?: readonly ReconciliationRunDto[]
  ticketState?: 'loading' | 'current' | 'stale' | 'error'
  gmailTruthState?: AttentionTruthState
  lastReconciliationSuccessAt?: string
  agentAssignments?: readonly AgentActivityAssignmentSummaryDto[]
  agentIntegrations?: readonly AgentActivityIntegrationDto[]
  fictional?: boolean
  now?: string | Date
}

export function projectAttentionWorkspace(input: AttentionProjectionInput): AttentionWorkspaceProjection {
  const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now())
  const ticketTruth = input.fictional ? 'fictional' : truthFromTicketState(input.ticketState)
  const ticketMap = new Map(input.tickets.map((ticket) => [ticket.id, ticket]))
  const assignmentMap = new Map((input.agentAssignments ?? []).map((assignment) => [assignment.ticketId, assignment]))
  const ranked: RankedAttentionItem[] = []

  for (const ticket of input.tickets) {
    const item = projectTicket(ticket, ticketMap, ticketTruth, now, assignmentMap.get(ticket.id))
    if (item) ranked.push(item)
  }
  for (const candidate of input.gmailCandidates ?? []) {
    const item = projectGmail(candidate, input.fictional ? 'fictional' : (input.gmailTruthState ?? 'current'), now)
    if (item) ranked.push(item)
  }
  for (const source of input.reconciliationSources ?? []) {
    const evidence = latestSourceEvidence(input, source.id)
    const item = projectSource(source, evidence?.result, evidence?.run, input.fictional === true)
    if (item) ranked.push(item)
  }

  ranked.sort(compareRankedItems)
  const items = ranked.map(({ rank: _rank, ...item }) => item)
  const resolved = items.filter((item) => item.bucket === 'recently-resolved').length
  const queued = items.length
  return {
    items,
    sources: projectSourceStatuses(input),
    dayStatus: queued === 0
      ? { queued: 0, resolved: 0, progress: null, label: 'No decisions queued' }
      : { queued, resolved, progress: Math.round((resolved / queued) * 100), label: `${resolved} of ${queued} decisions resolved` },
  }
}

function projectTicket(
  ticket: Ticket,
  tickets: Map<string, Ticket>,
  truthState: AttentionTruthState,
  now: Date,
  assignment?: AgentActivityAssignmentSummaryDto,
): RankedAttentionItem | undefined {
  const recordRef = `ticket:${ticket.id}`
  const blockers = (ticket.blockedBy ?? []).map((id) => {
    const blocker = tickets.get(id)
    return { id, state: blocker ? (blocker.status === 'done' ? 'resolved' : 'unresolved') : 'missing' } as const
  })
  const unresolvedBlockers = blockers.some((blocker) => blocker.state !== 'resolved')
  const receiptIds = ticket.receiptIds ?? []
  const receiptMissing = ticket.receiptRequired === true && receiptIds.length === 0
  const evidence = ticketEvidence(ticket, blockers, receiptMissing)

  let rank: number
  let bucket: AttentionBucket
  let priority: AttentionPriority
  let priorityReason: string
  let primaryAction: AttentionAction

  if (assignment?.effectiveState === 'needs-action') {
    rank = 0
    bucket = 'needs-action'
    priority = 'critical'
    priorityReason = 'The agent reported that this assignment needs your action.'
    primaryAction = action(recordRef, 'open-ticket', 'Review requested action')
  } else if (assignment?.effectiveState === 'blocked') {
    rank = 0
    bucket = 'needs-action'
    priority = 'critical'
    priorityReason = 'The agent reported that this assignment is blocked.'
    primaryAction = action(recordRef, 'open-ticket', 'Review blocker')
  } else if (assignment?.effectiveState === 'stale') {
    rank = 1
    bucket = 'needs-action'
    priority = 'high'
    priorityReason = `Last reported ${activityStateLabel(assignment.retainedLastState)} before coverage became stale.`
    primaryAction = action(recordRef, 'open-ticket', 'Review stale assignment')
  } else if (assignment?.effectiveState === 'waiting') {
    rank = 5
    bucket = 'waiting'
    priority = 'normal'
    priorityReason = 'The agent reported that this assignment is waiting.'
    primaryAction = action(recordRef, 'open-ticket', 'Review waiting work')
  } else if (ticket.status === 'blocked') {
    rank = 0
    bucket = 'needs-action'
    priority = 'critical'
    priorityReason = unresolvedBlockers ? 'Blocked work has unresolved or missing blockers.' : 'Work is explicitly blocked and needs review.'
    primaryAction = action(recordRef, 'open-ticket', 'Review blocker')
  } else if (ticket.receiptRequired) {
    rank = 1
    bucket = 'needs-action'
    priority = 'high'
    priorityReason = receiptMissing ? 'Required receipt is not linked.' : 'AI receipt is awaiting human disposition.'
    primaryAction = action(recordRef, 'review-receipt', 'Review receipt', receiptMissing ? 'Required receipt is not linked.' : undefined)
  } else if (unresolvedBlockers) {
    rank = 0
    bucket = 'waiting'
    priority = 'high'
    priorityReason = 'Work is waiting on an unresolved or missing blocker.'
    primaryAction = action(recordRef, 'open-ticket', 'Review dependency')
  } else if (ticket.status === 'in-progress' || ticket.status === 'todo') {
    rank = 4
    bucket = 'needs-action'
    priority = ticket.status === 'in-progress' ? 'normal' : 'low'
    priorityReason = ticket.status === 'in-progress' ? 'Work is in progress and remains open.' : 'Frontier work is ready for attention.'
    primaryAction = action(recordRef, 'open-ticket', 'Open ticket')
  } else if (ticket.status === 'done' && ticket.completedAt && isRecent(ticket.completedAt, now)) {
    rank = 6
    bucket = 'recently-resolved'
    priority = 'low'
    priorityReason = 'Work was resolved within the recent window.'
    primaryAction = action(recordRef, 'open-ticket', 'Review outcome')
  } else {
    return undefined
  }

  return {
    rank,
    id: `attention:${recordRef}`,
    kind: 'ticket',
    recordRef,
    title: ticket.title,
    summary: ticket.description,
    sourceLabel: assignment ? `${assignment.agentLabel} activity` : ticket.origin ? `Ticket · ${ticket.origin}` : 'Ticket',
    ownerLabel: ticket.source,
    bucket,
    priority,
    priorityReason,
    truthState: assignment?.effectiveState === 'stale' ? 'stale' : assignment ? 'current' : truthState,
    updatedAt: ticket.updatedAt,
    evidence: assignment ? assignmentEvidence(evidence, assignment) : evidence,
    primaryAction,
    secondaryActions: ticket.status === 'done' || assignment ? [] : [{ ...action(recordRef, 'change-status', 'Mark done'), targetStatus: 'done' }],
  }
}

function ticketEvidence(
  ticket: Ticket,
  blockers: AttentionEvidence['blockers'],
  receiptMissing: boolean,
): AttentionEvidence {
  const refs = [
    ...(ticket.origin ? [{ label: 'Origin', value: ticket.origin, state: 'available' as const }] : []),
    ...(ticket.sddGate ? [{ label: 'SDD gate', value: ticket.sddGate, state: 'available' as const }] : []),
    ...ticket.artifacts.map((artifact) => ({ label: artifact.label, value: artifact.url, state: artifact.status ?? 'available' })),
    ...(ticket.acceptanceCriteria ?? []).map((criterion) => ({ label: 'Acceptance criterion', value: criterion.text, state: 'available' as const })),
    ...(ticket.verificationChecks ?? []).map((check) => ({ label: 'Verification', value: check.commandOrCheck, state: check.result === 'failed' ? 'unavailable' as const : 'available' as const })),
  ]
  const receiptIds = ticket.receiptIds ?? []
  const rollbackRefs = ticket.decisionLog.map((entry) => ({
    label: 'Decision reversibility',
    value: `${entry.decision} · ${entry.reversibility} reversibility · ${entry.gateType} gate`,
    state: 'available' as const,
  }))
  const hasSomeEvidence = refs.length > 0 || blockers.length > 0 || receiptIds.length > 0
  return {
    availability: receiptMissing ? 'required-missing' : hasSomeEvidence ? 'available' : 'missing',
    refs,
    blockers,
    receiptIds,
    reasonCodes: [],
    rollbackRefs,
  }
}

function projectGmail(candidate: GmailCandidateDto, truthState: AttentionTruthState, now: Date): RankedAttentionItem | undefined {
  const recordRef = `gmail:${candidate.accountId}:${candidate.threadId}`
  let rank: number
  let bucket: AttentionBucket
  let priority: AttentionPriority
  let priorityReason: string
  let label: string

  if (candidate.state === 'candidate' || candidate.state === 'confirmed' || candidate.state === 'confirmed-untracked') {
    rank = 2
    bucket = 'needs-action'
    priority = 'high'
    priorityReason = candidate.state === 'confirmed-untracked'
      ? 'Confirmed email follow-up is not linked to a ticket.'
      : 'Email candidate requires an explicit review decision.'
    label = candidate.state === 'confirmed-untracked' ? 'Create or link ticket' : 'Review email'
  } else if (candidate.state === 'deferred') {
    rank = 5
    bucket = 'waiting'
    priority = 'low'
    priorityReason = 'Email decision was deferred.'
    label = 'Review deferred email'
  } else if (isRecent(candidate.receivedAt, now)) {
    rank = 6
    bucket = 'recently-resolved'
    priority = 'low'
    priorityReason = `Email candidate is ${candidate.state}.`
    label = 'Review email outcome'
  } else {
    return undefined
  }

  return {
    rank,
    id: `attention:${recordRef}`,
    kind: 'gmail',
    recordRef,
    title: candidate.subject,
    summary: candidate.snippet,
    sourceLabel: 'Gmail',
    ownerLabel: candidate.sender,
    bucket,
    priority,
    priorityReason,
    truthState,
    updatedAt: candidate.receivedAt,
    evidence: {
      availability: candidate.reasonCodes.length > 0 ? 'available' : 'partial',
      refs: [
        { label: 'State', value: candidate.state, state: 'available' },
        { label: 'Record version', value: String(candidate.recordVersion), state: 'available' },
      ],
      blockers: [],
      receiptIds: [],
      reasonCodes: [...candidate.reasonCodes],
    },
    primaryAction: action(recordRef, candidate.state === 'confirmed-untracked' ? 'choose-ticket' : 'review-gmail', label),
    secondaryActions: [],
  }
}

function projectSource(
  source: SourceDescriptor,
  result: ReconciliationSourceResultDto | undefined,
  run: ReconciliationRunDto | undefined,
  fictional: boolean,
): RankedAttentionItem | undefined {
  if (!source.enabled) return undefined
  const recordRef = `source:${source.id}`
  const truthState = sourceTruth(result, run, fictional)
  const counts = result ? sourceCounts(result) : 'No source check evidence is available.'

  if (!result) {
    return sourceItem(source, recordRef, 3, 'needs-action', 'normal', 'Source has not been checked yet.', truthState, counts, result)
  }
  if (result.state === 'failed' || result.state === 'unavailable' || result.unresolved > 0 || result.duplicate > 0) {
    return sourceItem(source, recordRef, 3, 'needs-action', 'high', 'Source coverage is incomplete and needs recovery.', truthState, counts, result)
  }
  if (result.state === 'pending' || result.state === 'checking') {
    return sourceItem(source, recordRef, 5, 'waiting', 'normal', 'Source reconciliation is still in progress.', truthState, counts, result)
  }
  return undefined
}

function sourceItem(
  source: SourceDescriptor,
  recordRef: string,
  rank: number,
  bucket: AttentionBucket,
  priority: AttentionPriority,
  priorityReason: string,
  truthState: AttentionTruthState,
  summary: string,
  result?: ReconciliationSourceResultDto,
): RankedAttentionItem {
  return {
    rank,
    id: `attention:${recordRef}`,
    kind: 'source',
    recordRef,
    title: source.label,
    summary,
    sourceLabel: source.label,
    bucket,
    priority,
    priorityReason,
    truthState,
    evidence: {
      availability: result ? 'available' : 'missing',
      refs: result ? [
        { label: 'State', value: result.state, state: 'available' },
        { label: 'Checked', value: String(result.checked), state: 'available' },
        ...(result.errorCode ? [{ label: 'Error', value: result.errorCode, state: 'unavailable' as const }] : []),
      ] : [],
      blockers: [],
      receiptIds: [],
      reasonCodes: result?.reasonCode ? [result.reasonCode] : [],
    },
    primaryAction: action(recordRef, result ? 'retry-source' : 'run-sync', result ? 'Retry source' : 'Run MnemoSync'),
    secondaryActions: [action(recordRef, 'run-sync', 'Run full MnemoSync')],
  }
}

function projectSourceStatuses(input: AttentionProjectionInput): AttentionSourceStatus[] {
  const reconciled = (input.reconciliationSources ?? []).map((source) => {
    const evidence = latestSourceEvidence(input, source.id)
    const result = evidence?.result
    const truthState = sourceTruth(result, evidence?.run, input.fictional === true)
    return {
      id: source.id,
      label: source.label,
      enabled: source.enabled,
      truthState,
      detail: !source.enabled ? 'Optional source — not configured.' : result ? sourceCounts(result) : 'Not checked yet',
      ...(result?.state === 'checked' && evidence?.run.finishedAt ? { lastSuccessAt: evidence.run.finishedAt } : {}),
      ...(!source.enabled ? {} : { recoveryAction: 'retry-source' as const }),
    }
  })
  const agents = (input.agentIntegrations ?? []).map((integration): AttentionSourceStatus => ({
    id: `agent-activity:${integration.id}`,
    label: `${integration.label} activity`,
    enabled: integration.enabled,
    truthState: agentCoverageTruth(integration.coverageState),
    detail: integration.retainedLastSuccess
      ? `${integration.coverageExplanation} Retained last success${integration.lastSuccessAt ? ` from ${new Date(integration.lastSuccessAt).toLocaleString()}` : ''}.`
      : integration.coverageExplanation,
    ...(integration.lastSuccessAt ? { lastSuccessAt: integration.lastSuccessAt } : {}),
    ...(['partial', 'stale', 'unavailable', 'unsupported'].includes(integration.coverageState) ? { recoveryAction: 'open-settings' as const } : {}),
  }))
  return [...reconciled, ...agents]
}

function assignmentEvidence(evidence: AttentionEvidence, assignment: AgentActivityAssignmentSummaryDto): AttentionEvidence {
  const project = assignment.project.kind === 'approved-project' ? assignment.project.label : assignment.project.kind === 'needs-review' ? 'Needs review' : 'Unassigned'
  return {
    ...evidence,
    availability: 'available',
    refs: [
      ...evidence.refs,
      { label: 'Agent state', value: assignment.effectiveState, state: assignment.effectiveState === 'stale' ? 'unavailable' : 'available' },
      { label: 'Last reported', value: `${assignment.retainedLastState} at ${assignment.lastObservedAt}`, state: 'available' },
      { label: 'Project', value: project, state: assignment.project.kind === 'needs-review' ? 'missing' : 'available' },
      { label: 'Field ownership', value: `summary: ${assignment.summaryOwner}; project: ${assignment.projectOwner}`, state: 'available' },
      ...(assignment.terminalEvidence ? [{ label: 'Terminal evidence', value: assignment.terminalEvidence, state: 'available' as const }] : []),
      ...(assignment.linkedTicketKind ? [{ label: 'SDD activity link', value: assignment.linkedTicketKind, state: 'available' as const }] : []),
    ],
  }
}

function activityStateLabel(state: AgentActivityAssignmentSummaryDto['retainedLastState']): string {
  return state === 'needs-action' ? 'needs action' : state
}

function agentCoverageTruth(state: AgentActivityIntegrationDto['coverageState']): AttentionTruthState {
  if (state === 'connected') return 'current'
  if (state === 'stale') return 'stale'
  if (state === 'partial') return 'partial'
  if (state === 'unavailable' || state === 'unsupported') return 'disconnected'
  return 'unverified'
}

function latestSourceEvidence(input: AttentionProjectionInput, sourceId: SourceDescriptor['id']): { run: ReconciliationRunDto; result: ReconciliationSourceResultDto } | undefined {
  const runs = [
    ...(input.reconciliationRun ? [input.reconciliationRun] : []),
    ...(input.reconciliationRuns ?? []),
  ]
  const seen = new Set<string>()
  for (const run of runs) {
    if (seen.has(run.id)) continue
    seen.add(run.id)
    const result = run.sources.find((entry) => entry.sourceId === sourceId)
    if (result) return { run, result }
  }
  return undefined
}

function sourceTruth(
  result: ReconciliationSourceResultDto | undefined,
  _run: ReconciliationRunDto | undefined,
  fictional: boolean,
): AttentionTruthState {
  if (fictional) return 'fictional'
  if (!result) return 'unverified'
  if (result.state === 'failed' || result.state === 'unavailable') return 'disconnected'
  if (result.state === 'checked' && (result.unresolved > 0 || result.duplicate > 0)) return 'partial'
  if (result.state === 'checked') return 'current'
  return 'unverified'
}

function truthFromTicketState(state: AttentionProjectionInput['ticketState']): AttentionTruthState {
  if (state === 'current') return 'current'
  if (state === 'stale') return 'stale'
  if (state === 'error') return 'disconnected'
  return 'unverified'
}

function sourceCounts(result: ReconciliationSourceResultDto): string {
  return `${result.checked} checked · ${result.added} added · ${result.updated} updated · ${result.unchanged} unchanged · ${result.unresolved} unresolved`
}

function action(recordRef: string, kind: AttentionAction['kind'], label: string, disabledReason?: string): AttentionAction {
  return { id: `${recordRef}:${kind}`, kind, label, recordRef, ...(disabledReason ? { disabledReason } : {}) }
}

function isRecent(value: string | undefined, now: Date): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= 0 && now.getTime() - timestamp <= RECENT_WINDOW_MS
}

function compareRankedItems(left: RankedAttentionItem, right: RankedAttentionItem): number {
  if (left.rank !== right.rank) return left.rank - right.rank
  const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
  if (priority !== 0) return priority
  const updated = Date.parse(right.updatedAt ?? '') - Date.parse(left.updatedAt ?? '')
  if (Number.isFinite(updated) && updated !== 0) return updated
  return left.recordRef.localeCompare(right.recordRef)
}
