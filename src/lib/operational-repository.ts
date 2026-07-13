import type { LLMSource, Ticket, TicketStatus } from '../types'
import type { CredentialCapabilityDto, DestinationDiscoveryDto, DestinationModelCatalogDto, GmailCandidateDto, GmailCheckDto, GmailTicketAssociationDto, OperationalPolicyMigrationPreview, OperationalRoutingPolicy, ProfileReadinessResultDto, ReconciliationRunDto, RoutingDispatchReceiptDto, SourceDescriptor, SourceId } from '../../shared/companion-contract'

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
}

export interface OperationalRepositoryState {
  tickets: Ticket[]
  state: 'loading' | 'current' | 'stale' | 'error'
  error?: string
}
