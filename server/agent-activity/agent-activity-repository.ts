import { createHmac } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  parseAssignmentEventV1,
  type AgentKind,
  type AssignmentEventReceiptCode,
  type AssignmentEventV1,
  type AssignmentEvidenceKind,
  type SummarySource,
} from '../../shared/agent-activity-contract.js'
import type { OperationalRepository, StoredTicket } from '../db/operational-repository.js'
import type { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'

export interface AgentActivityIntegrationInput {
  id: string
  agent: AgentKind
  adapterVersion: string
  installedVersion: string | null
  enabled?: boolean
  configured?: boolean
  supportLevel?: 'unsupported' | 'detection-only' | 'manual' | 'snapshot' | 'automatic-partial' | 'automatic-task-terminal'
  freshnessProfile?: string
  heartbeatSeconds?: number | null
  freshnessWindowSeconds?: number
}

export interface AgentActivityIngestReceipt {
  outcome: 'applied' | 'duplicate' | 'replay' | 'conflict' | 'gap' | 'rejected'
  assignmentKey: string
  ticketId: string
  receiptCodes: AssignmentEventReceiptCode[]
  expectedSequence?: number
  reasonCode?: string
  appliedCount?: number
}

export interface BrowserSafeAssignment {
  assignmentKey: string
  integrationId: string
  ticketId: string
  agent: AgentKind
  generation: number
  safeSummary: string
  summarySource: SummarySource
  summaryOwner: 'source' | 'human'
  projectRef:
    | { kind: 'approved-project'; id: string }
    | { kind: 'unassigned' }
    | { kind: 'needs-review'; reviewToken: string }
  projectOwner: 'source' | 'human'
  modelLabel: string | null
  reportedState: 'active' | 'waiting' | 'blocked' | 'needs-action' | 'completed' | 'failed' | 'cancelled'
  lastAppliedSequence: number
  lastObservedAt: string
  freshUntil: string | null
  terminalAt: string | null
  terminalEvidenceKind: string | null
  terminalOutcome: 'completed' | 'failed' | 'cancelled' | null
  evidenceKind: AssignmentEvidenceKind
  sourceUpdatePolicy: 'follow' | 'paused' | 'detached' | 'closed'
  recordVersion: number
}

export interface HumanAssignmentOverride {
  expectedVersion: number
  safeSummary?: string
  projectRef?: BrowserSafeAssignment['projectRef']
  sourceUpdatePolicy?: BrowserSafeAssignment['sourceUpdatePolicy']
}

export interface AssignmentListRecord extends BrowserSafeAssignment {
  projectLabel: string | null
  linkedTicketKind: 'sdd-task-execution' | null
}

interface EventProjection {
  eventId: string
  sequence: number
  kind: AssignmentEventV1['observation']['kind']
  reportedState: AssignmentEventV1['observation']['reportedState']
  observedAt: string
  reasonCode: AssignmentEventV1['observation']['reasonCode']
  evidenceKind: AssignmentEvidenceKind
  evidenceKey: string | null
  safeSummary: string
  summarySource: SummarySource
  projectRef: AssignmentEventV1['assignment']['projectRef']
  modelLabel: string | null
  terminalEvidenceKind: string | null
  terminalOutcome: 'completed' | 'failed' | 'cancelled' | null
}

export class AgentActivityRepository {
  private readonly db: DatabaseSync
  private readonly operational: OperationalRepository
  private readonly lifecycle: TicketLifecycleService
  private readonly identityKey: Buffer
  private readonly clock: () => Date

  constructor(
    db: DatabaseSync,
    operational: OperationalRepository,
    lifecycle: TicketLifecycleService,
    identityKey: Buffer,
    clock: () => Date = () => new Date(),
  ) {
    if (identityKey.byteLength < 32) throw new Error('ACTIVITY_IDENTITY_KEY_TOO_SHORT')
    this.db = db
    this.operational = operational
    this.lifecycle = lifecycle
    this.identityKey = Buffer.from(identityKey)
    this.clock = clock
  }

  registerIntegration(input: AgentActivityIntegrationInput): void {
    const now = this.clock().toISOString()
    this.db.prepare(`INSERT INTO agent_activity_integrations(
      id,agent_kind,adapter_version,installed_version,enabled,configured,support_level,
      freshness_profile,heartbeat_seconds,freshness_window_seconds,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET agent_kind=excluded.agent_kind,adapter_version=excluded.adapter_version,
      installed_version=excluded.installed_version,enabled=excluded.enabled,configured=excluded.configured,
      support_level=excluded.support_level,freshness_profile=excluded.freshness_profile,
      heartbeat_seconds=excluded.heartbeat_seconds,freshness_window_seconds=excluded.freshness_window_seconds,updated_at=excluded.updated_at`)
      .run(
        input.id, input.agent, input.adapterVersion, input.installedVersion, input.enabled === false ? 0 : 1,
        input.configured === false ? 0 : 1, input.supportLevel ?? 'manual', input.freshnessProfile ?? 'manual',
        input.heartbeatSeconds ?? null, input.freshnessWindowSeconds ?? 1_800, now, now,
      )
  }

  hasIntegration(integrationId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM agent_activity_integrations WHERE id=?').get(integrationId))
  }

  ingest(input: unknown): AgentActivityIngestReceipt {
    const parsed = parseAssignmentEventV1(input)
    return this.ingestValidated(parsed.event, parsed.receiptCodes)
  }

  ingestValidated(event: AssignmentEventV1, receiptCodes: AssignmentEventReceiptCode[], targetTicketId?: string): AgentActivityIngestReceipt {
    const assignmentKey = this.assignmentKeyFor(event)
    const ticketId = ticketIdFor(assignmentKey)

    return this.operational.transaction(() => {
      const duplicate = this.db.prepare('SELECT assignment_key,receipt_code FROM agent_assignment_events WHERE event_id=?').get(event.eventId) as { assignment_key?: string; receipt_code?: string | null } | undefined
      if (duplicate?.assignment_key) {
        const existing = this.db.prepare('SELECT ticket_id FROM agent_assignments WHERE assignment_key=?').get(duplicate.assignment_key) as { ticket_id?: string } | undefined
        if (!existing?.ticket_id) throw new Error('ACTIVITY_EVENT_INTEGRITY_ERROR')
        const receiptCodes: AssignmentEventReceiptCode[] = duplicate.receipt_code === 'SUMMARY_MINIMIZED' ? ['SUMMARY_MINIMIZED'] : []
        return { outcome: 'duplicate', assignmentKey: duplicate.assignment_key, ticketId: existing.ticket_id, receiptCodes }
      }

      const integration = this.db.prepare(`SELECT agent_kind,adapter_version,enabled,configured,freshness_window_seconds
        FROM agent_activity_integrations WHERE id=?`).get(event.integrationId) as Record<string, unknown> | undefined
      if (!integration || !integration.enabled || !integration.configured) throw new Error('ACTIVITY_INTEGRATION_NOT_ENABLED')
      if (integration.agent_kind !== event.agent || integration.adapter_version !== event.adapterVersion) throw new Error('ACTIVITY_INTEGRATION_MISMATCH')
      const now = this.clock().toISOString()
      const projection = this.projection(event, assignmentKey)
      const existing = this.assignmentRow(assignmentKey)
      if (!existing) return this.createFirst(event, projection, receiptCodes, targetTicketId ?? ticketId, Number(integration.freshness_window_seconds), now)

      const existingTicketId = String(existing.ticket_id)
      const expectedSequence = Number(existing.last_applied_sequence) + 1
      if (String(existing.source_update_policy) === 'closed') return { outcome: 'rejected', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence, reasonCode: 'SOURCE_CLOSED', appliedCount: 0 }
      if (existing.terminal_outcome) {
        if (projection.terminalOutcome && projection.terminalOutcome === existing.terminal_outcome) return { outcome: 'duplicate', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence, appliedCount: 0 }
        return { outcome: projection.terminalOutcome ? 'conflict' : 'rejected', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence, reasonCode: projection.terminalOutcome ? 'TERMINAL_CONFLICT' : 'TERMINAL_ASSIGNMENT', appliedCount: 0 }
      }
      if (projection.sequence <= Number(existing.last_applied_sequence)) {
        const prior = this.db.prepare('SELECT event_id FROM agent_assignment_events WHERE assignment_key=? AND sequence=?').get(assignmentKey, projection.sequence) as { event_id?: string } | undefined
        return { outcome: prior?.event_id ? 'conflict' : 'replay', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence, reasonCode: prior?.event_id ? 'SEQUENCE_CONFLICT' : 'REPLAY', appliedCount: 0 }
      }
      if (projection.sequence > expectedSequence) {
        const pendingAtSequence = this.db.prepare('SELECT event_id FROM agent_assignment_events WHERE assignment_key=? AND sequence=?').get(assignmentKey, projection.sequence)
        if (pendingAtSequence) return { outcome: 'conflict', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence, reasonCode: 'SEQUENCE_CONFLICT', appliedCount: 0 }
        const assignmentPending = Number((this.db.prepare("SELECT count(*) AS count FROM agent_assignment_events WHERE assignment_key=? AND apply_state='pending-gap'").get(assignmentKey) as { count: number }).count)
        const totalPending = Number((this.db.prepare("SELECT count(*) AS count FROM agent_assignment_events WHERE apply_state='pending-gap'").get() as { count: number }).count)
        if (assignmentPending >= 32 || totalPending >= 512) return { outcome: 'rejected', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence, reasonCode: 'PENDING_LIMIT', appliedCount: 0 }
        this.insertEvent(assignmentKey, projection, 'pending-gap', receiptCodes[0] ?? null, now)
        return { outcome: 'gap', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence, reasonCode: 'SEQUENCE_GAP', appliedCount: 0 }
      }

      this.insertEvent(assignmentKey, projection, 'applied', receiptCodes[0] ?? null, now)
      this.applyProjection(assignmentKey, projection, Number(integration.freshness_window_seconds), now)
      let appliedCount = 1
      while (true) {
        const current = this.assignmentRow(assignmentKey)!
        if (current.terminal_outcome) break
        const pending = this.db.prepare("SELECT * FROM agent_assignment_events WHERE assignment_key=? AND sequence=? AND apply_state='pending-gap'")
          .get(assignmentKey, Number(current.last_applied_sequence) + 1) as Record<string, unknown> | undefined
        if (!pending) break
        const pendingProjection = projectionFromRow(pending)
        this.db.prepare("UPDATE agent_assignment_events SET apply_state='applied' WHERE event_id=?").run(pendingProjection.eventId)
        this.applyProjection(assignmentKey, pendingProjection, Number(integration.freshness_window_seconds), now)
        appliedCount += 1
      }
      return { outcome: 'applied', assignmentKey, ticketId: existingTicketId, receiptCodes, expectedSequence: Number(this.assignmentRow(assignmentKey)!.last_applied_sequence) + 1, appliedCount }
    })
  }

  updateHumanOverride(assignmentKey: string, input: HumanAssignmentOverride): BrowserSafeAssignment {
    return this.operational.transaction(() => {
      const current = this.assignmentRow(assignmentKey)
      if (!current || Number(current.record_version) !== input.expectedVersion) throw new Error('RECORD_CHANGED')
      if (input.safeSummary !== undefined && (!input.safeSummary.trim() || [...input.safeSummary].length > 160 || /[\r\n]/.test(input.safeSummary))) throw new Error('INVALID_SUMMARY')
      if (input.projectRef?.kind === 'approved-project' && !this.approvedProjectLabel(input.projectRef.id)) throw new Error('PROJECT_NOT_APPROVED')
      const project = input.projectRef ? projectColumns(input.projectRef) : {
        state: String(current.project_mapping_state),
        id: current.project_id ? String(current.project_id) : null,
        reviewToken: current.project_review_token ? String(current.project_review_token) : null,
      }
      const now = this.clock().toISOString()
      const policy = input.sourceUpdatePolicy ?? String(current.source_update_policy) as BrowserSafeAssignment['sourceUpdatePolicy']
      const closed = policy === 'closed'
      this.db.prepare(`UPDATE agent_assignments SET safe_summary=?,summary_owner=?,project_mapping_state=?,project_id=?,
        project_review_token=?,project_owner=?,source_update_policy=?,reported_state=?,terminal_at=?,terminal_evidence_kind=?,
        terminal_outcome=?,record_version=record_version+1,updated_at=? WHERE assignment_key=?`)
        .run(
          input.safeSummary?.trim() ?? String(current.safe_summary), input.safeSummary === undefined ? String(current.summary_owner) : 'human',
          project.state, project.id, project.reviewToken, input.projectRef === undefined ? String(current.project_owner) : 'human', policy,
          closed ? 'completed' : String(current.reported_state), closed ? now : current.terminal_at ? String(current.terminal_at) : null,
          closed ? 'user-confirmed' : current.terminal_evidence_kind ? String(current.terminal_evidence_kind) : null,
          closed ? 'completed' : current.terminal_outcome ? String(current.terminal_outcome) : null,
          now, assignmentKey,
        )
      const updated = this.assignmentRow(assignmentKey)!
      const ticket = this.operational.getTicket(String(updated.ticket_id))
      if (!ticket) throw new Error('ACTIVITY_TICKET_MISSING')
      const resumed = input.sourceUpdatePolicy === 'follow' && String(current.source_update_policy) !== 'follow'
      if (input.safeSummary !== undefined || input.projectRef !== undefined || closed || resumed) {
        const reportedState = String(updated.reported_state) as BrowserSafeAssignment['reportedState']
        const nextPayload = {
          ...ticket.payload,
          ...(input.safeSummary === undefined ? {} : {
            title: String(updated.safe_summary),
            summaryOwner: String(updated.summary_owner),
          }),
          ...(input.projectRef === undefined ? {} : {
            projectId: updated.project_id ? String(updated.project_id) : null,
            projectMappingState: String(updated.project_mapping_state),
            projectOwner: String(updated.project_owner),
          }),
          ...(closed ? { activityState: 'completed', status: 'done' } : {}),
          ...(resumed ? { activityState: reportedState, status: compatibleTicketStatus(reportedState) } : {}),
        }
        this.lifecycle.transitionWithinTransaction({ ticketId: ticket.id, expectedUpdatedAt: ticket.updatedAt, nextPayload, origin: 'agent-activity:human-override', occurredAt: closed ? now : undefined })
      }
      return this.getAssignment(assignmentKey)!
    })
  }

  private createFirst(event: AssignmentEventV1, projection: EventProjection, receiptCodes: AssignmentEventReceiptCode[], targetTicketId: string, freshnessWindowSeconds: number, now: string): AgentActivityIngestReceipt {
    const assignmentKey = this.assignmentKeyFor(event)
    if (projection.sequence !== 1) return { outcome: 'rejected', assignmentKey, ticketId: targetTicketId, receiptCodes, expectedSequence: 1, reasonCode: 'FIRST_SEQUENCE_REQUIRED', appliedCount: 0 }
    const state = nextReportedState(projection, 'active')
    const project = projectColumns(projection.projectRef)
    const freshUntil = terminalState(state) ? null : addSeconds(projection.observedAt, freshnessWindowSeconds)
    let ticket = this.operational.getTicket(targetTicketId)
    if (!ticket) {
      if (targetTicketId !== ticketIdFor(assignmentKey)) return { outcome: 'rejected', assignmentKey, ticketId: targetTicketId, receiptCodes, expectedSequence: 1, reasonCode: 'TARGET_NOT_FOUND', appliedCount: 0 }
      ticket = this.lifecycle.createWithinTransaction(this.ticketFor(event, targetTicketId, state), 'agent-activity', event.eventId)
    }
    this.operational.linkTicketSource(ticket.id, 'agent-activity', assignmentKey, `agent-activity://${encodeURIComponent(event.integrationId)}/${assignmentKey}`)
    this.db.prepare(`INSERT INTO agent_assignments(
      assignment_key,integration_id,agent_kind,generation,ticket_id,last_applied_sequence,last_event_id,
      reported_state,safe_summary,summary_source,summary_owner,project_mapping_state,project_id,
      project_review_token,project_owner,model_label,last_observed_at,fresh_until,terminal_at,
      terminal_evidence_kind,terminal_outcome,source_update_policy,record_version,created_at,updated_at
    ) VALUES(?,?,?,?,?,1,?,?,?,?,'source',?,?,?,'source',?,?,?,?,?,?,'follow',1,?,?)`)
      .run(
        assignmentKey, event.integrationId, event.agent, event.assignment.generation, ticket.id, projection.eventId, state,
        projection.safeSummary, projection.summarySource, project.state, project.id, project.reviewToken, projection.modelLabel,
        projection.observedAt, freshUntil, terminalState(state) ? projection.observedAt : null,
        projection.terminalEvidenceKind, projection.terminalOutcome, now, now,
      )
    if (projection.projectRef.kind === 'needs-review') {
      this.db.prepare("UPDATE agent_project_reviews SET assignment_key=? WHERE review_token=? AND integration_id=? AND state='pending'")
        .run(assignmentKey, projection.projectRef.reviewToken, event.integrationId)
    }
    this.insertEvent(assignmentKey, projection, 'applied', receiptCodes[0] ?? null, now)
    if (ticket.id !== ticketIdFor(assignmentKey)) this.syncTicket(this.assignmentRow(assignmentKey)!, projection, state)
    this.updateIntegration(event.integrationId, projection.observedAt, now)
    return { outcome: 'applied', assignmentKey, ticketId: ticket.id, receiptCodes }
  }

  private applyProjection(assignmentKey: string, projection: EventProjection, freshnessWindowSeconds: number, now: string): void {
    const current = this.assignmentRow(assignmentKey)
    if (!current) throw new Error('ACTIVITY_ASSIGNMENT_MISSING')
    const state = nextReportedState(projection, String(current.reported_state) as BrowserSafeAssignment['reportedState'])
    const project = String(current.project_owner) === 'human' ? {
      state: String(current.project_mapping_state), id: current.project_id ? String(current.project_id) : null,
      reviewToken: current.project_review_token ? String(current.project_review_token) : null,
    } : projectColumns(projection.projectRef)
    const safeSummary = String(current.summary_owner) === 'human' ? String(current.safe_summary) : projection.safeSummary
    const summarySource = String(current.summary_owner) === 'human' ? String(current.summary_source) : projection.summarySource
    const isTerminal = terminalState(state)
    this.db.prepare(`UPDATE agent_assignments SET last_applied_sequence=?,last_event_id=?,reported_state=?,safe_summary=?,
      summary_source=?,project_mapping_state=?,project_id=?,project_review_token=?,model_label=?,last_observed_at=?,
      fresh_until=?,terminal_at=?,terminal_evidence_kind=?,terminal_outcome=?,record_version=record_version+1,updated_at=?
      WHERE assignment_key=?`)
      .run(
        projection.sequence, projection.eventId, state, safeSummary, summarySource, project.state, project.id, project.reviewToken,
        projection.modelLabel ?? (current.model_label ? String(current.model_label) : null), projection.observedAt,
        isTerminal ? null : addSeconds(projection.observedAt, freshnessWindowSeconds),
        isTerminal ? projection.observedAt : null, projection.terminalEvidenceKind, projection.terminalOutcome, now, assignmentKey,
      )
    const updated = this.assignmentRow(assignmentKey)!
    if (String(updated.source_update_policy) === 'follow') this.syncTicket(updated, projection, state)
    this.updateIntegration(String(updated.integration_id), projection.observedAt, now)
  }

  private syncTicket(assignment: Record<string, unknown>, projection: EventProjection, state: BrowserSafeAssignment['reportedState']): void {
    const ticket = this.operational.getTicket(String(assignment.ticket_id))
    if (!ticket) throw new Error('ACTIVITY_TICKET_MISSING')
    const nextStatus = compatibleTicketStatus(state)
    this.lifecycle.transitionWithinTransaction({
      ticketId: ticket.id,
      expectedUpdatedAt: ticket.updatedAt,
      nextPayload: {
        ...ticket.payload,
        title: String(assignment.safe_summary),
        projectId: assignment.project_id ? String(assignment.project_id) : null,
        projectMappingState: String(assignment.project_mapping_state),
        summaryOwner: String(assignment.summary_owner),
        projectOwner: String(assignment.project_owner),
        activityState: state,
        status: nextStatus,
      },
      origin: 'agent-activity',
      correlationId: projection.eventId,
      occurredAt: terminalState(state) ? projection.observedAt : undefined,
    })
  }

  private insertEvent(assignmentKey: string, projection: EventProjection, applyState: 'applied' | 'pending-gap', receiptCode: string | null, receivedAt: string): void {
    const project = projectColumns(projection.projectRef)
    this.db.prepare(`INSERT INTO agent_assignment_events(
      event_id,assignment_key,sequence,event_kind,reported_state,observed_at,received_at,reason_code,
      evidence_kind,evidence_key,safe_summary,summary_source,project_mapping_state,project_id,
      project_review_token,apply_state,receipt_code,terminal_evidence_kind,terminal_outcome,model_label
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        projection.eventId, assignmentKey, projection.sequence, projection.kind, projection.reportedState ?? null,
        projection.observedAt, receivedAt, projection.reasonCode ?? null, projection.evidenceKind, projection.evidenceKey,
        projection.safeSummary, projection.summarySource, project.state, project.id, project.reviewToken, applyState,
        receiptCode, projection.terminalEvidenceKind, projection.terminalOutcome, projection.modelLabel,
      )
  }

  private projection(event: AssignmentEventV1, assignmentKey: string): EventProjection {
    return {
      eventId: event.eventId,
      sequence: event.observation.sequence,
      kind: event.observation.kind,
      reportedState: event.observation.reportedState,
      observedAt: event.observation.observedAt,
      reasonCode: event.observation.reasonCode,
      evidenceKind: event.observation.evidenceKind,
      evidenceKey: event.observation.originEvidenceId ? this.hmac('evidence', event.integrationId, assignmentKey, event.observation.originEvidenceId) : null,
      safeSummary: event.assignment.summary.text,
      summarySource: event.assignment.summary.source,
      projectRef: event.assignment.projectRef,
      modelLabel: event.modelLabel ?? null,
      terminalEvidenceKind: event.observation.terminalEvidence?.kind ?? null,
      terminalOutcome: event.observation.terminalEvidence?.outcome ?? null,
    }
  }

  private assignmentRow(assignmentKey: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM agent_assignments WHERE assignment_key=?').get(assignmentKey) as Record<string, unknown> | undefined
  }

  private updateIntegration(integrationId: string, observedAt: string, now: string): void {
    this.db.prepare(`UPDATE agent_activity_integrations SET last_attempt_at=?,last_event_at=?,last_success_at=?,
      retained_last_success=0,last_failure_code=NULL,updated_at=? WHERE id=?`).run(now, observedAt, now, now, integrationId)
  }

  getAssignment(assignmentKey: string): BrowserSafeAssignment | undefined {
    const row = this.db.prepare(`SELECT a.*,e.evidence_kind FROM agent_assignments a
      JOIN agent_assignment_events e ON e.event_id=a.last_event_id WHERE a.assignment_key=?`).get(assignmentKey) as Record<string, unknown> | undefined
    if (!row) return undefined
    const mapping = String(row.project_mapping_state)
    const projectRef: BrowserSafeAssignment['projectRef'] = mapping === 'approved-project'
      ? { kind: 'approved-project', id: String(row.project_id) }
      : mapping === 'needs-review'
        ? { kind: 'needs-review', reviewToken: String(row.project_review_token) }
        : { kind: 'unassigned' }
    return {
      assignmentKey: String(row.assignment_key),
      integrationId: String(row.integration_id),
      ticketId: String(row.ticket_id),
      agent: String(row.agent_kind) as AgentKind,
      generation: Number(row.generation),
      safeSummary: String(row.safe_summary),
      summarySource: String(row.summary_source) as SummarySource,
      summaryOwner: String(row.summary_owner) as BrowserSafeAssignment['summaryOwner'],
      projectRef,
      projectOwner: String(row.project_owner) as BrowserSafeAssignment['projectOwner'],
      modelLabel: row.model_label === null ? null : String(row.model_label),
      reportedState: String(row.reported_state) as BrowserSafeAssignment['reportedState'],
      lastAppliedSequence: Number(row.last_applied_sequence),
      lastObservedAt: String(row.last_observed_at),
      freshUntil: row.fresh_until ? String(row.fresh_until) : null,
      terminalAt: row.terminal_at ? String(row.terminal_at) : null,
      terminalEvidenceKind: row.terminal_evidence_kind ? String(row.terminal_evidence_kind) : null,
      terminalOutcome: row.terminal_outcome ? String(row.terminal_outcome) as BrowserSafeAssignment['terminalOutcome'] : null,
      evidenceKind: String(row.evidence_kind) as AssignmentEvidenceKind,
      sourceUpdatePolicy: String(row.source_update_policy) as BrowserSafeAssignment['sourceUpdatePolicy'],
      recordVersion: Number(row.record_version),
    }
  }

  listAssignments(input: { scope: 'active' | 'terminal' | 'all'; limit: number; after?: { lastObservedAt: string; assignmentKey: string } }): { items: AssignmentListRecord[]; total: number } {
    const scopeClause = input.scope === 'active' ? 'terminal_outcome IS NULL' : input.scope === 'terminal' ? 'terminal_outcome IS NOT NULL' : '1=1'
    const afterClause = input.after ? 'AND (last_observed_at < ? OR (last_observed_at = ? AND assignment_key > ?))' : ''
    const parameters: Array<string | number> = []
    if (input.after) parameters.push(input.after.lastObservedAt, input.after.lastObservedAt, input.after.assignmentKey)
    parameters.push(input.limit)
    const rows = this.db.prepare(`SELECT assignment_key FROM agent_assignments WHERE ${scopeClause} ${afterClause}
      ORDER BY last_observed_at DESC,assignment_key ASC LIMIT ?`).all(...parameters) as Array<{ assignment_key: string }>
    const items = rows.map((row) => this.getAssignmentRecord(String(row.assignment_key))!)
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM agent_assignments WHERE ${scopeClause}`).get() as { count: number }).count)
    return { items, total }
  }

  getAssignmentRecord(assignmentKey: string): AssignmentListRecord | undefined {
    const assignment = this.getAssignment(assignmentKey)
    if (!assignment) return undefined
    const ticket = this.operational.getTicket(assignment.ticketId)
    return {
      ...assignment,
      projectLabel: assignment.projectRef.kind === 'approved-project' ? this.approvedProjectLabel(assignment.projectRef.id) : null,
      linkedTicketKind: ticket?.payload.generatedKind === 'sdd-task-execution' ? 'sdd-task-execution' : null,
    }
  }

  assignmentKeyFor(event: AssignmentEventV1): string {
    return this.hmac('assignment', event.integrationId, event.agent, event.assignment.originAssignmentId, String(event.assignment.generation))
  }

  expectedSequenceFor(event: AssignmentEventV1): number {
    const row = this.assignmentRow(this.assignmentKeyFor(event))
    return row ? Number(row.last_applied_sequence) + 1 : 1
  }

  recovery(integrationId: string): { assignments: Array<{ assignmentKey: string; expectedSequence: number }>; snapshots: Array<{ requestId: string; mode: string; state: string }> } {
    const assignments = (this.db.prepare(`SELECT assignment_key,last_applied_sequence FROM agent_assignments
      WHERE integration_id=? AND terminal_outcome IS NULL ORDER BY assignment_key LIMIT 100`).all(integrationId) as Array<Record<string, unknown>>)
      .map((row) => ({ assignmentKey: String(row.assignment_key), expectedSequence: Number(row.last_applied_sequence) + 1 }))
    const snapshots = (this.db.prepare(`SELECT request_id,mode,state FROM agent_activity_snapshots
      WHERE integration_id=? AND state IN ('requested','waiting') ORDER BY requested_at,request_id LIMIT 100`).all(integrationId) as Array<Record<string, unknown>>)
      .map((row) => ({ requestId: String(row.request_id), mode: String(row.mode), state: String(row.state) }))
    return { assignments, snapshots }
  }

  private approvedProjectLabel(projectId: string): string | null {
    const row = this.db.prepare("SELECT label FROM project_folders WHERE id=? AND state='active'").get(projectId) as { label?: string } | undefined
    return row?.label ? String(row.label) : null
  }

  private hmac(...parts: string[]): string {
    return createHmac('sha256', this.identityKey).update(parts.join('\0'), 'utf8').digest('hex')
  }

  private ticketFor(event: AssignmentEventV1, ticketId: string, state: BrowserSafeAssignment['reportedState']): StoredTicket {
    const source = { 'codex-cli': 'Codex', 'claude-code': 'Claude Code', pi: 'Pi' }[event.agent]
    const projectId = event.assignment.projectRef.kind === 'approved-project' ? event.assignment.projectRef.id : null
    const status = compatibleTicketStatus(state)
    return {
      id: ticketId,
      status,
      source,
      origin: 'agent-runtime',
      createdAt: event.observation.observedAt,
      updatedAt: event.observation.observedAt,
      completedAt: null,
      payload: {
        id: ticketId,
        title: event.assignment.summary.text,
        description: `Observed ${source} assignment. Agent activity stores lifecycle metadata only.`,
        status,
        source,
        origin: 'agent-runtime',
        workNotes: [],
        artifacts: [],
        decisionLog: [],
        createdAt: event.observation.observedAt,
        updatedAt: event.observation.observedAt,
        activityState: state,
        projectId,
        projectMappingState: event.assignment.projectRef.kind,
        summaryOwner: 'source',
        projectOwner: 'source',
      },
    }
  }
}

function ticketIdFor(assignmentKey: string): string { return `agent-activity:${assignmentKey.slice(0, 32)}` }

function projectColumns(projectRef: AssignmentEventV1['assignment']['projectRef']): { state: string; id: string | null; reviewToken: string | null } {
  if (projectRef.kind === 'approved-project') return { state: projectRef.kind, id: projectRef.id, reviewToken: null }
  if (projectRef.kind === 'needs-review') return { state: projectRef.kind, id: null, reviewToken: projectRef.reviewToken }
  return { state: projectRef.kind, id: null, reviewToken: null }
}

function projectionFromRow(row: Record<string, unknown>): EventProjection {
  const mapping = String(row.project_mapping_state)
  const projectRef: AssignmentEventV1['assignment']['projectRef'] = mapping === 'approved-project'
    ? { kind: 'approved-project', id: String(row.project_id) }
    : mapping === 'needs-review'
      ? { kind: 'needs-review', reviewToken: String(row.project_review_token) }
      : { kind: 'unassigned' }
  return {
    eventId: String(row.event_id),
    sequence: Number(row.sequence),
    kind: String(row.event_kind) as EventProjection['kind'],
    reportedState: row.reported_state ? String(row.reported_state) as EventProjection['reportedState'] : undefined,
    observedAt: String(row.observed_at),
    reasonCode: row.reason_code ? String(row.reason_code) as EventProjection['reasonCode'] : undefined,
    evidenceKind: String(row.evidence_kind) as AssignmentEvidenceKind,
    evidenceKey: row.evidence_key ? String(row.evidence_key) : null,
    safeSummary: String(row.safe_summary),
    summarySource: String(row.summary_source) as SummarySource,
    projectRef,
    modelLabel: row.model_label ? String(row.model_label) : null,
    terminalEvidenceKind: row.terminal_evidence_kind ? String(row.terminal_evidence_kind) : null,
    terminalOutcome: row.terminal_outcome ? String(row.terminal_outcome) as EventProjection['terminalOutcome'] : null,
  }
}

function nextReportedState(projection: EventProjection, current: BrowserSafeAssignment['reportedState']): BrowserSafeAssignment['reportedState'] {
  if (projection.kind === 'accepted') return 'waiting'
  if (projection.kind === 'started' || projection.kind === 'resumed') return 'active'
  if (projection.kind === 'waiting') return 'waiting'
  if (projection.kind === 'blocked') return 'blocked'
  if (projection.kind === 'needs-action') return 'needs-action'
  if (projection.kind === 'completed' || projection.kind === 'failed' || projection.kind === 'cancelled') return projection.kind
  return projection.reportedState ?? current
}

function compatibleTicketStatus(state: BrowserSafeAssignment['reportedState']): string {
  if (state === 'completed') return 'done'
  if (state === 'blocked' || state === 'needs-action' || state === 'failed' || state === 'cancelled') return 'blocked'
  return 'in-progress'
}

function terminalState(state: BrowserSafeAssignment['reportedState']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

function addSeconds(timestamp: string, seconds: number): string {
  return new Date(Date.parse(timestamp) + seconds * 1_000).toISOString()
}
