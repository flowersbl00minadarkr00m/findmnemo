import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentActivityAgentAuthState, AgentActivityAssignmentPageDto, AgentActivityAssignmentQueryDto, AgentActivityAssignmentUpdateDto, AgentActivityCoverageState, AgentActivityIntegrationAuthState, AgentActivityIntegrationDto,
  AgentActivityManagementReceiptDto, AgentActivityProjectReviewDto, AgentActivitySnapshotDto,
  AgentActivityProjectCandidateDto, AgentActivityTrustState,
} from '../../shared/companion-contract.js'
import type { ProjectFolderSelectionPreview } from '../../shared/lifecycle-contract.js'
import { assertAgentActivityBrowserSafe } from '../../shared/companion-contract.js'
import { parseAssignmentEventV1, type AgentKind, type AssignmentEventV1 } from '../../shared/agent-activity-contract.js'
import type { SecretStore } from '../auth/secret-store.js'
import type { ActivityCapabilityRegistry } from './capability-manifests.js'
import type { IntegrationAuthService } from './integration-auth-service.js'
import { RetrySpool } from './reporter/retry-spool.js'
import type { SnapshotReceipt, SnapshotService } from './snapshot-service.js'
import type { ProjectCandidateProvider } from './project-candidate-provider.js'
import type { AgentActivityCoverageService } from './coverage-service.js'
import type { AgentActivityRuntimeStatuses } from './windows-agent-detector.js'

export interface AgentActivitySetupPort {
  enable(agent: AgentKind): Promise<'configured' | 'unavailable'>
  verify(agent: AgentKind): Promise<boolean>
  remove(agent: AgentKind): Promise<boolean>
}

interface ManagementDependencies {
  db: DatabaseSync
  auth: IntegrationAuthService
  capabilities: ActivityCapabilityRegistry
  snapshots: SnapshotService
  store: SecretStore
  setup?: AgentActivitySetupPort
  candidates?: ProjectCandidateProvider
  detectStatus?: () => Promise<AgentActivityRuntimeStatuses>
  coverage?: AgentActivityCoverageService
  rollout?: { enable(): void }
  clock?: () => Date
}

const AGENTS: readonly AgentKind[] = ['codex-cli', 'claude-code', 'pi']
interface IntegrationEvidence {
  agentAuthState: AgentActivityAgentAuthState
  integrationAuthState: AgentActivityIntegrationAuthState
  trustState: AgentActivityTrustState
  statusCheckedAt: string | null
}

export class AgentActivityManagementService {
  private readonly dependencies: ManagementDependencies
  private readonly clock: () => Date
  private detectionStarted = false
  private runtimeStatus: Partial<AgentActivityRuntimeStatuses> = {}

  constructor(dependencies: ManagementDependencies) { this.dependencies = dependencies; this.clock = dependencies.clock ?? (() => new Date()) }

  initialize(versions: Record<AgentKind, string | null>): void {
    for (const agent of AGENTS) {
      const id = `auto:${agent}`
      const registration = this.dependencies.capabilities.registration(id, agent, versions[agent])
      this.dependencies.db.prepare(`INSERT INTO agent_activity_integrations(id,agent_kind,adapter_version,installed_version,enabled,configured,support_level,freshness_profile,heartbeat_seconds,freshness_window_seconds,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET agent_kind=excluded.agent_kind,adapter_version=excluded.adapter_version,installed_version=excluded.installed_version,
        support_level=excluded.support_level,freshness_profile=excluded.freshness_profile,heartbeat_seconds=excluded.heartbeat_seconds,freshness_window_seconds=excluded.freshness_window_seconds,updated_at=excluded.updated_at`)
        .run(id, agent, registration.adapterVersion, versions[agent], 0, 0, registration.supportLevel ?? 'unsupported', registration.freshnessProfile ?? 'manual', registration.heartbeatSeconds ?? null, registration.freshnessWindowSeconds ?? 900, this.now(), this.now())
    }
  }

  async listIntegrations(): Promise<AgentActivityIntegrationDto[]> {
    await this.refreshDetection()
    const rows = this.dependencies.db.prepare(`SELECT id,agent_kind,installed_version,enabled,configured,support_level,freshness_profile,freshness_window_seconds,
      last_event_at,last_success_at,last_failure_code,retained_last_success,secret_ref FROM agent_activity_integrations WHERE id LIKE 'auto:%' ORDER BY agent_kind`).all() as Array<Record<string, unknown>>
    const result: AgentActivityIntegrationDto[] = []
    for (const row of rows) {
      const id = String(row.id); const agent = String(row.agent_kind) as AgentKind
      const pending = Number((this.dependencies.db.prepare(`SELECT COUNT(*) AS count FROM agent_assignment_events e JOIN agent_assignments a ON a.assignment_key=e.assignment_key WHERE a.integration_id=? AND e.apply_state='pending-gap'`).get(id) as { count: number }).count)
      const gaps = Number((this.dependencies.db.prepare(`SELECT COALESCE(SUM(gap_count),0) AS count FROM agent_activity_snapshots WHERE integration_id=?`).get(id) as { count: number }).count)
      const dto = integrationDto(row, agent, pending, gaps, this.clock(), await this.integrationEvidence(row, agent))
      result.push(dto)
    }
    assertAgentActivityBrowserSafe(result)
    return result
  }

  listAssignments(query: AgentActivityAssignmentQueryDto = {}): AgentActivityAssignmentPageDto {
    return this.dependencies.coverage?.list(query) ?? { items: [], nextCursor: null, total: 0, scope: query.scope ?? 'active' }
  }

  updateAssignment(assignmentKey: string, input: AgentActivityAssignmentUpdateDto) {
    if (!this.dependencies.coverage) throw new Error('ACTIVITY_ASSIGNMENTS_UNAVAILABLE')
    return this.dependencies.coverage.update(assignmentKey, input)
  }

  async enable(integrationId: string, confirmed: boolean): Promise<AgentActivityManagementReceiptDto> {
    confirmation(confirmed); await this.refreshDetection(); const row = this.row(integrationId)
    if (row.support_level === 'unsupported') return this.receipt('enable', integrationId, 'unsupported', false, 'Use manual reporting until this installed version is supported.')
    if (!this.dependencies.setup || await this.dependencies.setup.enable(String(row.agent_kind) as AgentKind) !== 'configured') return this.receipt('enable', integrationId, 'unavailable', false, 'Open the installed FindMnemo app and retry setup.')
    this.dependencies.db.prepare('UPDATE agent_activity_integrations SET configured=1,enabled=1,last_failure_code=NULL,updated_at=? WHERE id=?').run(this.now(), integrationId)
    try { await this.dependencies.auth.issue(integrationId) } catch (cause) { this.dependencies.db.prepare('UPDATE agent_activity_integrations SET configured=0,enabled=0,last_failure_code=?,updated_at=? WHERE id=?').run('CREDENTIAL_STORE_UNAVAILABLE', this.now(), integrationId); throw cause }
    this.dependencies.rollout?.enable()
    return this.receipt('enable', integrationId, 'complete', true, 'Run a safe test, then continue work in the agent.')
  }

  async test(integrationId: string): Promise<AgentActivityManagementReceiptDto> {
    const row = this.row(integrationId)
    if (!row.enabled || !row.configured) return this.receipt('test', integrationId, 'unavailable', false, 'Enable or reconnect this agent first.')
    const token = await this.dependencies.auth.ensure(integrationId)
    if (!await this.dependencies.auth.verify(integrationId, token)) throw new Error('ACTIVITY_AUTH_TEST_FAILED')
    const event = safeTestEvent(row, this.now())
    this.dependencies.capabilities.validate(parseAssignmentEventV1(event).event)
    this.dependencies.db.exec('SAVEPOINT agent_activity_safe_test')
    try {
      this.dependencies.db.prepare('UPDATE agent_activity_integrations SET last_attempt_at=? WHERE id=?').run(this.now(), integrationId)
      this.dependencies.db.exec('ROLLBACK TO agent_activity_safe_test')
    } finally { this.dependencies.db.exec('RELEASE agent_activity_safe_test') }
    this.dependencies.db.prepare('UPDATE agent_activity_integrations SET last_attempt_at=?,last_success_at=?,last_failure_code=NULL,retained_last_success=0,updated_at=? WHERE id=?').run(this.now(), this.now(), this.now(), integrationId)
    return this.receipt('test', integrationId, 'complete', false, 'Validation passed without creating a ticket.')
  }

  async pause(integrationId: string, confirmed: boolean): Promise<AgentActivityManagementReceiptDto> { confirmation(confirmed); this.row(integrationId); this.dependencies.db.prepare('UPDATE agent_activity_integrations SET enabled=0,updated_at=? WHERE id=?').run(this.now(), integrationId); return this.receipt('pause', integrationId, 'complete', true, 'Tracking is paused; existing tickets are unchanged.') }

  async reconnect(integrationId: string, confirmed: boolean): Promise<AgentActivityManagementReceiptDto> {
    confirmation(confirmed); const row = this.row(integrationId)
    if (!this.dependencies.setup || !await this.dependencies.setup.verify(String(row.agent_kind) as AgentKind)) return this.receipt('reconnect', integrationId, 'unavailable', false, 'Repair the FindMnemo-owned setup from the installed app.')
    this.dependencies.db.prepare('UPDATE agent_activity_integrations SET configured=1,enabled=1,last_failure_code=NULL,updated_at=? WHERE id=?').run(this.now(), integrationId)
    try { await this.dependencies.auth.ensure(integrationId) } catch { await this.dependencies.auth.issue(integrationId) }
    this.dependencies.rollout?.enable()
    return this.receipt('reconnect', integrationId, 'complete', true, 'Connection restored; last successful state was retained.')
  }

  async remove(integrationId: string, confirmed: boolean): Promise<AgentActivityManagementReceiptDto> {
    confirmation(confirmed); const row = this.row(integrationId); const agent = String(row.agent_kind) as AgentKind
    if (this.dependencies.setup) await this.dependencies.setup.remove(agent)
    await this.dependencies.auth.revoke(integrationId)
    await new RetrySpool({ store: this.dependencies.store, integrationId }).clear()
    this.dependencies.db.prepare('UPDATE agent_activity_integrations SET configured=0,enabled=0,last_failure_code=NULL,updated_at=? WHERE id=?').run(this.now(), integrationId)
    return this.receipt('remove', integrationId, 'complete', true, 'FindMnemo-owned setup and retry data were removed; tickets and project folders remain.')
  }

  async snapshot(integrationId: string): Promise<AgentActivityManagementReceiptDto> {
    const row = this.row(integrationId)
    if (row.support_level === 'unsupported') return this.receipt('snapshot', integrationId, 'unsupported', false, 'This installed version is not qualified for automatic snapshots. Use manual reporting instead.')
    const agent = String(row.agent_kind) as AgentKind
    const evidence = await this.integrationEvidence(row, agent)
    if (evidence.agentAuthState === 'signed-out') return this.receipt('snapshot', integrationId, 'unavailable', false, `Sign in to ${agent === 'claude-code' ? 'Claude Code' : 'Codex'} before requesting automatic current-work coverage.`)
    if (evidence.agentAuthState === 'unavailable' || evidence.integrationAuthState !== 'ready' || evidence.trustState === 'untrusted' || evidence.trustState === 'unavailable') return this.receipt('snapshot', integrationId, 'unavailable', false, 'Repair the specific account, FindMnemo credential, or owned setup state shown for this agent first.')
    const mode = row.agent_kind === 'pi' ? 'current-session' : 'next-interaction'
    const snapshot = snapshotDto(this.dependencies.snapshots.request({ integrationId, mode }))
    return { ...this.receipt('snapshot', integrationId, snapshot.state === 'complete' ? 'complete' : 'waiting', true, snapshot.limitation), snapshot }
  }

  clearHistory(integrationId: string, confirmed: boolean): AgentActivityManagementReceiptDto {
    confirmation(confirmed); this.row(integrationId)
    const result = this.dependencies.db.prepare(`DELETE FROM agent_assignment_events
      WHERE apply_state='applied'
        AND assignment_key IN (SELECT assignment_key FROM agent_assignments WHERE integration_id=?)
        AND event_id NOT IN (SELECT last_event_id FROM agent_assignments)
        AND assignment_key NOT IN (SELECT assignment_key FROM agent_project_reviews WHERE state='pending' AND assignment_key IS NOT NULL)`).run(integrationId)
    return this.receipt('clear-history', integrationId, 'complete', Number(result.changes) > 0, 'Nonessential source event history was cleared; current, gap, review, terminal, ticket, and project evidence remain.')
  }

  async discoverProjectCandidates(): Promise<{ state: 'ready' | 'unavailable'; candidates: AgentActivityProjectCandidateDto[]; errorCode?: string }> {
    if (!this.dependencies.candidates) return { state: 'unavailable', candidates: [], errorCode: 'PROJECT_REGISTRY_UNAVAILABLE' }
    const result = await this.dependencies.candidates.discover(); assertAgentActivityBrowserSafe(result); return result
  }

  async previewProjectCandidates(ids: readonly string[]): Promise<ProjectFolderSelectionPreview> {
    if (!this.dependencies.candidates) return { state: 'unavailable', items: [], confirmationRequired: false, errorCode: 'PROJECT_REGISTRY_UNAVAILABLE' }
    const result = await this.dependencies.candidates.preview(ids); assertAgentActivityBrowserSafe(result); return result
  }

  commitProjectCandidates(previewId: string, confirmed: boolean) {
    confirmation(confirmed)
    if (!this.dependencies.candidates) return { committed: false, folderIds: [], errorCode: 'PROJECT_REGISTRY_UNAVAILABLE' }
    return this.dependencies.candidates.commit(previewId, true)
  }

  listReviews(): AgentActivityProjectReviewDto[] {
    const rows = this.dependencies.db.prepare('SELECT review_token,integration_id,state,candidate_count,resolved_project_id,created_at,resolved_at FROM agent_project_reviews ORDER BY created_at DESC LIMIT 100').all() as Array<Record<string, unknown>>
    const result = rows.map((row) => ({ id: String(row.review_token), integrationId: String(row.integration_id), state: String(row.state) as AgentActivityProjectReviewDto['state'], candidateCount: Number(row.candidate_count), resolvedProjectId: row.resolved_project_id ? String(row.resolved_project_id) : null, createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null }))
    assertAgentActivityBrowserSafe(result); return result
  }

  resolveReview(reviewId: string, projectId: string | null, confirmed: boolean): AgentActivityManagementReceiptDto {
    confirmation(confirmed)
    const review = this.dependencies.db.prepare("SELECT assignment_key FROM agent_project_reviews WHERE review_token=? AND state='pending'").get(reviewId) as { assignment_key?: string | null } | undefined
    if (!review) throw new Error('PROJECT_REVIEW_NOT_FOUND')
    if (review.assignment_key) {
      if (!this.dependencies.coverage) throw new Error('ACTIVITY_ASSIGNMENTS_UNAVAILABLE')
      const assignment = this.dependencies.coverage.get(String(review.assignment_key))
      if (!assignment) throw new Error('ACTIVITY_ASSIGNMENT_NOT_FOUND')
      this.dependencies.coverage.update(String(review.assignment_key), {
        expectedVersion: assignment.recordVersion,
        project: projectId ? { kind: 'approved-project', id: projectId } : { kind: 'unassigned' },
      })
    }
    const result = this.dependencies.db.prepare(`UPDATE agent_project_reviews SET state=?,resolved_project_id=?,resolved_at=? WHERE review_token=? AND state='pending'`).run(projectId ? 'resolved' : 'dismissed', projectId, this.now(), reviewId)
    if (Number(result.changes) !== 1) throw new Error('PROJECT_REVIEW_NOT_FOUND')
    return this.receipt('project-review', null, 'complete', true, projectId ? 'Project association approved.' : 'Assignment remains Unassigned.')
  }

  private row(integrationId: string): Record<string, unknown> { const row = this.dependencies.db.prepare("SELECT * FROM agent_activity_integrations WHERE id=? AND id LIKE 'auto:%'").get(integrationId) as Record<string, unknown> | undefined; if (!row) throw new Error('ACTIVITY_INTEGRATION_NOT_FOUND'); return row }
  private async refreshDetection(): Promise<void> {
    if (this.detectionStarted || !this.dependencies.detectStatus) return
    this.detectionStarted = true
    try {
      const status = await this.dependencies.detectStatus()
      this.runtimeStatus = status
      this.initialize(Object.fromEntries(AGENTS.map((agent) => [agent, status[agent].installedVersion])) as Record<AgentKind, string | null>)
    } catch { /* Existing unsupported/manual evidence remains honest. */ }
  }
  private async integrationEvidence(row: Record<string, unknown>, agent: AgentKind): Promise<IntegrationEvidence> {
    const supported = row.support_level !== 'unsupported'
    const configured = Boolean(row.configured)
    const runtime = this.runtimeStatus[agent]
    let integrationAuthState: AgentActivityIntegrationAuthState = 'not-configured'
    if (configured) {
      if (!row.secret_ref) integrationAuthState = 'missing'
      else {
        try { integrationAuthState = await this.dependencies.store.has(String(row.secret_ref)) ? 'ready' : 'missing' }
        catch { integrationAuthState = 'unavailable' }
      }
    }
    let trustState: AgentActivityTrustState = 'not-applicable'
    if (supported && configured) {
      if (row.last_event_at) trustState = 'trusted'
      else if (!this.dependencies.setup) trustState = 'unavailable'
      else {
        try { trustState = await this.dependencies.setup.verify(agent) ? 'unknown' : 'untrusted' }
        catch { trustState = 'unavailable' }
      }
    }
    return {
      agentAuthState: runtime?.agentAuthState ?? (row.installed_version ? 'unknown' : 'not-applicable'),
      integrationAuthState,
      trustState,
      statusCheckedAt: runtime?.checkedAt ?? null,
    }
  }
  private now(): string { return this.clock().toISOString() }
  private receipt(operation: AgentActivityManagementReceiptDto['operation'], integrationId: string | null, outcome: AgentActivityManagementReceiptDto['outcome'], changed: boolean, nextAction: string): AgentActivityManagementReceiptDto { const coverageState = integrationId ? coverage(this.row(integrationId), 0, 0, this.clock()) : null; return { operation, integrationId, outcome, completedAt: this.now(), changed, coverageState, nextAction } }
}

function integrationDto(row: Record<string, unknown>, agent: AgentKind, pending: number, gaps: number, now: Date, evidence: IntegrationEvidence): AgentActivityIntegrationDto {
  const supportLevel = String(row.support_level) as AgentActivityIntegrationDto['supportLevel']; const state = coverage(row, pending, gaps, now, evidence)
  const configured = Boolean(row.configured); const enabled = Boolean(row.enabled); const supported = supportLevel !== 'unsupported'
  const snapshot = supported ? agent === 'pi' ? 'current-session' : 'next-interaction' : 'none'
  return {
    id: String(row.id), agent, label: agent === 'codex-cli' ? 'Codex' : agent === 'claude-code' ? 'Claude Code' : 'Pi', installedVersion: row.installed_version ? String(row.installed_version) : null,
    supported, configured, enabled, ...evidence, supportLevel, coverageState: state,
    coverageExplanation: explanation(state, evidence, agent), capabilities: { detection: Boolean(row.installed_version), manual: true, snapshot, automaticEvents: supportLevel.startsWith('automatic') ? 'partial' : 'none', automaticTerminal: supportLevel === 'automatic-task-terminal' ? 'task-only' : 'none' },
    freshnessProfile: String(row.freshness_profile), freshnessWindowSeconds: Number(row.freshness_window_seconds), lastEventAt: row.last_event_at ? String(row.last_event_at) : null,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null, retainedLastSuccess: Boolean(row.retained_last_success), pendingEventCount: pending, gapCount: gaps,
    failureCode: row.last_failure_code ? String(row.last_failure_code) : null,
    primaryAction: !supported ? 'manual-report' : evidence.agentAuthState === 'signed-out' ? 'sign-in' : evidence.agentAuthState === 'unavailable' ? 'check-status' : !configured ? 'enable' : !enabled ? 'resume' : evidence.integrationAuthState !== 'ready' || evidence.trustState === 'untrusted' || evidence.trustState === 'unavailable' || row.last_failure_code ? 'reconnect' : gaps || pending ? 'review-gap' : evidence.trustState === 'unknown' ? 'check-status' : 'test',
  }
}

function coverage(row: Record<string, unknown>, pending: number, gaps: number, now: Date, evidence?: IntegrationEvidence): AgentActivityCoverageState {
  if (row.support_level === 'unsupported') return 'unsupported'
  if (evidence?.agentAuthState === 'signed-out' || evidence?.agentAuthState === 'unavailable') return 'unavailable'
  if (Boolean(row.configured) && evidence && evidence.integrationAuthState !== 'ready') return 'unavailable'
  if (evidence?.trustState === 'untrusted' || evidence?.trustState === 'unavailable') return 'unavailable'
  if (row.last_failure_code && !row.last_success_at) return 'unavailable'
  if (!row.configured || !row.enabled) return 'unavailable'
  if (pending || gaps) return 'partial'
  if (evidence?.trustState === 'unknown' && !row.last_event_at) return 'partial'
  if (!row.last_event_at) return 'empty'
  const staleAt = Date.parse(String(row.last_event_at)) + Number(row.freshness_window_seconds) * 1_000
  if (staleAt < now.getTime()) return 'stale'
  return 'connected'
}
function explanation(state: AgentActivityCoverageState, evidence: IntegrationEvidence, agent: AgentKind): string {
  const label = agent === 'codex-cli' ? 'Codex' : agent === 'claude-code' ? 'Claude Code' : 'Pi'
  if (evidence.agentAuthState === 'signed-out') return `${label} is signed out. FindMnemo connection credentials are separate and existing tickets are retained.`
  if (evidence.agentAuthState === 'unavailable') return `${label} account status could not be checked safely. Existing tickets are retained.`
  if (evidence.integrationAuthState === 'missing') return 'The FindMnemo activity credential is missing; reconnect without changing the agent account.'
  if (evidence.integrationAuthState === 'unavailable') return 'FindMnemo could not verify its local activity credential; reconnect from the installed app.'
  if (evidence.trustState === 'untrusted') return 'The owned setup is missing or invalid and has not delivered a trusted event.'
  if (evidence.trustState === 'unavailable') return 'FindMnemo could not verify its owned local setup.'
  if (evidence.trustState === 'unknown' && state === 'partial') return 'FindMnemo setup is present, but hook delivery is not verified until the next safe agent event.'
  return ({ connected: 'Recent supported activity was received.', empty: 'Connected, but no assignment has been observed in the stated window.', partial: 'Some activity is covered, with a queue or sequence gap to review.', stale: 'The last successful state is retained, but its freshness window expired.', unavailable: 'Automatic tracking is not currently available; existing tickets are retained.', unsupported: 'This installed version is not qualified for automatic tracking; manual reporting remains available.' })[state]
}
function confirmation(value: boolean): void { if (value !== true) throw new Error('LOCAL_CONFIRMATION_REQUIRED') }
function snapshotDto(value: SnapshotReceipt): AgentActivitySnapshotDto { return { id: value.requestId, integrationId: value.integrationId, mode: value.mode, state: value.state, requestedAt: value.requestedAt, coverageStartedAt: value.coverageStartedAt, coverageEndedAt: value.coverageEndedAt, assignmentsObserved: value.assignmentsObserved, gapCount: value.gapCount, failureCode: value.failureCode, limitation: value.limitation } }
function safeTestEvent(row: Record<string, unknown>, now: string): AssignmentEventV1 { const agent = String(row.agent_kind) as AgentKind; const evidence = agent === 'pi' ? 'pi-extension' : agent === 'claude-code' ? 'claude-hook' : 'codex-hook'; return { schema: 'findmnemo.assignment-event.v1', eventId: randomUUID(), integrationId: String(row.id), agent, adapterVersion: String(row.adapter_version), agentVersion: row.installed_version ? String(row.installed_version) : null, assignment: { originAssignmentId: 'validation-only', generation: 1, summary: { text: `${agent} validation only`, source: 'placeholder' }, projectRef: { kind: 'unassigned' } }, observation: { sequence: 1, kind: 'accepted', reportedState: 'active', observedAt: now, evidenceKind: evidence } } }
