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
  'ROUTING_POLICY_INVALID',
  'ROUTING_POLICY_CONFLICT',
  'ROUTING_POLICY_NOT_FOUND',
  'ROUTING_MIGRATION_INVALID',
  'ROUTING_PROFILE_NOT_FOUND',
  'ROUTING_DESTINATION_UNAVAILABLE',
  'ROUTING_INTEGRATION_UNAUTHORIZED',
  'ROUTING_DISPATCH_NOT_FOUND',
  'RETRY_NOT_ALLOWED',
  'RESULT_CONTENT_UNAVAILABLE',
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

export const ROUTING_PROFILE_BEHAVIORS = ['recommend', 'auto-exact'] as const
export const ROUTING_READINESS_STATES = [
  'unchecked',
  'ready',
  'stale',
  'unavailable',
  'unsupported',
  'auth-required',
] as const
export const ROUTING_CLASSIFICATION_SOURCES = ['explicit', 'origin-inferred', 'user-confirmed'] as const
export const ROUTING_PREFLIGHT_STATUSES = [
  'recommend',
  'auto-dispatch-eligible',
  'decision-required',
  'unavailable',
  'self-handled',
  'invalid-policy',
] as const

export type RoutingProfileBehavior = (typeof ROUTING_PROFILE_BEHAVIORS)[number]
export type RoutingReadinessState = (typeof ROUTING_READINESS_STATES)[number]
export type RoutingClassificationSource = (typeof ROUTING_CLASSIFICATION_SOURCES)[number]
export type RoutingPreflightStatus = (typeof ROUTING_PREFLIGHT_STATUSES)[number]

export interface RoutingCapabilityDto {
  id: string
  family: 'orchestration' | 'review' | 'creation' | 'engineering' | 'research-analysis' | 'custom'
  label: string
  description: string
  origin: 'built-in' | 'custom' | 'imported'
}

export interface RoutingProfileReadiness {
  state: RoutingReadinessState
  checkedAt: string | null
  expiresAt: string | null
  adapterVersion: string | null
  installedVersion: string | null
  reasonCode: string | null
}

export interface RoutingExecutionProfile {
  id: string
  displayName: string
  destinationAdapterId: string
  destinationInstanceId: string
  providerId: string | null
  modelId: string
  effort: string | null
  capabilityIds: string[]
  enabled: boolean
  behavior: RoutingProfileBehavior
  fallbackOrder: number
  readiness: RoutingProfileReadiness
}

export interface OperationalRoutingPolicy {
  schemaVersion: '2.0.0'
  policyProfile: 'findmnemo.model-routing.v2'
  policyVersion: number
  updatedAt: string
  capabilities: RoutingCapabilityDto[]
  profiles: RoutingExecutionProfile[]
  defaultProfileOrder: string[]
  capabilityOverrides: Array<{
    capabilityId: string
    profileOrder: string[]
  }>
}

export interface RoutingPolicyValidationIssueDto {
  code: string
  path: string
  message: string
}

export interface OperationalRoutingValidationResult {
  valid: boolean
  issues: RoutingPolicyValidationIssueDto[]
  policy?: OperationalRoutingPolicy
}

export type RoutingRequestOverride =
  | { mode: 'none' }
  | { mode: 'self' }
  | { mode: 'include'; profileId: string }
  | { mode: 'exclude'; profileIds: string[] }

export interface RoutingPreflightRequest {
  policy: OperationalRoutingPolicy
  requiredCapabilityIds: string[]
  classificationSource: RoutingClassificationSource
  classificationAmbiguous: boolean
  override: RoutingRequestOverride
  now?: string
}

export interface RequestedProfileSnapshot {
  profileId: string
  destinationAdapterId: string
  destinationInstanceId: string
  providerId: string | null
  modelId: string
  effort: string | null
  behavior: RoutingProfileBehavior
}

export interface ActualRouteSnapshot {
  destinationAdapterId: string
  destinationInstanceId: string
  providerId: string | null
  modelId: string
  effort: string | null
}

export interface RoutingPreflightResult {
  status: RoutingPreflightStatus
  policyVersion: number
  policyRevision: string
  requiredCapabilityIds: string[]
  classificationSource: RoutingClassificationSource
  effectiveProfileOrder: string[]
  appliedOverrideCapabilityIds: string[]
  selectedProfileId?: string
  eligibleProfileIds: string[]
  exactProfileIds: string[]
  partialProfileIds: string[]
  reasonCodes: string[]
  validationIssues?: RoutingPolicyValidationIssueDto[]
}

export interface OperationalPolicyMigrationPreview {
  sourcePolicyRevision: string
  policy: OperationalRoutingPolicy
}

export type DestinationInstallationState = 'not-found' | 'detected' | 'error'
export type DestinationCompatibilityState = 'supported' | 'unsupported' | 'unknown'
export type DestinationControllabilityState = 'controllable' | 'detection-only'

export interface DestinationDetectionDto {
  adapterId: string
  displayName: string
  installation: DestinationInstallationState
  compatibility: DestinationCompatibilityState
  controllability: DestinationControllabilityState
  readiness: 'unchecked'
  executableLabel: string
  installedVersion: string | null
  supportedRange: string
  testedCapabilities: string[]
  evidenceAt: string
  reasonCode: string | null
  guidance: string
}

export interface DestinationDiscoveryDto {
  checkedAt: string
  complete: boolean
  destinations: DestinationDetectionDto[]
}

export interface DestinationModelDto {
  providerId: string
  modelId: string
  displayName: string
  reasoning: boolean
  supportedEfforts: string[]
}

export interface DestinationModelCatalogDto {
  adapterId: string
  adapterVersion: string
  installedVersion: string
  checkedAt: string
  expiresAt: string
  models: DestinationModelDto[]
}

export interface ProfileReadinessResultDto {
  profileId: string
  state: RoutingReadinessState
  checkedAt: string
  expiresAt: string | null
  adapterVersion: string
  installedVersion: string | null
  reasonCode: string | null
}

export type RoutingDispatchState = 'requested' | 'accepted' | 'running' | 'completed' | 'failed' | 'timed-out' | 'cancelled'
export type RoutingReturnState = 'pending' | 'delivered' | 'return-unavailable'

export interface RoutingDispatchReceiptDto {
  id: string
  idempotencyKey: string
  generation: number
  priorReceiptId: string | null
  origin: { adapterId: string; correlationId: string; conversationRefHash: string | null }
  capabilityIds: string[]
  classificationSource: RoutingClassificationSource
  policyVersion: number
  requestedProfileSnapshot: RequestedProfileSnapshot
  actualRoute: ActualRouteSnapshot | null
  state: RoutingDispatchState
  returnState: RoutingReturnState
  createdAt: string
  acceptedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  failureCode: string | null
  requestHash: string
  resultHash: string | null
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

export function isRoutingProfileBehavior(input: unknown): input is RoutingProfileBehavior {
  return includesValue(ROUTING_PROFILE_BEHAVIORS, input)
}

export function isRoutingReadinessState(input: unknown): input is RoutingReadinessState {
  return includesValue(ROUTING_READINESS_STATES, input)
}

export function isRoutingClassificationSource(input: unknown): input is RoutingClassificationSource {
  return includesValue(ROUTING_CLASSIFICATION_SOURCES, input)
}

export function isRoutingPreflightStatus(input: unknown): input is RoutingPreflightStatus {
  return includesValue(ROUTING_PREFLIGHT_STATUSES, input)
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
