import { createHash, randomUUID } from 'node:crypto'
import type {
  CompanionReasonCode,
  LocalSourceAdapter,
  ReconciliationItemResultDto,
  ReconciliationRunDto,
  ReconciliationSourceResultDto,
  SourceId,
  SourceRecord,
} from '../../shared/companion-contract.js'
import type { OperationalRepository, StoredTicket } from '../db/operational-repository.js'
import type { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'

const ZERO_COUNTS = { checked: 0, added: 0, updated: 0, unchanged: 0, excluded: 0, duplicate: 0, unresolved: 0 }

export class ReconciliationEngine {
  private readonly adapters = new Map<SourceId, LocalSourceAdapter>()
  private readonly repository: OperationalRepository
  private readonly clock: () => Date
  private readonly lifecycle?: TicketLifecycleService

  constructor(
    repository: OperationalRepository,
    adapters: readonly LocalSourceAdapter[],
    clock: () => Date = () => new Date(),
    lifecycle?: TicketLifecycleService,
  ) {
    this.repository = repository
    this.clock = clock
    this.lifecycle = lifecycle
    for (const adapter of adapters) this.adapters.set(adapter.descriptor.id, adapter)
  }

  sources() {
    return [...this.adapters.values()].map((adapter) => this.repository.getConfiguredSource(adapter.descriptor.id)?.descriptor ?? adapter.descriptor)
  }

  start(requestedSourceIds?: readonly SourceId[], initiatingSurface = 'hosted'): ReconciliationRunDto {
    const sourceIds = [...new Set(requestedSourceIds?.length ? requestedSourceIds : this.sources().map((source) => source.id))]
    const id = randomUUID()
    this.repository.startRun(id, sourceIds, initiatingSurface, this.clock().toISOString())
    void this.execute(id, sourceIds)
    return this.repository.getRun(id)!
  }

  async run(requestedSourceIds?: readonly SourceId[], initiatingSurface = 'test'): Promise<ReconciliationRunDto> {
    const sourceIds = [...new Set(requestedSourceIds?.length ? requestedSourceIds : this.sources().map((source) => source.id))]
    const id = randomUUID()
    this.repository.startRun(id, sourceIds, initiatingSurface, this.clock().toISOString())
    await this.execute(id, sourceIds)
    return this.repository.getRun(id)!
  }

  get(id: string) { return this.repository.getRun(id) }
  history(limit = 20) { return this.repository.listRuns(limit) }

  retry(id: string, requestedSourceIds?: readonly SourceId[]): ReconciliationRunDto | undefined {
    const prior = this.repository.getRun(id)
    if (!prior) return undefined
    const eligible = prior.sources.filter((source) => ['failed', 'unavailable'].includes(source.state) || source.unresolved > 0 || source.duplicate > 0).map((source) => source.sourceId)
    const retryIds = requestedSourceIds?.length ? eligible.filter((sourceId) => requestedSourceIds.includes(sourceId)) : eligible
    return this.start(retryIds.length ? retryIds : prior.requestedSourceIds, 'retry')
  }

  private async execute(runId: string, sourceIds: readonly SourceId[]): Promise<void> {
    for (const sourceId of sourceIds) await this.executeSource(runId, sourceId)
    const run = this.repository.getRun(runId)!
    const enabled = run.sources.filter((source) => source.state !== 'skipped')
    const successful = enabled.filter((source) => source.state === 'checked')
    const hasGap = enabled.some((source) => source.state !== 'checked' || source.duplicate > 0 || source.unresolved > 0)
    const state = successful.length === 0 ? 'failed' : hasGap ? 'partial' : 'complete'
    const counts = run.sources.reduce((total, source) => {
      for (const key of Object.keys(ZERO_COUNTS) as Array<keyof typeof ZERO_COUNTS>) total[key] += source[key]
      return total
    }, { ...ZERO_COUNTS })
    this.repository.finishRun(runId, state, counts, this.clock().toISOString())
    this.repository.appendAudit({ timestamp: this.clock().toISOString(), action: 'reconcile', objectRefs: [runId], result: state })
  }

  private async executeSource(runId: string, sourceId: SourceId): Promise<void> {
    const adapter = this.adapters.get(sourceId)
    if (!adapter) {
      this.repository.saveRunSource(runId, sourceResult(sourceId, 'unavailable', {}, 'SOURCE_NOT_CONFIGURED', 'SOURCE_UNAVAILABLE'))
      return
    }
    const configured = this.repository.getConfiguredSource(sourceId)?.descriptor ?? adapter.descriptor
    if (!configured.enabled) {
      this.repository.saveRunSource(runId, sourceResult(sourceId, 'skipped', {}, 'DISABLED_BY_USER'))
      return
    }
    try {
      const records: SourceRecord[] = []
      let complete = false
      const controller = new AbortController()
      for await (const batch of adapter.check({ runId, signal: controller.signal })) {
        records.push(...batch.records)
        complete ||= batch.complete
      }
      this.repository.transaction(() => this.commitSource(runId, configured.policy, sourceId, records))
      if (complete) {
        this.repository.saveConfiguredSource(configured, this.repository.getConfiguredSource(sourceId)?.config ?? {}, this.clock().toISOString(), this.clock().toISOString())
      } else {
        const committed = this.repository.getRun(runId)?.sources.find((source) => source.sourceId === sourceId)
        this.repository.saveRunSource(runId, { ...(committed ?? sourceResult(sourceId, 'failed', {})), state: 'failed', errorCode: 'SOURCE_CHECK_FAILED' })
        this.repository.saveConfiguredSource(configured, this.repository.getConfiguredSource(sourceId)?.config ?? {}, this.clock().toISOString())
      }
    } catch {
      this.repository.saveRunSource(runId, sourceResult(sourceId, 'failed', {}, undefined, 'SOURCE_CHECK_FAILED'))
      this.repository.saveConfiguredSource(configured, this.repository.getConfiguredSource(sourceId)?.config ?? {}, this.clock().toISOString())
    }
  }

  private commitSource(runId: string, policy: 'auto-create' | 'review' | 'exclude', sourceId: SourceId, records: SourceRecord[]): void {
    const counts = { ...ZERO_COUNTS }
    const frequencies = new Map<string, number>()
    for (const record of records) frequencies.set(record.externalId, (frequencies.get(record.externalId) ?? 0) + 1)
    for (const record of records.filter((item, index, all) => all.findIndex((candidate) => candidate.externalId === item.externalId) === index)) {
      let item: ReconciliationItemResultDto
      try {
        item = this.classifyAndMutate(policy, record, (frequencies.get(record.externalId) ?? 0) > 1)
      } catch {
        item = { sourceId, externalId: record.externalId, classification: 'unresolved', errorCode: 'INTERNAL_ERROR' }
      }
      counts.checked += 1
      counts[item.classification] += 1
      this.repository.saveRunItem(runId, item)
    }
    this.repository.saveRunSource(runId, sourceResult(sourceId, 'checked', counts))
  }

  private classifyAndMutate(policy: 'auto-create' | 'review' | 'exclude', record: SourceRecord, repeated: boolean): ReconciliationItemResultDto {
    const base = { sourceId: record.sourceId, externalId: record.externalId }
    if (repeated) return { ...base, classification: 'duplicate', reasonCode: 'DUPLICATE_PROVENANCE' }
    if (!record.provenanceRef || !record.externalId) return { ...base, classification: 'unresolved', reasonCode: 'AMBIGUOUS_PROVENANCE' }
    if (policy === 'exclude' || !record.eligibleForTicket) return { ...base, classification: 'excluded', reasonCode: record.exclusionReason ?? 'SOURCE_RECORD_INELIGIBLE' }
    if (record.sourceId === 'findmnemo-tickets') {
      this.repository.saveSourceRecord(record)
      return { ...base, classification: 'unchanged', ticketId: record.externalId }
    }
    const link = this.repository.ticketLinkForRecord(record)
    const prior = this.repository.getSourceRecord(record.sourceId, record.externalId)
    if (link) {
      const classification = prior && prior.fingerprint !== record.fingerprint ? 'updated' : 'unchanged'
      if (classification === 'updated') this.updateLinkedTicket(link.ticketId, record)
      this.repository.saveSourceRecord(record)
      return { ...base, classification, ticketId: link.ticketId }
    }
    if (policy === 'review') {
      this.repository.saveSourceRecord(record)
      return { ...base, classification: 'unresolved', reasonCode: 'REVIEW_REQUIRED' }
    }
    const ticket = ticketFromRecord(record, this.clock().toISOString())
    if (this.lifecycle) this.lifecycle.createWithinTransaction(ticket, `reconciliation:${record.sourceId}`)
    else this.repository.saveTicket(ticket)
    this.repository.linkTicketSource(ticket.id, record.sourceId, record.externalId, record.provenanceRef)
    this.repository.saveSourceRecord(record)
    return { ...base, classification: 'added', ticketId: ticket.id }
  }

  private updateLinkedTicket(ticketId: string, record: SourceRecord): void {
    const ticket = this.repository.getTicket(ticketId)
    if (!ticket) throw new Error('linked ticket missing')
    const status = approvedStatus(record.state, ticket.status)
    if (this.lifecycle) this.lifecycle.transitionWithinTransaction({ ticketId, expectedUpdatedAt: ticket.updatedAt, nextPayload: { ...ticket.payload, title: record.title, status }, origin: `reconciliation:${record.sourceId}` })
    else this.repository.saveTicket({ ...ticket, status, updatedAt: this.clock().toISOString(), payload: { ...ticket.payload, title: record.title } })
  }
}

function ticketFromRecord(record: SourceRecord, now: string): StoredTicket {
  const digest = createHash('sha256').update(`${record.sourceId}\0${record.externalId}`).digest('hex').slice(0, 24)
  return { id: `reconciled-${digest}`, status: approvedStatus(record.state, 'todo'), source: 'Codex', origin: 'local-bridge', createdAt: now, updatedAt: now, payload: { id: `reconciled-${digest}`, title: record.title, description: `Reconciled from ${record.sourceId}.`, source: 'Codex', status: approvedStatus(record.state, 'todo'), origin: 'local-bridge', createdAt: now, updatedAt: now, workNotes: [], decisionLog: [], artifacts: [] } }
}

function approvedStatus(state: string, fallback: string): string { return ['todo', 'in-progress', 'done', 'blocked'].includes(state) ? state : fallback }

function sourceResult(sourceId: SourceId, state: ReconciliationSourceResultDto['state'], counts: Partial<typeof ZERO_COUNTS>, reasonCode?: CompanionReasonCode, errorCode?: ReconciliationSourceResultDto['errorCode']): ReconciliationSourceResultDto {
  return { sourceId, state, ...ZERO_COUNTS, ...counts, reasonCode, errorCode }
}
