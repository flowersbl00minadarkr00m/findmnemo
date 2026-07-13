import { createHash } from 'node:crypto'
import type { LocalSourceAdapter, SourceCheckContext } from '../../../shared/companion-contract.js'
import type { OperationalRepository } from '../../db/operational-repository.js'

export class FindMnemoTicketsAdapter implements LocalSourceAdapter {
  readonly descriptor = { id: 'findmnemo-tickets', label: 'FindMnemo tickets', adapterVersion: '1.0.0', enabled: true, policy: 'auto-create' } as const
  private readonly repository: OperationalRepository
  constructor(repository: OperationalRepository) { this.repository = repository }

  async *check(_context: SourceCheckContext) {
    const records = this.repository.listTickets().map((ticket) => ({
      sourceId: this.descriptor.id, externalId: ticket.id,
      fingerprint: createHash('sha256').update(JSON.stringify([ticket.status, ticket.updatedAt, ticket.payload.title ?? ''])).digest('hex'),
      title: String(ticket.payload.title ?? ticket.id), state: ticket.status, observedAt: ticket.updatedAt,
      provenanceRef: `findmnemo://tickets/${encodeURIComponent(ticket.id)}`, eligibleForTicket: true,
    }))
    yield { records, complete: true }
  }
}
