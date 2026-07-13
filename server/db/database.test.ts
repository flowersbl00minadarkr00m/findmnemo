import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION, defaultDatabasePath, openFindMnemoDatabase } from './database.js'
import { OperationalRepository, assertPrivateBoundary } from './operational-repository.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'findmnemo-db-'))
  cleanup.push(directory)
  const path = join(directory, 'findmnemo.db')
  return { directory, path, database: await openFindMnemoDatabase({ path }) }
}

function ticket(id: string) {
  return {
    id,
    status: 'todo',
    source: 'Codex',
    origin: 'manual' as const,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    payload: { title: 'Safe ticket metadata' },
  }
}

describe('FindMnemo database', () => {
  it.runIf(process.platform === 'win32')('creates the approved app-data path and enables schema safeguards', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-appdata-'))
    cleanup.push(directory)
    const expected = join(directory, 'FindMnemo', 'findmnemo.db')
    expect(defaultDatabasePath(directory)).toBe(expected)
    const database = await openFindMnemoDatabase({ localAppData: directory })
    expect(database.path).toBe(expected)
    expect(existsSync(expected)).toBe(true)
    expect(database.db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get()).toEqual({ value: String(DATABASE_SCHEMA_VERSION) })
    expect(database.db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(database.db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    database.close()
  })

  it('preserves data across reopen and creates a pre-migration backup', async () => {
    const { path, database } = await temporaryDatabase()
    new OperationalRepository(database.db).saveTicket(ticket('ticket-1'))
    database.close()
    const reopened = await openFindMnemoDatabase({ path })
    expect(existsSync(`${path}.pre-migration.bak`)).toBe(true)
    expect(reopened.db.prepare('SELECT id FROM tickets').get()).toEqual({ id: 'ticket-1' })
    reopened.close()
  })

  it('reuses the resolved default path across rebuild-style reopen and rejects relative overrides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-stable-root-'))
    cleanup.push(directory)
    const first = await openFindMnemoDatabase({ localAppData: directory })
    new OperationalRepository(first.db).saveTicket(ticket('stable-ticket'))
    const stablePath = first.path
    first.close()

    const reopened = await openFindMnemoDatabase({ localAppData: directory })
    expect(reopened.path).toBe(stablePath)
    expect(reopened.db.prepare("SELECT id FROM tickets WHERE id='stable-ticket'").get()).toEqual({ id: 'stable-ticket' })
    reopened.close()
    await expect(openFindMnemoDatabase({ path: 'relative/findmnemo.db' })).rejects.toMatchObject({ code: 'DATA_ROOT_UNAVAILABLE' })
  })

  it('fails safely without overwriting a corrupt database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-corrupt-'))
    cleanup.push(directory)
    const path = join(directory, 'findmnemo.db')
    const corrupt = Buffer.from('not-a-sqlite-database')
    await writeFile(path, corrupt)
    await expect(openFindMnemoDatabase({ path })).rejects.toThrow()
    expect(await readFile(path)).toEqual(corrupt)
  })

  it('rolls back failed transactions and enforces source and Gmail uniqueness', async () => {
    const { database } = await temporaryDatabase()
    const repository = new OperationalRepository(database.db)
    repository.saveTicket(ticket('ticket-1'))
    repository.saveEmailThread({
      accountId: 'account-hash', threadId: 'thread-1', latestMessageId: 'message-1', sender: 'sender@example.com',
      subject: 'Follow up', receivedAt: '2026-07-10T00:00:00.000Z', snippet: 'Bounded snippet', reasonCodes: ['LATEST_FROM_OTHER'],
      triageState: 'confirmed', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    })
    repository.linkTicketSource('ticket-1', 'gmail-followups', 'thread-1', 'gmail://thread-1')
    expect(() => repository.linkTicketSource('ticket-1', 'gmail-followups', 'thread-1', 'gmail://thread-1')).toThrow()
    repository.linkEmailToTicket('account-hash', 'thread-1', 'ticket-1', 'gmail://thread-1', '2026-07-10T00:00:00.000Z')
    expect(() => repository.linkEmailToTicket('account-hash', 'thread-1', 'ticket-1', 'gmail://thread-1', '2026-07-10T00:00:00.000Z')).toThrow()

    expect(() => database.transaction(() => {
      repository.saveTicket(ticket('rolled-back'))
      throw new Error('fixture failure')
    })).toThrow('fixture failure')
    expect(database.db.prepare("SELECT id FROM tickets WHERE id='rolled-back'").get()).toBeUndefined()
    database.close()
  })

  it('enforces provenance uniqueness across two live database connections', async () => {
    const { path, database } = await temporaryDatabase()
    const second = await openFindMnemoDatabase({ path, backupBeforeMigration: false })
    const firstRepository = new OperationalRepository(database.db)
    const secondRepository = new OperationalRepository(second.db)
    firstRepository.saveTicket(ticket('ticket-1'))
    secondRepository.saveTicket(ticket('ticket-2'))
    firstRepository.linkTicketSource('ticket-1', 'project-sdd', 'spec-003', 'registry://spec-003')
    expect(() => secondRepository.linkTicketSource('ticket-2', 'project-sdd', 'spec-003', 'registry://spec-003')).toThrow()
    second.close()
    database.close()
  })

  it('atomically creates one Gmail ticket and returns the original outcome on retries and races', async () => {
    const { path, database } = await temporaryDatabase()
    const second = await openFindMnemoDatabase({ path, backupBeforeMigration: false })
    const firstRepository = new OperationalRepository(database.db)
    const secondRepository = new OperationalRepository(second.db)
    firstRepository.saveEmailThread({
      accountId: 'henry@example.com', threadId: 'thread-create', latestMessageId: 'message-1', sender: 'sender@example.com',
      subject: 'Follow up', receivedAt: '2026-07-10T00:00:00.000Z', snippet: 'Bounded snippet', reasonCodes: ['LATEST_FROM_OTHER'],
      triageState: 'confirmed-untracked', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    })
    const input = {
      accountId: 'henry@example.com', threadId: 'thread-create', expectedVersion: 1, idempotencyKey: 'association-1',
      ticket: ticket('gmail-ticket-1'), create: true, createdAt: '2026-07-10T00:01:00.000Z',
    }

    const first = firstRepository.associateEmailThread(input)
    const sameKey = secondRepository.associateEmailThread({ ...input, ticket: ticket('gmail-ticket-2') })
    const racingKey = secondRepository.associateEmailThread({ ...input, idempotencyKey: 'association-2', ticket: ticket('gmail-ticket-3') })

    expect(sameKey).toEqual(first)
    expect(racingKey).toMatchObject({ ticketId: 'gmail-ticket-1', created: false })
    expect(first.gmailUrl).toContain('/#inbox/thread-create')
    expect(database.db.prepare('SELECT count(*) AS count FROM email_ticket_links').get()).toEqual({ count: 1 })
    expect(database.db.prepare("SELECT count(*) AS count FROM tickets WHERE id LIKE 'gmail-ticket-%'").get()).toEqual({ count: 1 })
    expect(firstRepository.emailThreadState('henry@example.com', 'thread-create')).toEqual({ state: 'linked', linked: true })
    expect(JSON.stringify(firstRepository.getTicket('gmail-ticket-1'))).not.toMatch(/body|token|credential/i)
    second.close()
    database.close()
  })

  it('leaves a confirmed Gmail candidate untracked when association validation fails', async () => {
    const { database } = await temporaryDatabase()
    const repository = new OperationalRepository(database.db)
    repository.saveEmailThread({
      accountId: 'henry@example.com', threadId: 'thread-retry', latestMessageId: 'message-1', sender: 'sender@example.com',
      subject: 'Follow up', receivedAt: '2026-07-10T00:00:00.000Z', snippet: 'Bounded snippet', reasonCodes: ['LATEST_FROM_OTHER'],
      triageState: 'confirmed-untracked', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    })

    expect(() => repository.associateEmailThread({
      accountId: 'henry@example.com', threadId: 'thread-retry', expectedVersion: 99, idempotencyKey: 'failed-association',
      ticket: ticket('never-created'), create: true, createdAt: '2026-07-10T00:01:00.000Z',
    })).toThrow('RECORD_CHANGED')
    expect(repository.emailThreadState('henry@example.com', 'thread-retry')).toEqual({ state: 'confirmed-untracked', linked: false })
    expect(repository.getTicket('never-created')).toBeUndefined()
    database.close()
  })

  it('previews and commits legacy non-demo tickets idempotently without importing excluded records', async () => {
    const { database } = await temporaryDatabase()
    const repository = new OperationalRepository(database.db)
    repository.saveTicket(ticket('conflict'))
    const records = [
      { legacyId: 'legacy-1', excluded: false, ticket: { ...ticket('legacy-1'), origin: 'imported', payload: { id: 'legacy-1', title: 'Migrated ticket', status: 'todo', source: 'Codex', origin: 'imported', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' } } },
      { legacyId: 'demo-1', excluded: true },
      { legacyId: 'conflict', excluded: false, ticket: { ...ticket('conflict'), origin: 'imported' } },
    ]
    const preview = repository.migrateLegacyTickets(records, 'migration-preview', false, '2026-07-11T00:00:00.000Z')
    const committed = repository.migrateLegacyTickets(records, 'migration-commit', true, '2026-07-11T00:00:00.000Z')
    const repeated = repository.migrateLegacyTickets(records, 'migration-commit', true, '2026-07-11T00:00:01.000Z')

    expect(preview).toMatchObject({ eligible: 1, conflicts: 1, excluded: 1 })
    expect(committed).toMatchObject({ eligible: 1, conflicts: 1, excluded: 1, imported: 1 })
    expect(repeated).toEqual(committed)
    expect(repository.getTicket('legacy-1')?.payload).toMatchObject({ title: 'Migrated ticket' })
    expect(database.db.prepare("SELECT count(*) AS count FROM ticket_source_links WHERE source_id='legacy-browser'").get()).toEqual({ count: 1 })
    expect(database.db.prepare("SELECT count(*) AS count FROM audit_events WHERE action='legacy-ticket-migration'").get()).toEqual({ count: 1 })
    database.close()
  })

  it('recovers interrupted runs without changing the previous success timestamp', async () => {
    const { path, database } = await temporaryDatabase()
    const repository = new OperationalRepository(database.db)
    repository.saveConfiguredSource({ id: 'findmnemo-tickets', label: 'Tickets', adapterVersion: '1.0.0', enabled: true, policy: 'auto-create' }, {},
      '2026-07-10T01:00:00.000Z', '2026-07-10T00:00:00.000Z')
    repository.startRun('run-1', ['findmnemo-tickets'], 'hosted', '2026-07-10T01:00:00.000Z')
    repository.saveGmailCheck({ id: 'gmail-run-1', state: 'running', startedAt: '2026-07-10T01:00:00.000Z', coverageStart: '2026-06-10T00:00:00.000Z', coverageEnd: '2026-07-10T01:00:00.000Z', checkedThreads: 1, candidateThreads: 1, excludedThreads: 0, failedThreadIds: [] })
    database.close()
    const reopened = await openFindMnemoDatabase({ path })
    expect(reopened.db.prepare("SELECT state FROM reconciliation_runs WHERE id='run-1'").get()).toEqual({ state: 'failed' })
    expect(reopened.db.prepare("SELECT last_attempt_at,last_success_at FROM configured_sources WHERE source_id='findmnemo-tickets'").get())
      .toEqual({ last_attempt_at: '2026-07-10T01:00:00.000Z', last_success_at: '2026-07-10T00:00:00.000Z' })
    expect(new OperationalRepository(reopened.db).getGmailCheck('gmail-run-1')).toMatchObject({ state: 'failed', errorCode: 'SOURCE_CHECK_FAILED', checkedThreads: 1 })
    reopened.close()
  })

  it('rejects body, token, credential, and prompt fields from persisted JSON and audit input', async () => {
    for (const value of [{ body: 'private' }, { refreshToken: 'private' }, { nested: { credential: 'private' } }, { raw_prompt: 'private' }]) {
      expect(() => assertPrivateBoundary(value)).toThrow(/Private field/)
    }
    const { database } = await temporaryDatabase()
    const repository = new OperationalRepository(database.db)
    expect(() => repository.appendAudit({ timestamp: '2026-07-10T00:00:00.000Z', action: 'gmail-check', objectRefs: [], result: 'ok', accessToken: 'bad' } as never)).toThrow(/Private field/)
    database.close()
  })
})
