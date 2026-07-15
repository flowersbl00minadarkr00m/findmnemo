import {
  COMPANION_PROTOCOL_VERSION,
  type CompanionApiResponse,
  type CompanionConnectionState,
  type CompanionIdentityDto,
  type OnboardingSnapshotDto,
  type DestinationDiscoveryDto,
  type DestinationModelCatalogDto,
  type GmailCandidateDto,
  type GmailCheckDto,
  type GmailTicketAssociationDto,
  type OperationalPolicyMigrationPreview,
  type OperationalRoutingPolicy,
  type ProfileReadinessResultDto,
  type RoutingDispatchReceiptDto,
  type ReconciliationRunDto,
  type SourceDescriptor,
  type SourceId,
  type UsageCapabilityDto,
  type UsageRefreshRunDto,
  type UsageQueryDto,
  type UsageSummaryDto,
  type UsageRecordsPageDto,
  type UsageCoverageDto,
  type UsageManualMappingDto,
  type UsageRouteObservationDto,
  type DataCategoryId,
  type DataExportPreviewDto,
  type DataImportPreviewDto,
  type DataPortabilityReceiptDto,
  type CompletedWorkQueryDto,
  type CompletedWorkResultDto,
  type RoutingConnectionSummaryDto,
  type RoutingConnectionCatalogDto,
  type OperationalRoutingPolicyV3,
  type RoutingProfileV3,
  type ProjectFolderSummaryDto,
  type AgentActivityIntegrationDto,
  type AgentActivityAssignmentPageDto,
  type AgentActivityAssignmentQueryDto,
  type AgentActivityAssignmentSummaryDto,
  type AgentActivityAssignmentUpdateDto,
  type AgentActivityManagementReceiptDto,
  type AgentActivityProjectReviewDto,
} from '../../shared/companion-contract'
import type { GmailSourceStatus } from './operational-repository'
import type { LegacyMigrationRecord, LegacyMigrationResult } from './operational-repository'
import type { Ticket } from '../types'

const COMPANION_BASE_URL = 'http://127.0.0.1:3210/api/v1'
const STALE_AFTER_MS = 2 * 60_000
const SESSION_ROTATION_LEAD_MS = 2 * 60_000

export interface CompanionSession {
  token: string
  browserNonce: string
  expiresAt: string
}

export interface CompanionStatus {
  companion: { state: 'connected'; version: string; instanceId: string }
  database: { state: string }
  gmail: { state: string }
  sources: readonly unknown[]
  checkedAt: string
}

export interface CompanionConnectionEvidence {
  identity?: CompanionIdentityDto
  session?: CompanionSession
  status?: CompanionStatus
  lastSuccessfulAt?: string
  permission?: 'prompt' | 'granted' | 'denied' | 'unsupported'
  error?: string
}

export class CompanionApiRequestError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = 'CompanionApiRequestError'
    this.code = code
  }
}

function browserNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function request<T>(path: string, init: RequestInit = {}, session?: CompanionSession): Promise<CompanionApiResponse<T>> {
  const headers = new Headers(init.headers)
  headers.set('x-findmnemo-protocol-version', COMPANION_PROTOCOL_VERSION)
  if (session) {
    headers.set('authorization', `Bearer ${session.token}`)
    headers.set('x-findmnemo-browser-nonce', session.browserNonce)
  }
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(`${COMPANION_BASE_URL}${path}`, { ...init, headers, redirect: 'error' })
  return await response.json() as CompanionApiResponse<T>
}

export function deriveCompanionConnectionState(
  evidence: CompanionConnectionEvidence,
  now = Date.now(),
): CompanionConnectionState {
  if (evidence.permission === 'unsupported') return 'unsupported'
  if (evidence.permission === 'denied') return 'permission-denied'
  if (evidence.permission === 'prompt' && !evidence.identity) return 'permission-required'
  if (evidence.error && !evidence.identity) return 'error'
  if (!evidence.identity) return 'not-installed'
  if (!evidence.session) return 'pairing-required'
  if (!evidence.status) return 'error'
  const successfulAt = Date.parse(evidence.lastSuccessfulAt ?? evidence.status.checkedAt)
  return Number.isFinite(successfulAt) && now - successfulAt > STALE_AFTER_MS ? 'stale' : 'connected'
}

export async function getCompanionIdentity(): Promise<CompanionIdentityDto> {
  const response = await request<CompanionIdentityDto>('/identity')
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'IDENTITY_MISMATCH')
  return response.data
}

export async function pairCompanion(code: string, nonce = browserNonce()): Promise<CompanionSession> {
  const response = await request<{ token: string; expiresAt: string }>('/pairing/session', {
    method: 'POST',
    body: JSON.stringify({ code: code.replaceAll(/\s/g, ''), browserNonce: nonce }),
  })
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'PAIRING_CODE_INVALID')
  return { ...response.data, browserNonce: nonce }
}

export async function bootstrapLocalCompanion(nonce = browserNonce()): Promise<CompanionSession | undefined> {
  const bootstrapNonce = document.querySelector<HTMLMetaElement>('meta[name="findmnemo-local-bootstrap"]')?.content
  if (!bootstrapNonce) return undefined
  const response = await request<{ token: string; expiresAt: string }>('/local-session', {
    method: 'POST',
    body: JSON.stringify({ bootstrapNonce, browserNonce: nonce }),
  })
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'PAIRING_CODE_INVALID')
  return { ...response.data, browserNonce: nonce }
}

export function hasLocalBootstrapEvidence(): boolean {
  return Boolean(document.querySelector<HTMLMetaElement>('meta[name="findmnemo-local-bootstrap"]')?.content)
}

export async function getCompanionStatus(session: CompanionSession): Promise<CompanionStatus> {
  const response = await request<CompanionStatus>('/status', {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SESSION_INVALID')
  return response.data
}

export async function rotateCompanionSession(session: CompanionSession): Promise<CompanionSession> {
  const response = await request<{ token: string; expiresAt: string }>('/pairing/rotate', { method: 'POST' }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SESSION_INVALID')
  return { ...response.data, browserNonce: session.browserNonce }
}

export function sessionRotationDelay(session: CompanionSession, now = Date.now()): number {
  const expiresAt = Date.parse(session.expiresAt)
  if (!Number.isFinite(expiresAt)) return 0
  return Math.max(0, expiresAt - now - SESSION_ROTATION_LEAD_MS)
}

export async function revokeCompanionSession(session: CompanionSession): Promise<void> {
  await request('/pairing/session', { method: 'DELETE' }, session)
}

export async function listCompanionTickets(session: CompanionSession): Promise<Ticket[]> {
  const response = await request<Ticket[]>('/tickets', {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_UNAVAILABLE')
  return response.data
}

export async function queryCompletedWork(session: CompanionSession, query: CompletedWorkQueryDto): Promise<CompletedWorkResultDto> {
  const parameters = new URLSearchParams({ start: query.startInclusive, end: query.endExclusive, timeZone: query.timeZone, limit: String(query.limit ?? 50) })
  if (query.cursor) parameters.set('cursor', query.cursor)
  const response = await request<CompletedWorkResultDto>(`/completed-work?${parameters}`, {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function exportCompletedWork(session: CompanionSession, query: CompletedWorkQueryDto, format: 'json' | 'csv'): Promise<Blob> {
  const parameters = new URLSearchParams({ start: query.startInclusive, end: query.endExclusive, timeZone: query.timeZone, format })
  const response = await fetch(`${COMPANION_BASE_URL}/completed-work/export?${parameters}`, { headers: { authorization: `Bearer ${session.token}`, 'x-findmnemo-browser-nonce': session.browserNonce, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION }, redirect: 'error' })
  if (!response.ok) throw new CompanionApiRequestError('INVALID_REQUEST', 'Completed-work export failed.')
  return response.blob()
}

export async function createCompanionTicket(session: CompanionSession, ticket: Ticket): Promise<Ticket> {
  const response = await request<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(ticket) }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'INVALID_REQUEST')
  return response.data
}

export async function updateCompanionTicket(session: CompanionSession, ticket: Ticket): Promise<Ticket> {
  const response = await request<Ticket>(`/tickets/${encodeURIComponent(ticket.id)}`, { method: 'PATCH', body: JSON.stringify(ticket) }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'INVALID_REQUEST')
  return response.data
}

export async function deleteCompanionTicket(session: CompanionSession, ticketId: string): Promise<void> {
  const response = await request<{ deleted: boolean }>(`/tickets/${encodeURIComponent(ticketId)}`, { method: 'DELETE' }, session)
  if (response.error || !response.data?.deleted) throw new Error(response.error?.code ?? 'INVALID_REQUEST')
}

export async function listGmailCandidates(session: CompanionSession): Promise<GmailCandidateDto[]> {
  const response = await request<GmailCandidateDto[]>('/email/candidates', {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_UNAVAILABLE')
  return response.data
}

export async function startGmailCheck(session: CompanionSession): Promise<GmailCheckDto> {
  const response = await request<GmailCheckDto>('/gmail/checks', { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_CHECK_FAILED')
  return response.data
}

export async function getGmailCheck(session: CompanionSession, runId: string): Promise<GmailCheckDto> {
  const response = await request<GmailCheckDto>(`/gmail/checks/${encodeURIComponent(runId)}`, {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'RUN_NOT_FOUND')
  return response.data
}

export async function getGmailSourceStatus(session: CompanionSession): Promise<GmailSourceStatus> {
  const response = await request<{ configured: boolean; connected: boolean; credentialCapability?: GmailSourceStatus['credentialCapability']; source: GmailSourceStatus }>('/gmail/status', {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_UNAVAILABLE')
  return { ...response.data.source, configured: response.data.configured, connected: response.data.connected, credentialCapability: response.data.credentialCapability }
}

export async function connectGmail(session: CompanionSession): Promise<string> {
  const response = await request<{ authorizationUrl: string }>('/gmail/connect', { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data?.authorizationUrl) throw new Error(response.error?.code ?? 'OAUTH_DENIED')
  return response.data.authorizationUrl
}

export async function decideGmailCandidate(
  session: CompanionSession,
  candidate: GmailCandidateDto,
  action: 'confirm' | 'dismiss' | 'defer',
): Promise<GmailCandidateDto> {
  const response = await request<GmailCandidateDto>(`/email/candidates/${encodeURIComponent(candidate.threadId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ accountId: candidate.accountId, expectedVersion: candidate.recordVersion, action }),
  }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'INVALID_REQUEST')
  return response.data
}

export async function associateGmailCandidate(
  session: CompanionSession,
  candidate: GmailCandidateDto,
  input: { mode: 'create'; ticket: Ticket } | { mode: 'link'; ticketId: string },
  idempotencyKey: string,
): Promise<GmailTicketAssociationDto> {
  const response = await request<GmailTicketAssociationDto>(`/email/candidates/${encodeURIComponent(candidate.threadId)}/ticket`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ accountId: candidate.accountId, expectedVersion: candidate.recordVersion, ...input }),
  }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'INVALID_REQUEST')
  return response.data
}

export async function listReconciliationSources(session: CompanionSession): Promise<SourceDescriptor[]> {
  const response = await request<SourceDescriptor[]>('/sources', {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_UNAVAILABLE')
  return response.data
}

export async function getOnboardingSnapshot(session: CompanionSession): Promise<OnboardingSnapshotDto> {
  const response = await request<OnboardingSnapshotDto>('/onboarding', {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_UNAVAILABLE')
  return response.data
}

export async function listAgentActivityIntegrations(session: CompanionSession): Promise<AgentActivityIntegrationDto[]> {
  const response = await request<AgentActivityIntegrationDto[]>('/agent-activity/integrations', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function listAgentActivityAssignments(session: CompanionSession, query: AgentActivityAssignmentQueryDto = {}): Promise<AgentActivityAssignmentPageDto> {
  const parameters = new URLSearchParams({ scope: query.scope ?? 'active', limit: String(query.limit ?? 25) })
  if (query.cursor) parameters.set('cursor', query.cursor)
  const response = await request<AgentActivityAssignmentPageDto>(`/agent-activity?${parameters}`, {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function updateAgentActivityAssignment(session: CompanionSession, assignmentId: string, input: AgentActivityAssignmentUpdateDto): Promise<AgentActivityAssignmentSummaryDto> {
  const response = await request<AgentActivityAssignmentSummaryDto>(`/agent-activity/assignments/${encodeURIComponent(assignmentId)}`, { method: 'PATCH', body: JSON.stringify(input) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function manageAgentActivity(session: CompanionSession, integrationId: string, action: 'enable' | 'test' | 'pause' | 'reconnect' | 'remove' | 'snapshot' | 'clear-history', confirmed = false): Promise<AgentActivityManagementReceiptDto> {
  const response = await request<AgentActivityManagementReceiptDto>(`/agent-activity/integrations/${encodeURIComponent(integrationId)}/${action}`, { method: 'POST', body: JSON.stringify({ confirmed }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function listAgentActivityProjectReviews(session: CompanionSession): Promise<AgentActivityProjectReviewDto[]> {
  const response = await request<AgentActivityProjectReviewDto[]>('/agent-activity/project-reviews', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function resolveAgentActivityProjectReview(session: CompanionSession, reviewId: string, projectId: string | null, confirmed: boolean): Promise<AgentActivityManagementReceiptDto> {
  const response = await request<AgentActivityManagementReceiptDto>(`/agent-activity/project-reviews/${encodeURIComponent(reviewId)}`, { method: 'POST', body: JSON.stringify({ projectId, confirmed }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function startOnboardingRefresh(session: CompanionSession, sourceIds: SourceId[]): Promise<ReconciliationRunDto> {
  const response = await request<ReconciliationRunDto>('/onboarding/first-refresh', { method: 'POST', body: JSON.stringify({ sourceIds }) }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_CHECK_FAILED')
  return response.data
}

export async function startReconciliation(session: CompanionSession, sourceIds?: SourceId[]): Promise<ReconciliationRunDto> {
  const response = await request<ReconciliationRunDto>('/reconciliation-runs', { method: 'POST', body: JSON.stringify({ sourceIds }) }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_CHECK_FAILED')
  return response.data
}

export async function getReconciliationRun(session: CompanionSession, runId: string): Promise<ReconciliationRunDto> {
  const response = await request<ReconciliationRunDto>(`/reconciliation-runs/${encodeURIComponent(runId)}`, {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'RUN_NOT_FOUND')
  return response.data
}

export async function listReconciliationRuns(session: CompanionSession): Promise<ReconciliationRunDto[]> {
  const response = await request<ReconciliationRunDto[]>('/reconciliation-runs?limit=20', {}, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'SOURCE_UNAVAILABLE')
  return response.data
}

export async function retryReconciliation(session: CompanionSession, runId: string, sourceIds?: SourceId[]): Promise<ReconciliationRunDto> {
  const response = await request<ReconciliationRunDto>(`/reconciliation-runs/${encodeURIComponent(runId)}/retry`, { method: 'POST', body: JSON.stringify({ sourceIds }) }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'RUN_NOT_FOUND')
  return response.data
}

export async function previewLegacyMigration(session: CompanionSession, records: LegacyMigrationRecord[]): Promise<LegacyMigrationResult> {
  const response = await request<LegacyMigrationResult>('/migration/legacy-tickets/preview', { method: 'POST', body: JSON.stringify({ records }) }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'INVALID_REQUEST')
  return response.data
}

export async function commitLegacyMigration(session: CompanionSession, records: LegacyMigrationRecord[], idempotencyKey: string): Promise<LegacyMigrationResult> {
  const response = await request<LegacyMigrationResult>('/migration/legacy-tickets/commit', { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify({ records }) }, session)
  if (response.error || !response.data) throw new Error(response.error?.code ?? 'INVALID_REQUEST')
  return response.data
}

export async function getOperationalRoutingPolicy(session: CompanionSession): Promise<OperationalRoutingPolicy | null> {
  const response = await request<{ policy: OperationalRoutingPolicy | null }>('/routing/policy', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_POLICY_NOT_FOUND')
  return response.data.policy
}

export async function getUsageCapability(session: CompanionSession): Promise<UsageCapabilityDto> {
  const response = await request<UsageCapabilityDto>('/usage/capability', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_CHECK_FAILED', response.error?.message)
  return response.data
}

export async function startUsageRefresh(session: CompanionSession, input: { since: string; until: string }): Promise<UsageRefreshRunDto> {
  const response = await request<UsageRefreshRunDto>('/usage/refreshes', { method: 'POST', body: JSON.stringify(input) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_CHECK_FAILED', response.error?.message)
  return response.data
}

export async function getUsageRefresh(session: CompanionSession, runId: string): Promise<UsageRefreshRunDto> {
  const response = await request<UsageRefreshRunDto>(`/usage/refreshes/${encodeURIComponent(runId)}`, {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'RUN_NOT_FOUND', response.error?.message)
  return response.data
}

export async function cancelUsageRefresh(session: CompanionSession, runId: string): Promise<UsageRefreshRunDto> {
  const response = await request<UsageRefreshRunDto>(`/usage/refreshes/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'RUN_NOT_FOUND', response.error?.message)
  return response.data
}

function usageSearch(filters: UsageQueryDto): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value !== null) search.set(key, value)
  return search.toString()
}

export async function getUsageSummary(session: CompanionSession, filters: UsageQueryDto): Promise<UsageSummaryDto> {
  const response = await request<UsageSummaryDto>(`/usage/summary?${usageSearch(filters)}`, {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function getUsageRecords(session: CompanionSession, filters: UsageQueryDto, cursor?: string): Promise<UsageRecordsPageDto> {
  const suffix = `${usageSearch(filters)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  const response = await request<UsageRecordsPageDto>(`/usage/records?${suffix}`, {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function getUsageCoverage(session: CompanionSession): Promise<{ coverage: UsageCoverageDto | null; bounds: { periodStart: string | null; periodEnd: string | null; lastSuccessfulRefreshAt: string | null; lastSuccessRunId: string | null } }> {
  const response = await request<{ coverage: UsageCoverageDto | null; bounds: { periodStart: string | null; periodEnd: string | null; lastSuccessfulRefreshAt: string | null; lastSuccessRunId: string | null } }>('/usage/coverage', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function listUsageMappings(session: CompanionSession): Promise<UsageManualMappingDto[]> {
  const response = await request<UsageManualMappingDto[]>('/usage/mappings', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function saveUsageMapping(session: CompanionSession, mapping: { identityKey: string; clientId: string; providerId: string | null; modelId: string; profileId: string }): Promise<UsageManualMappingDto> {
  const response = await request<UsageManualMappingDto>(`/usage/mappings/${encodeURIComponent(mapping.identityKey)}`, { method: 'PUT', body: JSON.stringify(mapping) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function removeUsageMapping(session: CompanionSession, identityKey: string): Promise<boolean> {
  const response = await request<{ removed: boolean }>(`/usage/mappings/${encodeURIComponent(identityKey)}`, { method: 'DELETE' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data.removed
}

export async function getUsageRouteObservations(session: CompanionSession, filters: UsageQueryDto): Promise<UsageRouteObservationDto[]> {
  const response = await request<UsageRouteObservationDto[]>(`/usage/route-observations?${usageSearch(filters)}`, {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function downloadUsageExport(session: CompanionSession, filters: UsageQueryDto, format: 'json' | 'csv', includeAttribution = false): Promise<void> {
  const search = usageSearch(filters)
  const headers = new Headers({ authorization: `Bearer ${session.token}`, 'x-findmnemo-browser-nonce': session.browserNonce, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION })
  const response = await fetch(`${COMPANION_BASE_URL}/usage/export?${search}&format=${format}&includeAttribution=${includeAttribution}`, { headers, redirect: 'error' })
  if (!response.ok) throw new CompanionApiRequestError('SOURCE_UNAVAILABLE', 'Usage export failed.')
  const filename = `findmnemo-usage.${format}`
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable: () => Promise<WritableStream> }> }).showSaveFilePicker
  if (picker && response.body) {
    const handle = await picker({ suggestedName: filename, types: [{ description: `FindMnemo ${format.toUpperCase()} usage export`, accept: { [format === 'csv' ? 'text/csv' : 'application/json']: [`.${format}`] } }] })
    await response.body.pipeTo(await handle.createWritable())
    return
  }
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}

export async function getDataExportPreview(session: CompanionSession): Promise<DataExportPreviewDto> {
  const response = await request<DataExportPreviewDto>('/data/export/preview', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function downloadDataBundle(session: CompanionSession, categoryIds: DataCategoryId[]): Promise<void> {
  const headers = new Headers({ authorization: `Bearer ${session.token}`, 'content-type': 'application/json', 'x-findmnemo-browser-nonce': session.browserNonce, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION })
  const response = await fetch(`${COMPANION_BASE_URL}/data/export`, { method: 'POST', headers, body: JSON.stringify({ categoryIds }), redirect: 'error' })
  if (!response.ok) throw new CompanionApiRequestError('SOURCE_UNAVAILABLE', 'Data export failed.')
  const disposition = response.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `findmnemo-data-${new Date().toISOString().slice(0, 10)}.findmnemo.json`
  const picker = (window as Window & { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable: () => Promise<WritableStream> }> }).showSaveFilePicker
  if (picker && response.body) {
    const handle = await picker({ suggestedName: filename, types: [{ description: 'FindMnemo data bundle', accept: { 'application/json': ['.json'] } }] })
    await response.body.pipeTo(await handle.createWritable())
    return
  }
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}

export async function previewDataImport(session: CompanionSession, bundle: Record<string, unknown>): Promise<DataImportPreviewDto> {
  const response = await request<DataImportPreviewDto>('/data/import/preview', { method: 'POST', body: JSON.stringify(bundle) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function commitDataImport(session: CompanionSession, input: { planId: string; categoryIds: DataCategoryId[]; idempotencyKey: string }): Promise<DataPortabilityReceiptDto> {
  const response = await request<DataPortabilityReceiptDto>('/data/import/commit', { method: 'POST', body: JSON.stringify(input) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function clearUsageHistory(session: CompanionSession): Promise<void> {
  const response = await request<{ cleared: boolean }>('/usage/history', { method: 'DELETE', body: JSON.stringify({ confirmation: 'clear-usage-history' }) }, session)
  if (response.error || !response.data?.cleared) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
}

export async function clearUsageMappings(session: CompanionSession): Promise<void> {
  const response = await request<{ cleared: boolean }>('/usage/mappings', { method: 'DELETE', body: JSON.stringify({ confirmation: 'clear-usage-mappings' }) }, session)
  if (response.error || !response.data?.cleared) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
}

export async function updateOperationalRoutingPolicy(session: CompanionSession, policy: OperationalRoutingPolicy, expectedPolicyVersion: number | null): Promise<OperationalRoutingPolicy> {
  const response = await request<OperationalRoutingPolicy>('/routing/policy', { method: 'PUT', body: JSON.stringify({ policy, expectedPolicyVersion }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_POLICY_INVALID', response.error?.message)
  return response.data
}

export async function previewOperationalRoutingMigration(session: CompanionSession, preview: OperationalPolicyMigrationPreview): Promise<OperationalPolicyMigrationPreview> {
  const response = await request<OperationalPolicyMigrationPreview>('/routing/migration/preview', { method: 'POST', body: JSON.stringify({ preview }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_MIGRATION_INVALID', response.error?.message)
  return response.data
}

export async function commitOperationalRoutingMigration(session: CompanionSession, preview: OperationalPolicyMigrationPreview, idempotencyKey: string): Promise<OperationalRoutingPolicy> {
  const response = await request<OperationalRoutingPolicy>('/routing/migration/commit', { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify({ preview }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_MIGRATION_INVALID', response.error?.message)
  return response.data
}

export async function exportOperationalRoutingPolicyV1(session: CompanionSession): Promise<Record<string, unknown>> {
  const response = await request<Record<string, unknown>>('/routing/policy/export-v1', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_POLICY_NOT_FOUND', response.error?.message)
  return response.data
}

export async function discoverRoutingDestinations(session: CompanionSession): Promise<DestinationDiscoveryDto> {
  const response = await request<DestinationDiscoveryDto>('/routing/destinations/discover', { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_CHECK_FAILED', response.error?.message)
  return response.data
}

export async function listRoutingConnections(session: CompanionSession): Promise<RoutingConnectionSummaryDto[]> {
  const response = await request<RoutingConnectionSummaryDto[]>('/routing/connections', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DESTINATION_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function getOperationalRoutingPolicyV3(session: CompanionSession): Promise<OperationalRoutingPolicyV3 | null> {
  const response = await request<{ policy: OperationalRoutingPolicyV3 | null }>('/routing/policy-v3', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_POLICY_INVALID', response.error?.message)
  return response.data.policy
}

export async function updateOperationalRoutingPolicyV3(session: CompanionSession, policy: OperationalRoutingPolicyV3, expectedPolicyVersion: number | null): Promise<OperationalRoutingPolicyV3> {
  const response = await request<OperationalRoutingPolicyV3>('/routing/policy-v3', { method: 'PUT', body: JSON.stringify({ policy, expectedPolicyVersion }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_POLICY_INVALID', response.error?.message)
  return response.data
}

export async function validateOperationalRoutingProfileV3(session: CompanionSession, profileId: string): Promise<RoutingProfileV3> {
  const response = await request<RoutingProfileV3>(`/routing/profiles-v3/${encodeURIComponent(profileId)}/validate`, { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_PROFILE_NOT_READY', response.error?.message)
  return response.data
}

export async function getRoutingConnectionCatalog(session: CompanionSession, connectionId: string): Promise<RoutingConnectionCatalogDto> {
  const response = await request<RoutingConnectionCatalogDto>(`/routing/connections/${encodeURIComponent(connectionId)}/catalog`, {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DESTINATION_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function listProjectFolderSummaries(session: CompanionSession): Promise<ProjectFolderSummaryDto[]> {
  const response = await request<ProjectFolderSummaryDto[]>('/project-folders', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function updateProjectFolderSummary(session: CompanionSession, id: string, input: { label?: string; state?: 'active' | 'paused'; sddEnrichmentEnabled?: boolean }): Promise<ProjectFolderSummaryDto> {
  const response = await request<ProjectFolderSummaryDto>(`/project-folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data
}

export async function removeProjectFolderSummary(session: CompanionSession, id: string): Promise<boolean> {
  const response = await request<{ removed: boolean }>(`/project-folders/${encodeURIComponent(id)}`, { method: 'DELETE' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'INVALID_REQUEST', response.error?.message)
  return response.data.removed
}

export async function discoverRoutingConnections(session: CompanionSession): Promise<RoutingConnectionSummaryDto[]> {
  const response = await request<RoutingConnectionSummaryDto[]>('/routing/connections/discover', { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DESTINATION_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function refreshRoutingConnection(session: CompanionSession, connectionId: string): Promise<{ connection: RoutingConnectionSummaryDto; catalog: RoutingConnectionCatalogDto }> {
  const response = await request<{ connection: RoutingConnectionSummaryDto; catalog: RoutingConnectionCatalogDto }>(`/routing/connections/${encodeURIComponent(connectionId)}/refresh`, { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DESTINATION_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function setRoutingConnectionEnabled(session: CompanionSession, connectionId: string, enabled: boolean): Promise<RoutingConnectionSummaryDto> {
  const response = await request<RoutingConnectionSummaryDto>(`/routing/connections/${encodeURIComponent(connectionId)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DESTINATION_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function startOpenRouterConnection(session: CompanionSession): Promise<{ authorizationUrl: string; expiresAt: string }> {
  const response = await request<{ authorizationUrl: string; expiresAt: string }>('/routing/openrouter/oauth/start', { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'CREDENTIAL_STORE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function getOpenRouterConnectionStatus(session: CompanionSession): Promise<{ state: 'idle' | 'pending' | 'ready' | 'failed' | 'cancelled'; expiresAt: string | null; errorCode: string | null }> {
  const response = await request<{ state: 'idle' | 'pending' | 'ready' | 'failed' | 'cancelled'; expiresAt: string | null; errorCode: string | null }>('/routing/openrouter/oauth/status', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'CREDENTIAL_STORE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function refreshPiModelCatalog(session: CompanionSession): Promise<DestinationModelCatalogDto> {
  const response = await request<DestinationModelCatalogDto>('/routing/destinations/pi-rpc/catalog', { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DESTINATION_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function getPiModelCatalog(session: CompanionSession): Promise<DestinationModelCatalogDto> {
  const response = await request<DestinationModelCatalogDto>('/routing/destinations/pi-rpc/catalog', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DESTINATION_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function validateOperationalRoutingProfile(session: CompanionSession, profileId: string, expectedPolicyVersion: number): Promise<{ readiness: ProfileReadinessResultDto; policy: OperationalRoutingPolicy }> {
  const response = await request<{ readiness: ProfileReadinessResultDto; policy: OperationalRoutingPolicy }>(`/routing/profiles/${encodeURIComponent(profileId)}/validate`, { method: 'POST', body: JSON.stringify({ expectedPolicyVersion }) }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_PROFILE_NOT_FOUND', response.error?.message)
  return response.data
}

export async function listRoutingDispatchReceipts(session: CompanionSession): Promise<RoutingDispatchReceiptDto[]> {
  const response = await request<RoutingDispatchReceiptDto[]>('/routing/dispatches', {}, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'SOURCE_UNAVAILABLE', response.error?.message)
  return response.data
}

export async function cancelRoutingDispatch(session: CompanionSession, receiptId: string): Promise<RoutingDispatchReceiptDto> {
  const response = await request<RoutingDispatchReceiptDto>(`/routing/dispatches/${encodeURIComponent(receiptId)}/cancel`, { method: 'POST', body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'ROUTING_DISPATCH_NOT_FOUND', response.error?.message)
  return response.data
}

export async function retryRoutingDispatch(session: CompanionSession, receiptId: string, idempotencyKey: string): Promise<RoutingDispatchReceiptDto> {
  const response = await request<RoutingDispatchReceiptDto>(`/routing/dispatches/${encodeURIComponent(receiptId)}/retry`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: '{}' }, session)
  if (response.error || !response.data) throw new CompanionApiRequestError(response.error?.code ?? 'RETRY_NOT_ALLOWED', response.error?.message)
  return response.data
}
