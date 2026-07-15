import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AssignmentEventV1 } from '../../shared/agent-activity-contract.js'
import type { OperationalRepository, StoredTicket } from '../db/operational-repository.js'
import type { ProjectFolderRecord, ProjectFolderRepository } from '../onboarding/project-folder-repository.js'
import type { ActivityAssociationResolver } from './agent-activity-service.js'

export type ProjectContextResult = AssignmentEventV1['assignment']['projectRef']

export class ProjectAssociationService implements ActivityAssociationResolver {
  private readonly db: DatabaseSync
  private readonly folders: ProjectFolderRepository
  private readonly operational: OperationalRepository
  private readonly clock: () => Date

  constructor(db: DatabaseSync, folders: ProjectFolderRepository, operational: OperationalRepository, clock: () => Date = () => new Date()) {
    this.db = db
    this.folders = folders
    this.operational = operational
    this.clock = clock
  }

  resolveContext(input: { integrationId: string; cwd: string }): ProjectContextResult {
    if (!validIntegrationId(input.integrationId) || !this.integrationExists(input.integrationId)) throw new Error('ACTIVITY_INTEGRATION_NOT_ENABLED')
    if (typeof input.cwd !== 'string' || !input.cwd || input.cwd.length > 2_048 || input.cwd.includes('\0')) throw new Error('INVALID_PROJECT_CONTEXT')
    const cwd = canonical(input.cwd)
    const matches = this.folders.list()
      .filter((folder) => folder.state === 'active')
      .map((folder) => ({ folder, path: canonical(folder.canonicalPath) }))
      .filter(({ path }) => sameOrInside(path, cwd))
    if (!matches.length) return { kind: 'unassigned' }
    const deepest = Math.max(...matches.map(({ path }) => path.length))
    const winners = matches.filter(({ path }) => path.length === deepest)
    if (winners.length !== 1 || unavailable(winners[0].folder)) return this.createReview(input.integrationId, winners.length)
    return { kind: 'approved-project', id: winners[0].folder.id }
  }

  resolve(event: AssignmentEventV1): { event: AssignmentEventV1; ticketId?: string; reasonCode?: string } {
    const projectReason = this.validateProjectRef(event)
    if (projectReason) return { event, reasonCode: projectReason }
    const target = event.assignment.targetRef
    if (!target) return { event }
    if (target.kind === 'ticket') return this.resolveTicket(event, target.ticketId)
    if (event.assignment.projectRef.kind !== 'approved-project' || event.assignment.projectRef.id !== target.projectId) {
      return { event, reasonCode: 'TARGET_PROJECT_MISMATCH' }
    }
    const externalId = `${target.projectId}:spec:${target.specId}:task:${target.taskId}`
    const deterministicId = `ticket:sdd-task:${target.projectId}:${target.specId}:${target.taskId}`
    const deterministic = this.operational.getTicket(deterministicId)
    const linked = this.operational.ticketSourceLink('project-folders', externalId)
    if (deterministic && linked && linked.ticketId !== deterministic.id) return { event, reasonCode: 'TARGET_CONFLICT' }
    const ticket = deterministic ?? (linked ? this.operational.getTicket(linked.ticketId) : undefined)
    if (!ticket) return { event, reasonCode: 'SDD_TARGET_NOT_FOUND' }
    if (isGate(ticket)) return { event, ticketId: ticket.id, reasonCode: 'GATE_TARGET_FORBIDDEN' }
    if (deterministic && ticket.payload.generatedKind !== 'sdd-task-execution') return { event, ticketId: ticket.id, reasonCode: 'SDD_TARGET_INVALID' }
    return { event, ticketId: ticket.id }
  }

  private resolveTicket(event: AssignmentEventV1, ticketId: string): { event: AssignmentEventV1; ticketId?: string; reasonCode?: string } {
    const ticket = this.operational.getTicket(ticketId)
    if (!ticket) return { event, ticketId, reasonCode: 'TARGET_NOT_FOUND' }
    if (isGate(ticket)) return { event, ticketId, reasonCode: 'GATE_TARGET_FORBIDDEN' }
    return { event, ticketId }
  }

  private validateProjectRef(event: AssignmentEventV1): string | undefined {
    const project = event.assignment.projectRef
    if (project.kind === 'unassigned') return undefined
    if (project.kind === 'needs-review') {
      const review = this.db.prepare("SELECT integration_id FROM agent_project_reviews WHERE review_token=? AND state='pending'").get(project.reviewToken) as { integration_id?: string } | undefined
      return review?.integration_id === event.integrationId ? undefined : 'PROJECT_REVIEW_INVALID'
    }
    const folder = this.folders.get(project.id)
    if (!folder || folder.state !== 'active') return 'PROJECT_NOT_APPROVED'
    if (unavailable(folder)) return 'PROJECT_REVIEW_REQUIRED'
    return undefined
  }

  private createReview(integrationId: string, candidateCount: number): Extract<ProjectContextResult, { kind: 'needs-review' }> {
    const reviewToken = randomUUID()
    this.db.prepare(`INSERT INTO agent_project_reviews(review_token,integration_id,assignment_key,state,candidate_count,resolved_project_id,created_at,resolved_at)
      VALUES(?, ?, NULL, 'pending', ?, NULL, ?, NULL)`).run(reviewToken, integrationId, candidateCount, this.clock().toISOString())
    return { kind: 'needs-review', reviewToken }
  }

  private integrationExists(integrationId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM agent_activity_integrations WHERE id=? AND enabled=1 AND configured=1').get(integrationId))
  }
}

function canonical(path: string): string {
  try { return resolve(realpathSync.native(path)) } catch { return resolve(path) }
}

function sameOrInside(parent: string, child: string): boolean {
  const relation = relative(parent, child)
  return relation === '' || (!relation.startsWith('..') && !relation.includes(':'))
}

function unavailable(folder: ProjectFolderRecord): boolean {
  return folder.detectedKind === 'unavailable' || folder.lastErrorCode === 'FOLDER_UNAVAILABLE'
}

function isGate(ticket: StoredTicket): boolean { return ticket.payload.generatedKind === 'sdd-gate-placeholder' }
function validIntegrationId(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value) }
