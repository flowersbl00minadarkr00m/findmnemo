import type {
  AgentActivityAssignmentPageDto,
  AgentActivityAssignmentQueryDto,
  AgentActivityAssignmentSummaryDto,
  AgentActivityAssignmentUpdateDto,
} from '../../shared/companion-contract.js'
import { assertAgentActivityBrowserSafe } from '../../shared/companion-contract.js'
import { AgentActivityRepository, type AssignmentListRecord, type BrowserSafeAssignment } from './agent-activity-repository.js'

export interface AssignmentCoverageProjection extends BrowserSafeAssignment {
  effectiveState: BrowserSafeAssignment['reportedState'] | 'stale'
  retainedLastReportedState: BrowserSafeAssignment['reportedState']
}

export class AgentActivityCoverageService {
  private readonly repository: AgentActivityRepository
  private readonly clock: () => Date

  constructor(repository: AgentActivityRepository, clock: () => Date = () => new Date()) {
    this.repository = repository
    this.clock = clock
  }

  get(assignmentKey: string): AssignmentCoverageProjection | undefined {
    const assignment = this.repository.getAssignment(assignmentKey)
    if (!assignment) return undefined
    const terminal = assignment.terminalOutcome !== null
    const stale = !terminal && assignment.freshUntil !== null && Date.parse(assignment.freshUntil) < this.clock().getTime()
    return { ...assignment, effectiveState: stale ? 'stale' : assignment.reportedState, retainedLastReportedState: assignment.reportedState }
  }

  list(query: AgentActivityAssignmentQueryDto = {}): AgentActivityAssignmentPageDto {
    const scope = query.scope ?? 'active'
    if (!['active', 'terminal', 'all'].includes(scope)) throw new Error('INVALID_ASSIGNMENT_SCOPE')
    const limit = query.limit === undefined ? 25 : query.limit
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('INVALID_ASSIGNMENT_LIMIT')
    const after = query.cursor ? decodeCursor(query.cursor) : undefined
    const result = this.repository.listAssignments({ scope, limit: limit + 1, after })
    const hasNext = result.items.length > limit
    const selected = result.items.slice(0, limit)
    const page: AgentActivityAssignmentPageDto = {
      items: selected.map((assignment) => this.dto(assignment)),
      nextCursor: hasNext ? encodeCursor(selected[selected.length - 1]) : null,
      total: result.total,
      scope,
    }
    assertAgentActivityBrowserSafe(page)
    return page
  }

  update(assignmentKey: string, input: AgentActivityAssignmentUpdateDto): AgentActivityAssignmentSummaryDto {
    if (!/^[a-f0-9]{64}$/.test(assignmentKey)) throw new Error('INVALID_ASSIGNMENT_KEY')
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error('INVALID_ASSIGNMENT_VERSION')
    const projectRef = input.project?.kind === 'approved-project'
      ? { kind: 'approved-project' as const, id: input.project.id }
      : input.project?.kind === 'unassigned' ? { kind: 'unassigned' as const } : undefined
    const updated = this.repository.updateHumanOverride(assignmentKey, {
      expectedVersion: input.expectedVersion,
      safeSummary: input.safeSummary,
      projectRef,
      sourceUpdatePolicy: input.sourceUpdatePolicy,
    })
    const record = this.repository.getAssignmentRecord(updated.assignmentKey) ?? this.enrich(updated)
    const dto = this.dto(record)
    assertAgentActivityBrowserSafe(dto)
    return dto
  }

  private dto(assignment: AssignmentListRecord): AgentActivityAssignmentSummaryDto {
    const projected = this.project(assignment)
    return {
      id: assignment.assignmentKey,
      integrationId: assignment.integrationId,
      ticketId: assignment.ticketId,
      agent: assignment.agent,
      agentLabel: agentLabel(assignment.agent),
      summary: assignment.safeSummary,
      summaryOwner: assignment.summaryOwner,
      project: assignment.projectRef.kind === 'approved-project'
        ? { kind: 'approved-project', id: assignment.projectRef.id, label: assignment.projectLabel ?? 'Project unavailable' }
        : assignment.projectRef.kind === 'needs-review'
          ? { kind: 'needs-review', reviewId: assignment.projectRef.reviewToken }
          : { kind: 'unassigned' },
      projectOwner: assignment.projectOwner,
      modelLabel: assignment.modelLabel,
      effectiveState: projected.effectiveState,
      retainedLastState: assignment.reportedState,
      lastObservedAt: assignment.lastObservedAt,
      freshUntil: assignment.freshUntil,
      terminalAt: assignment.terminalAt,
      terminalEvidence: assignment.terminalEvidenceKind,
      terminalOutcome: assignment.terminalOutcome,
      evidenceKind: assignment.evidenceKind,
      sourceUpdatePolicy: assignment.sourceUpdatePolicy,
      recordVersion: assignment.recordVersion,
      linkedTicketKind: assignment.linkedTicketKind,
    }
  }

  private project<T extends BrowserSafeAssignment>(assignment: T): T & { effectiveState: BrowserSafeAssignment['reportedState'] | 'stale' } {
    const terminal = assignment.terminalOutcome !== null
    const stale = !terminal && assignment.freshUntil !== null && Date.parse(assignment.freshUntil) < this.clock().getTime()
    return { ...assignment, effectiveState: stale ? 'stale' : assignment.reportedState }
  }

  private enrich(assignment: BrowserSafeAssignment): AssignmentListRecord {
    return { ...assignment, projectLabel: null, linkedTicketKind: null }
  }
}

function agentLabel(agent: BrowserSafeAssignment['agent']): string {
  return agent === 'codex-cli' ? 'Codex' : agent === 'claude-code' ? 'Claude Code' : 'Pi'
}

function encodeCursor(assignment: BrowserSafeAssignment): string {
  return Buffer.from(JSON.stringify({ observedAt: assignment.lastObservedAt, id: assignment.assignmentKey }), 'utf8').toString('base64url')
}

function decodeCursor(value: string): { lastObservedAt: string; assignmentKey: string } {
  if (value.length > 512) throw new Error('INVALID_ASSIGNMENT_CURSOR')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { observedAt?: unknown; id?: unknown }
    if (typeof parsed.observedAt !== 'string' || !Number.isFinite(Date.parse(parsed.observedAt)) || typeof parsed.id !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.id)) throw new Error('invalid')
    return { lastObservedAt: parsed.observedAt, assignmentKey: parsed.id }
  } catch { throw new Error('INVALID_ASSIGNMENT_CURSOR') }
}
