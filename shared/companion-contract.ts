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

export const USAGE_VALUE_STATES = ['reported', 'calculated', 'estimated', 'unknown'] as const
export const USAGE_VALUE_REASONS = [
  'upstream-reported',
  'derived-from-reported-components',
  'field-absent',
  'semantics-unverified',
  'source-unavailable',
  'not-applicable',
] as const
export const USAGE_FRESHNESS_STATES = ['current', 'stale', 'never-refreshed', 'retained-after-failure'] as const
export const USAGE_MAPPING_STATES = ['unmapped', 'automatic', 'manual', 'target-missing'] as const
export const USAGE_DUPLICATE_STATES = ['unique', 'identical-collapsed', 'conflict-quarantined', 'overlap-unknown'] as const

export type UsageValueState = (typeof USAGE_VALUE_STATES)[number]
export type UsageValueReason = (typeof USAGE_VALUE_REASONS)[number]
export type UsageFreshnessState = (typeof USAGE_FRESHNESS_STATES)[number]
export type UsageMappingState = (typeof USAGE_MAPPING_STATES)[number]
export type UsageDuplicateState = (typeof USAGE_DUPLICATE_STATES)[number]

export interface UsageMetricDto {
  value: number | null
  state: UsageValueState
  reason: UsageValueReason
}

export interface UsageMetricSetDto {
  inputTokens: UsageMetricDto
  outputTokens: UsageMetricDto
  cacheReadTokens: UsageMetricDto
  cacheWriteTokens: UsageMetricDto
  reasoningTokens: UsageMetricDto
  totalTokens: UsageMetricDto
  cost: UsageMetricDto
  currency: string | null
}

export interface UsageRouteMappingDto {
  state: UsageMappingState
  profileId: string | null
  source: 'none' | 'exact' | 'manual'
  mappedAt: string | null
}

export interface UsageProvenanceDto {
  sourceCommandId: 'canonical-graph' | 'session-attribution' | 'workspace-attribution'
  tokscaleVersion: string
  adapterId: string
  refreshRunId: string
  refreshedAt: string
  transformations: string[]
  duplicateState: UsageDuplicateState
}

export interface UsageFreshnessDto {
  state: UsageFreshnessState
  lastSuccessfulRefreshAt: string | null
  upstreamGeneratedAt: string | null
}

export interface NormalizedUsageRecordDto extends UsageMetricSetDto {
  schema: 'findmnemo.usage.v1'
  id: string
  role: 'canonical-daily'
  periodStart: string
  periodEnd: string
  clientId: string
  providerId: string | null
  modelId: string
  routeMapping: UsageRouteMappingDto
  provenance: UsageProvenanceDto
  freshness: UsageFreshnessDto
}

export interface UsageAttributionRecordDto {
  schema: 'findmnemo.usage-attribution.v1'
  id: string
  role: 'session-attribution' | 'workspace-attribution'
  additive: false
  clientId: string | null
  providerId: string | null
  modelId: string
  opaqueSubjectId: string
  localLabel: string | null
  metrics: UsageMetricSetDto
  provenance: UsageProvenanceDto
  joinState: 'linked' | 'unlinked' | 'ambiguous'
}

export interface UsageSourceCoverageDto {
  clientId: string
  state: 'available' | 'unavailable' | 'failed'
  messageCount: number | null
  diagnosticCodes: string[]
}

export interface UsageCoverageDto {
  schema: 'findmnemo.usage-coverage.v1'
  tokscaleVersion: string
  adapterId: string
  refreshedAt: string
  sources: UsageSourceCoverageDto[]
  complete: boolean
  warnings: string[]
}

export const USAGE_CAPABILITY_STATES = [
  'not-installed',
  'installed-supported',
  'installed-unsupported-version',
  'installed-contract-unverified',
  'detection-failed',
] as const

export type UsageCapabilityState = (typeof USAGE_CAPABILITY_STATES)[number]

export type UsageCollectorSource = 'embedded' | 'external-recovery' | 'unavailable'

export interface UsageCapabilityDto {
  schema: 'findmnemo.usage-capability.v1'
  state: UsageCapabilityState
  executableLabel: 'tokscale'
  collectorSource: UsageCollectorSource
  installedVersion: string | null
  supportedRange: string
  adapterId: string | null
  checkedAt: string
  lastSuccessfulRefreshAt: string | null
  sources: UsageSourceCoverageDto[]
  reasonCode: string | null
  guidance: {
    summary: string
    installationUrl: string
    automaticInstall: false
  }
}

export const USAGE_REFRESH_STATES = ['requested', 'detecting', 'collecting', 'normalizing', 'committing', 'complete', 'partial', 'failed', 'cancelled'] as const
export type UsageRefreshState = (typeof USAGE_REFRESH_STATES)[number]

export interface UsageRefreshCommandDto {
  recipeId: 'version' | 'clients' | 'canonical-graph' | 'session-attribution' | 'workspace-attribution'
  state: 'pending' | 'complete' | 'failed' | 'skipped'
  durationMs: number | null
  outputBytes?: number | null
  recordCount: number | null
  errorCode: string | null
}

export interface UsageRefreshRunDto {
  schema: 'findmnemo.usage-refresh.v1'
  id: string
  state: UsageRefreshState
  stage: 'requested' | 'capability-check' | 'source-coverage' | 'canonical-usage' | 'attribution' | 'normalization' | 'commit' | 'finished'
  requestedAt: string
  finishedAt: string | null
  coverageStart: string
  coverageEnd: string
  commands: UsageRefreshCommandDto[]
  canonicalCount: number
  attributionCount: number
  warningCodes: string[]
  errorCode: string | null
  lastSuccessfulRefreshAt: string | null
  retainedPreviousSuccess: boolean
}

export interface UsageQueryDto {
  start: string | null
  end: string | null
  clientId: string | null
  providerId: string | null
  modelId: string | null
  profileId: string | null
  mappingState: UsageMappingState | null
}

export interface UsageAggregateMetricDto {
  value: number | null
  knownRecordCount: number
  unknownRecordCount: number
  state: 'complete' | 'partial' | 'unknown'
}

export interface UsageBreakdownDto {
  key: string
  label: string
  recordCount: number
  totalTokens: UsageAggregateMetricDto
  cost: UsageAggregateMetricDto
}

export interface UsageTrendPointDto extends UsageBreakdownDto {
  periodStart: string
}

export interface UsageSummaryDto {
  schema: 'findmnemo.usage-summary.v1'
  filters: UsageQueryDto
  recordCount: number
  totalTokens: UsageAggregateMetricDto
  inputTokens: UsageAggregateMetricDto
  outputTokens: UsageAggregateMetricDto
  cacheReadTokens: UsageAggregateMetricDto
  cacheWriteTokens: UsageAggregateMetricDto
  reasoningTokens: UsageAggregateMetricDto
  cost: UsageAggregateMetricDto
  currencies: string[]
  trends: { day: UsageTrendPointDto[]; week: UsageTrendPointDto[]; month: UsageTrendPointDto[] }
  breakdowns: { clients: UsageBreakdownDto[]; providers: UsageBreakdownDto[]; models: UsageBreakdownDto[] }
  coverage: UsageCoverageDto | null
  freshness: UsageFreshnessDto
  duplicateConflictCount: number
  warnings: string[]
}

export interface UsageRecordsPageDto {
  schema: 'findmnemo.usage-records.v1'
  records: NormalizedUsageRecordDto[]
  nextCursor: string | null
  totalCount: number
}

export interface UsageManualMappingDto {
  identityKey: string
  clientId: string
  providerId: string | null
  modelId: string
  profileId: string
  state: 'manual' | 'target-missing'
  createdAt: string
  updatedAt: string
}

export interface UsageRouteObservationDto {
  profileId: string
  observation: 'most-used-route' | 'no-observed-usage' | 'high-estimated-cost-concentration' | 'configured-but-unmapped' | 'usage-evidence-incomplete'
  recordCount: number
  totalTokens: number | null
  estimatedCost: number | null
  coverageComplete: boolean
  periodStart: string | null
  periodEnd: string | null
}

export const DATA_CATEGORY_IDS = [
  'tickets-work',
  'decisions-receipts',
  'routing-policy',
  'model-usage',
  'email-metadata',
] as const

export type DataCategoryId = (typeof DATA_CATEGORY_IDS)[number]
export type DataCategoryState = 'available' | 'empty' | 'partial' | 'stale' | 'unavailable' | 'unsupported'
export type DataImportClassification = 'add' | 'duplicate' | 'conflict' | 'excluded' | 'unsupported' | 'failed'

export interface DataCategoryPreviewDto {
  id: DataCategoryId
  label: string
  description: string
  state: DataCategoryState
  recordCount: number | null
  freshnessAt: string | null
  coverage: string
  selectedByDefault: boolean
  exportable: boolean
  importable: boolean
  artifactProfile: string
  privacyNote: string
}

export interface DataExportPreviewDto {
  schema: 'findmnemo.data-export-preview.v1'
  workspace: 'operational'
  generatedAt: string
  categories: DataCategoryPreviewDto[]
  exclusions: string[]
}

export interface DataBundleManifestV1 {
  profile: 'findmnemo.data-bundle-manifest.v1'
  product: { name: 'FindMnemo'; version: string }
  workspace: 'operational'
  generatedAt: string
  categories: Array<Pick<DataCategoryPreviewDto, 'id' | 'state' | 'recordCount' | 'freshnessAt' | 'coverage' | 'artifactProfile'>>
  exclusions: string[]
  compatibility: { productId: 'findmnemo'; legacyProductId: 'mnemosync'; legacyUriScheme: 'mnemosync://' }
  evidenceBoundary: string
}

export interface DataBundleArtifactV1 {
  category: DataCategoryId
  profile: string
  mediaType: 'application/json'
  schemaVersion: string
  data: unknown
}

export interface DataBundleV1 {
  profile: 'findmnemo.data-bundle.v1'
  manifest: DataBundleManifestV1
  artifacts: DataBundleArtifactV1[]
}

export interface DataImportCategoryPreviewDto {
  id: DataCategoryId
  importable: boolean
  counts: Record<DataImportClassification, number>
  conflictPolicy: 'preserve-current' | 'not-applicable'
  note: string
}

export interface DataImportPreviewDto {
  schema: 'findmnemo.data-import-preview.v1'
  planId: string
  expiresAt: string
  detectedProfile: string
  categories: DataImportCategoryPreviewDto[]
  safeToCommit: boolean
  errors: string[]
}

export interface DataImportCommitRequest {
  planId: string
  categoryIds: DataCategoryId[]
  idempotencyKey: string
}

export interface DataPortabilityReceiptDto {
  schema: 'findmnemo.data-portability-receipt.v1'
  operation: 'export' | 'import'
  outcome: 'complete' | 'partial' | 'failed'
  completedAt: string
  artifactName: string | null
  categories: Array<{ id: DataCategoryId; added: number; skipped: number; conflicts: number; excluded: number; failed: number }>
  nextAction: string
}

export function isDataCategoryId(value: unknown): value is DataCategoryId {
  return typeof value === 'string' && (DATA_CATEGORY_IDS as readonly string[]).includes(value)
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

export function isUsageValueState(input: unknown): input is UsageValueState {
  return includesValue(USAGE_VALUE_STATES, input)
}

export function isUsageValueReason(input: unknown): input is UsageValueReason {
  return includesValue(USAGE_VALUE_REASONS, input)
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function isUsageMetricDto(input: unknown): input is UsageMetricDto {
  if (!isPlainRecord(input) || !isUsageValueState(input.state) || !isUsageValueReason(input.reason)) return false
  if (input.state === 'unknown') return input.value === null
  return typeof input.value === 'number' && Number.isFinite(input.value) && input.value >= 0
}

const USAGE_BOUNDARY_PROHIBITED_KEYS = new Set([
  'account',
  'accountemail',
  'accountid',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'homedir',
  'path',
  'prompt',
  'raw',
  'rawlog',
  'response',
  'sessionid',
  'stderr',
  'stdout',
  'transcript',
  'workspacekey',
  'workspacelabel',
])

function isPrivateBoundaryString(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value)
    || /^\/(?:Users|home|var|tmp)\//.test(value)
    || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function assertUsageBoundarySafe(input: unknown): void {
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (isPrivateBoundaryString(value)) throw new Error('USAGE_BOUNDARY_PRIVATE_VALUE')
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isPlainRecord(value)) return
    for (const [key, nested] of Object.entries(value)) {
      if (USAGE_BOUNDARY_PROHIBITED_KEYS.has(key.toLowerCase())) {
        throw new Error('USAGE_BOUNDARY_PROHIBITED_FIELD')
      }
      visit(nested)
    }
  }
  visit(input)
}

export function isNormalizedUsageRecordDto(input: unknown): input is NormalizedUsageRecordDto {
  if (!isPlainRecord(input)) return false
  try {
    assertUsageBoundarySafe(input)
  } catch {
    return false
  }
  return input.schema === 'findmnemo.usage.v1'
    && input.role === 'canonical-daily'
    && typeof input.id === 'string'
    && typeof input.periodStart === 'string'
    && typeof input.periodEnd === 'string'
    && typeof input.clientId === 'string'
    && (input.providerId === null || typeof input.providerId === 'string')
    && typeof input.modelId === 'string'
    && isUsageMetricDto(input.inputTokens)
    && isUsageMetricDto(input.outputTokens)
    && isUsageMetricDto(input.cacheReadTokens)
    && isUsageMetricDto(input.cacheWriteTokens)
    && isUsageMetricDto(input.reasoningTokens)
    && isUsageMetricDto(input.totalTokens)
    && isUsageMetricDto(input.cost)
    && (input.currency === null || typeof input.currency === 'string')
}

export function assertNormalizedUsageRecordDto(input: unknown): asserts input is NormalizedUsageRecordDto {
  if (!isNormalizedUsageRecordDto(input)) throw new Error('INVALID_NORMALIZED_USAGE_RECORD')
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
