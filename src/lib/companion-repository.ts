import type { LLMSource, Ticket, TicketStatus } from '../types'
import {
  createCompanionTicket,
  deleteCompanionTicket,
  listCompanionTickets,
  updateCompanionTicket,
  decideGmailCandidate,
  getGmailCheck,
  getGmailSourceStatus,
  listGmailCandidates,
  startGmailCheck,
  associateGmailCandidate,
  getReconciliationRun,
  listReconciliationRuns,
  listReconciliationSources,
  retryReconciliation,
  startReconciliation,
  previewLegacyMigration,
  commitLegacyMigration,
  connectGmail,
  type CompanionSession,
} from './companion-client'
import type { OperationalRepository } from './operational-repository'

export function createCompanionRepository(session: CompanionSession): OperationalRepository {
  return {
    listTickets: () => listCompanionTickets(session),
    createTicket: async (title: string, description: string, source: LLMSource) => {
      const now = new Date().toISOString()
      return createCompanionTicket(session, {
        id: crypto.randomUUID(),
        title: title.trim(),
        description: description.trim(),
        source,
        status: 'todo',
        workNotes: [],
        artifacts: [],
        decisionLog: [],
        createdAt: now,
        updatedAt: now,
        origin: 'browser-ui',
      })
    },
    updateTicketStatus: (ticket: Ticket, status: TicketStatus) => updateCompanionTicket(session, { ...ticket, status }),
    addWorkNote: (ticket: Ticket, text: string) => updateCompanionTicket(session, {
      ...ticket,
      workNotes: [...ticket.workNotes, { id: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString() }],
    }),
    deleteTicket: (ticketId: string) => deleteCompanionTicket(session, ticketId),
    listEmailCandidates: () => listGmailCandidates(session),
    startGmailCheck: () => startGmailCheck(session),
    getGmailCheck: (runId: string) => getGmailCheck(session, runId),
    getGmailSourceStatus: () => getGmailSourceStatus(session),
    connectGmail: () => connectGmail(session),
    decideEmailCandidate: (candidate, action) => decideGmailCandidate(session, candidate, action),
    associateEmailCandidate: (candidate, input, idempotencyKey) => associateGmailCandidate(session, candidate, input, idempotencyKey),
    listReconciliationSources: () => listReconciliationSources(session),
    startReconciliation: (sourceIds) => startReconciliation(session, sourceIds),
    getReconciliationRun: (runId) => getReconciliationRun(session, runId),
    listReconciliationRuns: () => listReconciliationRuns(session),
    retryReconciliation: (runId, sourceIds) => retryReconciliation(session, runId, sourceIds),
    previewLegacyMigration: (records) => previewLegacyMigration(session, records),
    commitLegacyMigration: (records, idempotencyKey) => commitLegacyMigration(session, records, idempotencyKey),
  }
}
