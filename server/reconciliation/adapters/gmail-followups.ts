import { createHash } from 'node:crypto'
import type { LocalSourceAdapter, SourceCheckContext } from '../../../shared/companion-contract.js'
import type { OperationalRepository } from '../../db/operational-repository.js'

export class GmailFollowupsAdapter implements LocalSourceAdapter {
  readonly descriptor = { id: 'gmail-followups', label: 'Gmail follow-ups', adapterVersion: '1.0.0', enabled: true, policy: 'review' } as const
  private readonly repository: OperationalRepository
  constructor(repository: OperationalRepository) { this.repository = repository }

  async *check(_context: SourceCheckContext) {
    const records = this.repository.listEmailThreads().filter((thread) => thread.state === 'confirmed-untracked' || thread.state === 'linked').map((thread) => ({
      sourceId: this.descriptor.id, externalId: `${thread.accountId}:${thread.threadId}`,
      fingerprint: createHash('sha256').update(JSON.stringify([thread.latestMessageId, thread.subject, thread.state])).digest('hex'),
      title: thread.subject, state: thread.state, observedAt: thread.receivedAt,
      provenanceRef: `gmail://${encodeURIComponent(thread.accountId)}/${encodeURIComponent(thread.threadId)}`,
      eligibleForTicket: true,
    }))
    yield { records, complete: true }
  }
}
