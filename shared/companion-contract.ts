export const COMPANION_PROTOCOL_VERSION = '1.0.0' as const

export const COMPANION_CONNECTION_STATES = [
  'not-installed',
  'stopped',
  'permission-required',
  'permission-denied',
  'pairing-required',
  'connected',
  'stale',
  'unsupported',
  'error',
] as const

export const SOURCE_IDS = [
  'findmnemo-tickets',
  'gmail-followups',
  'project-sdd',
  'agent-ledger',
] as const

export const SOURCE_POLICIES = ['auto-create', 'review', 'exclude'] as const
export const SOURCE_STATES = ['pending', 'checking', 'checked', 'skipped', 'unavailable', 'failed'] as const
export const RECONCILIATION_RUN_STATES = ['queued', 'running', 'complete', 'partial', 'failed'] as const
export const RECONCILIATION_CLASSIFICATIONS = [
  'added',
  'updated',
  'unchanged',
  'excluded',
  'duplicate',
  'unresolved',
] as const

export const COMPANION_REASON_CODES = [
  'LATEST_FROM_OTHER',
  'NO_LATER_SELF_REPLY',
  'NOT_AUTOMATED',
  'DISABLED_BY_USER',
  'SOURCE_NOT_CONFIGURED',
  'SOURCE_PERMISSION_REQUIRED',
  'SOURCE_RECORD_INELIGIBLE',
  'REVIEW_REQUIRED',
  'AMBIGUOUS_PROVENANCE',
  'DUPLICATE_PROVENANCE',
  'LATEST_FROM_SELF',
  'AUTOMATED_MESSAGE',
  'DRAFT_SPAM_OR_TRASH',
  'ALREADY_DISMISSED',
  'ALREADY_LINKED',
] as const

export const COMPANION_ERROR_CODES = [
  'INVALID_REQUEST',
  'UNSUPPORTED_PROTOCOL_VERSION',
  'ORIGIN_NOT_ALLOWED',
  'PAIRING_REQUIRED',
  'PAIRING_CODE_INVALID',
  'PAIRING_CODE_EXPIRED',
  'PAIRING_RATE_LIMITED',
  'SESSION_INVALID',
  'SESSION_EXPIRED',
  'RECORD_CHANGED',
  'SOURCE_UNAVAILABLE',
  'SOURCE_CHECK_FAILED',
  'RUN_NOT_FOUND',
  'COMPANION_STOPPED',
  'IDENTITY_MISMATCH',
  'PORT_IN_USE',
  'OAUTH_DENIED',
  'OAUTH_TIMEOUT',
  'OAUTH_STATE_MISMATCH',
  'GMAIL_NOT_CONFIGURED',
  'GMAIL_TOKEN_REVOKED',
  'GMAIL_REFRESH_FAILED',
  'GMAIL_THREAD_FAILED',
  'GMAIL_HISTORY_INVALID',
  'GMAIL_PAGINATION_TIMEOUT',
  'UNSUPPORTED_PLATFORM',
  'NODE_VERSION_UNSUPPORTED',
  'DEPENDENCY_LOCK_MISMATCH',
  'DATA_ROOT_UNAVAILABLE',
  'CREDENTIAL_STORE_UNAVAILABLE',
  'CREDENTIAL_PERMISSION_REQUIRED',
  'NATIVE_ADAPTER_UNSUPPORTED',
  'COMPANION_ALREADY_RUNNING',
  'PUBLIC_RELEASE_BOUNDARY_FAILED',
  'INTERNAL_ERROR',
] as const

export type CompanionProtocolVersion = typeof COMPANION_PROTOCOL_VERSION
export type CompanionConnectionState = (typeof COMPANION_CONNECTION_STATES)[number]
export type SourceId = (typeof SOURCE_IDS)[number]
export type SourcePolicy = (typeof SOURCE_POLICIES)[number]
export type SourceState = (typeof SOURCE_STATES)[number]
export type ReconciliationRunState = (typeof RECONCILIATION_RUN_STATES)[number]
export type ReconciliationClassification = (typeof RECONCILIATION_CLASSIFICATIONS)[number]
export type CompanionReasonCode = (typeof COMPANION_REASON_CODES)[number]
export type CompanionErrorCode = (typeof COMPANION_ERROR_CODES)[number]

export interface CompanionIdentityDto {
  protocolVersion: CompanionProtocolVersion
  companionVersion: string
  instanceId: string
  pairingRequired: boolean
}

export interface CompanionApiMeta {
  protocolVersion: CompanionProtocolVersion
  requestId: string
}

export interface CompanionApiError {
  code: CompanionErrorCode
  message: string
  reasonCode?: CompanionReasonCode
  retryable: boolean
}

export interface CompanionApiResponse<T> {
  data: T | null
  error: CompanionApiError | null
  meta: CompanionApiMeta
}

export interface CredentialCapabilityDto {
  backend?: 'windows-dpapi' | 'macos-keychain' | 'linux-secret-service'
  state: 'available' | 'permission-required' | 'locked' | 'unavailable' | 'unsupported'
  code: string
  guidance: string
}

export interface SourceRunCapabilityReport {
  schemaVersion: 1
  platform: string
  architecture: string
  supportLevel: 'supported' | 'experimental' | 'unsupported'
  node: { detected: string; requiredMajor: 24; supported: boolean; code: string }
  filesystem: { dataRootWritable: boolean; code: string }
  listener: { port: number; state: string; code: string }
  database: { state: string; code: string }
  gmail: { configured: boolean; credentialStore: CredentialCapabilityDto }
  generatedAt: string
}

export interface SourceDescriptor {
  id: SourceId
  label: string
  adapterVersion: string
  enabled: boolean
  policy: SourcePolicy
  locationLabel?: string
}

export interface SourceRecord {
  sourceId: SourceId
  externalId: string
  fingerprint: string
  title: string
  state: string
  observedAt: string
  provenanceRef: string
  eligibleForTicket: boolean
  exclusionReason?: CompanionReasonCode
}

export interface SourceRecordBatch {
  records: readonly SourceRecord[]
  cursor?: string
  complete: boolean
}

export interface SourceCheckContext {
  runId: string
  signal: AbortSignal
  cursor?: string
}

export interface LocalSourceAdapter {
  descriptor: SourceDescriptor
  check(context: SourceCheckContext): AsyncIterable<SourceRecordBatch>
}

export interface ReconciliationSourceResultDto {
  sourceId: SourceId
  state: SourceState
  checked: number
  added: number
  updated: number
  unchanged: number
  excluded: number
  duplicate: number
  unresolved: number
  reasonCode?: CompanionReasonCode
  errorCode?: CompanionErrorCode
}

export interface ReconciliationItemResultDto {
  sourceId: SourceId
  externalId: string
  classification: ReconciliationClassification
  ticketId?: string
  reasonCode?: CompanionReasonCode
  errorCode?: CompanionErrorCode
}

export interface ReconciliationRunDto {
  id: string
  state: ReconciliationRunState
  requestedSourceIds: readonly SourceId[]
  sources: readonly ReconciliationSourceResultDto[]
  items: readonly ReconciliationItemResultDto[]
  startedAt?: string
  finishedAt?: string
}

export type GmailCandidateState = 'candidate' | 'confirmed' | 'dismissed' | 'deferred' | 'linked' | 'confirmed-untracked'
export type GmailCheckState = 'running' | 'complete' | 'partial' | 'failed'

export interface GmailCandidateDto {
  accountId: string
  threadId: string
  latestMessageId: string
  sender: string
  subject: string
  receivedAt: string
  snippet: string
  reasonCodes: CompanionReasonCode[]
  state: GmailCandidateState
  gmailUrl: string
  recordVersion: number
}

export interface GmailCheckDto {
  id: string
  state: GmailCheckState
  startedAt: string
  finishedAt?: string
  coverageStart: string
  coverageEnd: string
  checkedThreads: number
  candidateThreads: number
  excludedThreads: number
  failedThreadIds: string[]
  historyId?: string
  errorCode?: CompanionErrorCode
}

export interface GmailTicketAssociationDto {
  accountId: string
  threadId: string
  ticketId: string
  gmailUrl: string
  created: boolean
  idempotencyKey: string
}

function includesValue<const T extends readonly string[]>(values: T, input: unknown): input is T[number] {
  return typeof input === 'string' && (values as readonly string[]).includes(input)
}

export function isCompanionProtocolVersion(input: unknown): input is CompanionProtocolVersion {
  return input === COMPANION_PROTOCOL_VERSION
}

export function isCompanionConnectionState(input: unknown): input is CompanionConnectionState {
  return includesValue(COMPANION_CONNECTION_STATES, input)
}

export function isSourceId(input: unknown): input is SourceId {
  return includesValue(SOURCE_IDS, input)
}

export function isSourcePolicy(input: unknown): input is SourcePolicy {
  return includesValue(SOURCE_POLICIES, input)
}

export function isSourceState(input: unknown): input is SourceState {
  return includesValue(SOURCE_STATES, input)
}

export function isReconciliationRunState(input: unknown): input is ReconciliationRunState {
  return includesValue(RECONCILIATION_RUN_STATES, input)
}

export function isReconciliationClassification(input: unknown): input is ReconciliationClassification {
  return includesValue(RECONCILIATION_CLASSIFICATIONS, input)
}

export function isCompanionReasonCode(input: unknown): input is CompanionReasonCode {
  return includesValue(COMPANION_REASON_CODES, input)
}

export function isCompanionErrorCode(input: unknown): input is CompanionErrorCode {
  return includesValue(COMPANION_ERROR_CODES, input)
}

export function assertCompanionProtocolVersion(input: unknown): asserts input is CompanionProtocolVersion {
  if (!isCompanionProtocolVersion(input)) {
    throw new Error(`Unsupported companion protocol version: ${String(input)}`)
  }
}

export function assertSourceState(input: unknown): asserts input is SourceState {
  if (!isSourceState(input)) {
    throw new Error(`Invalid reconciliation source state: ${String(input)}`)
  }
}

export function assertReconciliationRunState(input: unknown): asserts input is ReconciliationRunState {
  if (!isReconciliationRunState(input)) {
    throw new Error(`Invalid reconciliation run state: ${String(input)}`)
  }
}
