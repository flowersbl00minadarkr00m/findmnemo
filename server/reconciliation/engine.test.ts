import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LocalSourceAdapter, SourceRecord } from '../../shared/companion-contract.js'
import { FakeSourceAdapter, createSourceDescriptor } from '../../shared/test/fakes.js'
import { openFindMnemoDatabase, type FindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { GmailFollowupsAdapter } from './adapters/gmail-followups.js'
import { FindMnemoTicketsAdapter } from './adapters/findmnemo-tickets.js'
import { ReconciliationEngine } from './engine.js'

const NOW = '2026-07-11T08:00:00.000Z'

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    sourceId: 'agent-ledger', externalId: 'work-1', fingerprint: 'fingerprint-1', title: 'Observed work', state: 'todo',
    observedAt: NOW, provenanceRef: 'agent-ledger://approved/work-1', eligibleForTicket: true, ...overrides,
  }
}

describe('deterministic reconciliation engine', () => {
  let directory: string
  let database: FindMnemoDatabase
  let repository: OperationalRepository

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'findmnemo-reconciliation-'))
    database = await openFindMnemoDatabase({ path: join(directory, 'test.db'), backupBeforeMigration: false })
    repository = new OperationalRepository(database.db)
  })

  afterEach(async () => {
    database.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('adds once, then classifies the same stable input as unchanged without handoff telemetry', async () => {
    const firstAdapter = new FakeSourceAdapter([{ records: [record()], complete: true }])
    const first = await new ReconciliationEngine(repository, [firstAdapter], () => new Date(NOW)).run()
    const second = await new ReconciliationEngine(repository, [firstAdapter], () => new Date(NOW)).run()

    expect(first).toMatchObject({ state: 'complete', items: [{ classification: 'added' }] })
    expect(second).toMatchObject({ state: 'complete', items: [{ classification: 'unchanged' }] })
    expect(database.db.prepare('SELECT count(*) AS count FROM tickets').get()).toEqual({ count: 1 })
    expect(database.db.prepare('SELECT count(*) AS count FROM ticket_source_links').get()).toEqual({ count: 1 })
    expect(database.db.prepare("SELECT count(*) AS count FROM audit_events WHERE action='handoff'").get()).toEqual({ count: 0 })
    expect(database.db.prepare("SELECT count(*) AS count FROM audit_events WHERE action='reconcile'").get()).toEqual({ count: 2 })
  })

  it('updates approved mapped fields on fingerprint change and explicitly excludes excluded policy records', async () => {
    const initial = new FakeSourceAdapter([{ records: [record()], complete: true }])
    await new ReconciliationEngine(repository, [initial], () => new Date(NOW)).run()
    const changed = new FakeSourceAdapter([{ records: [record({ fingerprint: 'fingerprint-2', title: 'Updated observed work', state: 'in-progress' })], complete: true }])
    const updated = await new ReconciliationEngine(repository, [changed], () => new Date(NOW)).run()
    expect(updated.items[0]).toMatchObject({ classification: 'updated' })
    expect(repository.listTickets()[0]).toMatchObject({ status: 'in-progress', payload: { title: 'Updated observed work' } })

    const excluded = new FakeSourceAdapter([{ records: [record({ sourceId: 'project-sdd', externalId: 'spec-1', provenanceRef: 'registry://spec-1' })], complete: true }],
      createSourceDescriptor({ id: 'project-sdd', label: 'Project SDD', policy: 'exclude' }))
    const excludedRun = await new ReconciliationEngine(repository, [excluded], () => new Date(NOW)).run()
    expect(excludedRun).toMatchObject({ state: 'complete', items: [{ classification: 'excluded', reasonCode: 'SOURCE_RECORD_INELIGIBLE' }] })
  })

  it('isolates a failed source, retains successful source work, and supports a named retry run', async () => {
    const good = new FakeSourceAdapter([{ records: [record()], complete: true }])
    const failing: LocalSourceAdapter = {
      descriptor: createSourceDescriptor({ id: 'project-sdd', label: 'Project SDD' }),
      check() { return { [Symbol.asyncIterator]() { return { next: async () => { throw new Error('fixture failure') } } } } },
    }
    const engine = new ReconciliationEngine(repository, [good, failing], () => new Date(NOW))
    const run = await engine.run()

    expect(run.state).toBe('partial')
    expect(run.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'agent-ledger', state: 'checked', added: 1 }),
      expect.objectContaining({ sourceId: 'project-sdd', state: 'failed', errorCode: 'SOURCE_CHECK_FAILED' }),
    ]))
    expect(repository.listTickets()).toHaveLength(1)
    const retried = engine.retry(run.id)
    expect(retried?.requestedSourceIds).toEqual(['project-sdd'])
  })

  it('persists completed items from an incomplete source batch and reports the source gap', async () => {
    const incomplete = new FakeSourceAdapter([{ records: [record()], complete: false }])
    const run = await new ReconciliationEngine(repository, [incomplete], () => new Date(NOW)).run()
    expect(run).toMatchObject({ state: 'failed', sources: [{ state: 'failed', added: 1, errorCode: 'SOURCE_CHECK_FAILED' }], items: [{ classification: 'added' }] })
    expect(repository.listTickets()).toHaveLength(1)
  })

  it('makes duplicate and review-required records durable and marks the run partial', async () => {
    const duplicate = new FakeSourceAdapter([{ records: [record(), record({ fingerprint: 'different' })], complete: true }])
    const review = new FakeSourceAdapter([{ records: [record({ sourceId: 'gmail-followups', externalId: 'account:thread', provenanceRef: 'gmail://account/thread' })], complete: true }],
      createSourceDescriptor({ id: 'gmail-followups', label: 'Gmail follow-ups', policy: 'review' }))
    const run = await new ReconciliationEngine(repository, [duplicate, review], () => new Date(NOW)).run()

    expect(run.state).toBe('partial')
    expect(run.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'agent-ledger', classification: 'duplicate', reasonCode: 'DUPLICATE_PROVENANCE' }),
      expect.objectContaining({ sourceId: 'gmail-followups', classification: 'unresolved', reasonCode: 'REVIEW_REQUIRED' }),
    ]))
    expect(repository.getRun(run.id)?.items).toHaveLength(2)
  })

  it('excludes disabled sources from completeness while disclosing them as skipped', async () => {
    const enabled = new FakeSourceAdapter([{ records: [record()], complete: true }])
    const disabledDescriptor = createSourceDescriptor({ id: 'project-sdd', label: 'Project SDD', enabled: false })
    const disabled = new FakeSourceAdapter([{ records: [record({ sourceId: 'project-sdd' })], complete: true }], disabledDescriptor)
    repository.saveConfiguredSource(disabledDescriptor, {})
    const run = await new ReconciliationEngine(repository, [enabled, disabled], () => new Date(NOW)).run()

    expect(run.state).toBe('complete')
    expect(run.sources).toContainEqual(expect.objectContaining({ sourceId: 'project-sdd', state: 'skipped', reasonCode: 'DISABLED_BY_USER' }))
  })

  it('reconciles an already-linked Gmail follow-up as unchanged and never creates a second ticket', async () => {
    repository.saveEmailThread({ accountId: 'account', threadId: 'thread', latestMessageId: 'message', sender: 'person@example.com', subject: 'Reply needed', receivedAt: NOW, snippet: 'Bounded', reasonCodes: ['LATEST_FROM_OTHER'], triageState: 'confirmed-untracked', createdAt: NOW, updatedAt: NOW })
    repository.associateEmailThread({ accountId: 'account', threadId: 'thread', expectedVersion: 1, idempotencyKey: 'gmail-link', create: true, createdAt: NOW,
      ticket: { id: 'gmail-ticket', status: 'todo', source: 'Codex', origin: 'local-bridge', createdAt: NOW, updatedAt: NOW, payload: { title: 'Reply needed' } } })
    const engine = new ReconciliationEngine(repository, [new FindMnemoTicketsAdapter(repository), new GmailFollowupsAdapter(repository)], () => new Date(NOW))
    const run = await engine.run()

    expect(run.state).toBe('complete')
    expect(run.items).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'gmail-followups', classification: 'unchanged', ticketId: 'gmail-ticket' })]))
    expect(repository.listTickets()).toHaveLength(1)
    expect(database.db.prepare("SELECT count(*) AS count FROM audit_events WHERE action='handoff'").get()).toEqual({ count: 0 })
  })
})
