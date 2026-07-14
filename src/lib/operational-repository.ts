import type { LLMSource, Ticket, TicketStatus } from '../types'
import type { CredentialCapabilityDto, DataCategoryId, DataExportPreviewDto, DataImportPreviewDto, DataPortabilityReceiptDto, DestinationDiscoveryDto, DestinationModelCatalogDto, GmailCandidateDto, GmailCheckDto, GmailTicketAssociationDto, OperationalPolicyMigrationPreview, OperationalRoutingPolicy, ProfileReadinessResultDto, ReconciliationRunDto, RoutingDispatchReceiptDto, SourceDescriptor, SourceId, UsageCapabilityDto, UsageCoverageDto, UsageManualMappingDto, UsageQueryDto, UsageRecordsPageDto, UsageRefreshRunDto, UsageRouteObservationDto, UsageSummaryDto } from '../../shared/companion-contract'

export interface GmailSourceStatus {
  configured?: boolean
  connected?: boolean
  lastAttemptAt?: string
  lastSuccessAt?: string
  coverageStart?: string
  coverageEnd?: string
  state: string
  errorCode?: string
  credentialCapability?: CredentialCapabilityDto
}

export interface LegacyMigrationRecord { legacyId: string; excluded: boolean; ticket?: Ticket }
export interface LegacyMigrationResult { eligible: number; conflicts: number; excluded: number; imported: number; alreadyImported: number }

export interface OperationalRepository {
  listTickets(): Promise<Ticket[]>
  createTicket(title: string, description: string, source: LLMSource): Promise<Ticket>
  updateTicketStatus(ticket: Ticket, status: TicketStatus): Promise<Ticket>
  addWorkNote(ticket: Ticket, text: string, author: string): Promise<Ticket>
  deleteTicket(ticketId: string): Promise<void>
  listEmailCandidates?(): Promise<GmailCandidateDto[]>
  startGmailCheck?(): Promise<GmailCheckDto>
  getGmailCheck?(runId: string): Promise<GmailCheckDto>
  getGmailSourceStatus?(): Promise<GmailSourceStatus>
  connectGmail?(): Promise<string>
  decideEmailCandidate?(candidate: GmailCandidateDto, action: 'confirm' | 'dismiss' | 'defer'): Promise<GmailCandidateDto>
  associateEmailCandidate?(candidate: GmailCandidateDto, input: { mode: 'create'; ticket: Ticket } | { mode: 'link'; ticketId: string }, idempotencyKey: string): Promise<GmailTicketAssociationDto>
  listReconciliationSources?(): Promise<SourceDescriptor[]>
  startReconciliation?(sourceIds?: SourceId[]): Promise<ReconciliationRunDto>
  getReconciliationRun?(runId: string): Promise<ReconciliationRunDto>
  listReconciliationRuns?(): Promise<ReconciliationRunDto[]>
  retryReconciliation?(runId: string, sourceIds?: SourceId[]): Promise<ReconciliationRunDto>
  previewLegacyMigration?(records: LegacyMigrationRecord[]): Promise<LegacyMigrationResult>
  commitLegacyMigration?(records: LegacyMigrationRecord[], idempotencyKey: string): Promise<LegacyMigrationResult>
  getRoutingPolicy?(): Promise<OperationalRoutingPolicy | null>
  updateRoutingPolicy?(policy: OperationalRoutingPolicy, expectedPolicyVersion: number | null): Promise<OperationalRoutingPolicy>
  previewRoutingMigration?(preview: OperationalPolicyMigrationPreview): Promise<OperationalPolicyMigrationPreview>
  commitRoutingMigration?(preview: OperationalPolicyMigrationPreview, idempotencyKey: string): Promise<OperationalRoutingPolicy>
  exportRoutingPolicyV1?(): Promise<Record<string, unknown>>
  discoverRoutingDestinations?(): Promise<DestinationDiscoveryDto>
  refreshPiModelCatalog?(): Promise<DestinationModelCatalogDto>
  getPiModelCatalog?(): Promise<DestinationModelCatalogDto>
  validateRoutingProfile?(profileId: string, expectedPolicyVersion: number): Promise<{ readiness: ProfileReadinessResultDto; policy: OperationalRoutingPolicy }>
  listRoutingDispatchReceipts?(): Promise<RoutingDispatchReceiptDto[]>
  cancelRoutingDispatch?(receiptId: string): Promise<RoutingDispatchReceiptDto>
  retryRoutingDispatch?(receiptId: string, idempotencyKey: string): Promise<RoutingDispatchReceiptDto>
  getUsageCapability?(): Promise<UsageCapabilityDto>
  startUsageRefresh?(input: { since: string; until: string }): Promise<UsageRefreshRunDto>
  getUsageRefresh?(runId: string): Promise<UsageRefreshRunDto>
  cancelUsageRefresh?(runId: string): Promise<UsageRefreshRunDto>
  getUsageSummary?(filters: UsageQueryDto): Promise<UsageSummaryDto>
  getUsageRecords?(filters: UsageQueryDto, cursor?: string): Promise<UsageRecordsPageDto>
  getUsageCoverage?(): Promise<{ coverage: UsageCoverageDto | null; bounds: { periodStart: string | null; periodEnd: string | null; lastSuccessfulRefreshAt: string | null; lastSuccessRunId: string | null } }>
  listUsageMappings?(): Promise<UsageManualMappingDto[]>
  saveUsageMapping?(mapping: { identityKey: string; clientId: string; providerId: string | null; modelId: string; profileId: string }): Promise<UsageManualMappingDto>
  removeUsageMapping?(identityKey: string): Promise<boolean>
  getUsageRouteObservations?(filters: UsageQueryDto): Promise<UsageRouteObservationDto[]>
  downloadUsageExport?(filters: UsageQueryDto, format: 'json' | 'csv', includeAttribution?: boolean): Promise<void>
  clearUsageHistory?(): Promise<void>
  clearUsageMappings?(): Promise<void>
  getDataExportPreview?(): Promise<DataExportPreviewDto>
  downloadDataBundle?(categoryIds: DataCategoryId[]): Promise<void>
  previewDataImport?(bundle: Record<string, unknown>): Promise<DataImportPreviewDto>
  commitDataImport?(input: { planId: string; categoryIds: DataCategoryId[]; idempotencyKey: string }): Promise<DataPortabilityReceiptDto>
}

export interface OperationalRepositoryState {
  tickets: Ticket[]
  state: 'loading' | 'current' | 'stale' | 'error'
  error?: string
}
