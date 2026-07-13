import {
  COMPANION_PROTOCOL_VERSION,
  type CompanionApiResponse,
  type CompanionConnectionState,
  type CompanionIdentityDto,
  type GmailCandidateDto,
  type GmailCheckDto,
  type GmailTicketAssociationDto,
  type ReconciliationRunDto,
  type SourceDescriptor,
  type SourceId,
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
