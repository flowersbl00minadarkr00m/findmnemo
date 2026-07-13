import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import type { LocalSourceAdapter, SourceCheckContext, SourceRecord } from '../../../shared/companion-contract.js'
import type { OperationalRepository } from '../../db/operational-repository.js'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_LINES = 10_000

export class AgentLedgerAdapter implements LocalSourceAdapter {
  readonly descriptor = { id: 'agent-ledger', label: 'Registered agent ledger', adapterVersion: '1.0.0', enabled: false, policy: 'review' } as const
  private readonly repository: OperationalRepository
  constructor(repository: OperationalRepository) { this.repository = repository }

  async *check(_context: SourceCheckContext) {
    const config = this.repository.getConfiguredSource('agent-ledger')?.config
    if (typeof config?.path !== 'string' || typeof config.registrationId !== 'string') throw new Error('Ledger is not registered')
    const info = await stat(config.path)
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Ledger is unavailable or exceeds the bounded size')
    const lines = (await readFile(config.path, 'utf8')).split(/\r?\n/).filter(Boolean)
    if (lines.length > MAX_LINES) throw new Error('Ledger exceeds the bounded line count')
    const records = lines.map((line, index) => parseLine(line, index + 1, config.registrationId as string))
    yield { records, complete: true }
  }
}

function parseLine(line: string, lineNumber: number, registrationId: string): SourceRecord {
  const fingerprint = createHash('sha256').update(line).digest('hex')
  try {
    const value = JSON.parse(line) as Record<string, unknown>
    const externalId = stringValue(value.eventId) ?? stringValue(value.id)
    if (!externalId) return malformed(lineNumber, fingerprint)
    const activity = typeof value.activity === 'object' && value.activity ? value.activity as Record<string, unknown> : undefined
    const result = typeof value.result === 'object' && value.result ? value.result as Record<string, unknown> : undefined
    return {
      sourceId: 'agent-ledger', externalId, fingerprint,
      title: stringValue(activity?.label) ?? stringValue(value.intent) ?? `Agent event ${externalId}`,
      state: result?.status === 'failure' || result?.status === 'exception' ? 'blocked' : 'todo',
      observedAt: stringValue(value.timestamp) ?? new Date(0).toISOString(),
      provenanceRef: `agent-ledger://${encodeURIComponent(registrationId)}/${encodeURIComponent(externalId)}`,
      eligibleForTicket: true,
    }
  } catch { return malformed(lineNumber, fingerprint) }
}

function malformed(lineNumber: number, fingerprint: string): SourceRecord {
  return { sourceId: 'agent-ledger', externalId: `malformed-line-${lineNumber}`, fingerprint, title: `Malformed ledger line ${lineNumber}`, state: 'invalid', observedAt: new Date(0).toISOString(), provenanceRef: '', eligibleForTicket: false, exclusionReason: 'AMBIGUOUS_PROVENANCE' }
}

function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
