import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import { AgentActivityRepository } from '../agent-activity/agent-activity-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
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

  it('keeps legacy completion unknown and round-trips explicit completion events without using updated time', async () => {
    const { path, database } = await temporaryDatabase()
    const repository = new OperationalRepository(database.db)
    repository.saveTicket({ ...ticket('legacy-done'), status: 'done', updatedAt: '2026-07-10T12:00:00.000Z', payload: { title: 'Legacy done' } })
    repository.saveTicket({ ...ticket('explicit-done'), status: 'done', completedAt: '2026-07-10T11:00:00.000Z', payload: { title: 'Explicit done', completionProvenance: 'findmnemo-lifecycle-v1' } })
    repository.appendTicketStatusEvent({ id: 'event-1', ticketId: 'explicit-done', fromStatus: 'in-progress', toStatus: 'done', occurredAt: '2026-07-10T11:00:00.000Z', completionAt: '2026-07-10T11:00:00.000Z', origin: 'companion', correlationId: 'transition-1' })
    expect(repository.getTicket('legacy-done')).toMatchObject({ completedAt: null, updatedAt: '2026-07-10T12:00:00.000Z' })
    expect(repository.getTicket('explicit-done')).toMatchObject({ completedAt: '2026-07-10T11:00:00.000Z' })
    expect(repository.listTicketStatusEvents('explicit-done')).toEqual([expect.objectContaining({ id: 'event-1', completionAt: '2026-07-10T11:00:00.000Z' })])
    expect(database.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('tickets_completion_idx','ticket_status_events_ticket_time_idx') ORDER BY name").all()).toHaveLength(2)
    database.close()
    const reopened = await openFindMnemoDatabase({ path })
    expect(new OperationalRepository(reopened.db).getTicket('legacy-done')?.completedAt).toBeNull()
    reopened.close()
  })

  it('adds the privacy-minimized agent activity tables and disabled source identity additively', async () => {
    const { database } = await temporaryDatabase()
    const tables = database.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (
      'agent_activity_integrations','agent_assignments','agent_assignment_events','agent_activity_snapshots','agent_project_reviews','agent_activity_runtime'
    ) ORDER BY name`).all() as Array<{ name: string }>
    expect(tables.map((row) => row.name)).toEqual([
      'agent_activity_integrations',
      'agent_activity_runtime',
      'agent_activity_snapshots',
      'agent_assignment_events',
      'agent_assignments',
      'agent_project_reviews',
    ])
    expect(database.db.prepare("SELECT source_id,enabled,policy FROM configured_sources WHERE source_id='agent-activity'").get())
      .toEqual({ source_id: 'agent-activity', enabled: 0, policy: 'review' })
    expect(database.db.prepare("SELECT source_id FROM configured_sources WHERE source_id='agent-ledger'").get()).toBeUndefined()
    expect(database.db.prepare('SELECT capture_enabled,rollout_state FROM agent_activity_runtime WHERE singleton_id=1').get()).toEqual({ capture_enabled: 0, rollout_state: 'disabled' })
    expect(database.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='agent_assignment_events_retention_idx'").get()).toEqual({ name: 'agent_assignment_events_retention_idx' })
    expect(database.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='agent_assignments_activity_page_idx'").get()).toEqual({ name: 'agent_assignments_activity_page_idx' })
    expect(database.db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get()).toEqual({ value: String(DATABASE_SCHEMA_VERSION) })
    database.close()
  })

  it('additively migrates v12 activity attribution without changing legacy identity, links, ownership, sequence, or terminal facts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-v12-activity-'))
    cleanup.push(directory)
    const path = join(directory, 'findmnemo.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      INSERT INTO app_meta(key,value) VALUES('schema_version','12');
      CREATE TABLE tickets (
        id TEXT PRIMARY KEY,status TEXT NOT NULL,source TEXT NOT NULL,origin TEXT NOT NULL,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,payload_json TEXT NOT NULL,completed_at TEXT
      );
      CREATE TABLE ticket_source_links (
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,external_id TEXT NOT NULL,provenance_ref TEXT NOT NULL,
        UNIQUE(source_id,external_id)
      );
      CREATE TABLE agent_activity_integrations (
        id TEXT PRIMARY KEY,
        agent_kind TEXT NOT NULL CHECK(agent_kind IN ('codex-cli','claude-code','pi')),
        adapter_version TEXT NOT NULL,installed_version TEXT,
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),configured INTEGER NOT NULL CHECK(configured IN (0,1)),
        support_level TEXT NOT NULL,freshness_profile TEXT NOT NULL,heartbeat_seconds INTEGER,
        freshness_window_seconds INTEGER NOT NULL,last_attempt_at TEXT,last_event_at TEXT,last_success_at TEXT,
        last_failure_code TEXT,retained_last_success INTEGER NOT NULL DEFAULT 0,secret_ref TEXT,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_assignments (
        assignment_key TEXT PRIMARY KEY,
        integration_id TEXT NOT NULL REFERENCES agent_activity_integrations(id) ON DELETE RESTRICT,
        agent_kind TEXT NOT NULL CHECK(agent_kind IN ('codex-cli','claude-code','pi')),
        generation INTEGER NOT NULL,ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
        last_applied_sequence INTEGER NOT NULL,last_event_id TEXT NOT NULL,reported_state TEXT NOT NULL,
        safe_summary TEXT NOT NULL,summary_source TEXT NOT NULL,summary_owner TEXT NOT NULL,
        project_mapping_state TEXT NOT NULL,project_id TEXT,project_review_token TEXT,project_owner TEXT NOT NULL,
        model_label TEXT,last_observed_at TEXT NOT NULL,fresh_until TEXT,terminal_at TEXT,
        terminal_evidence_kind TEXT,terminal_outcome TEXT,source_update_policy TEXT NOT NULL,
        record_version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_assignment_events (
        event_id TEXT PRIMARY KEY,
        assignment_key TEXT NOT NULL REFERENCES agent_assignments(assignment_key) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,event_kind TEXT NOT NULL,reported_state TEXT,observed_at TEXT NOT NULL,
        received_at TEXT NOT NULL,reason_code TEXT,evidence_kind TEXT NOT NULL,evidence_key TEXT,
        safe_summary TEXT,summary_source TEXT,project_mapping_state TEXT,project_id TEXT,project_review_token TEXT,
        apply_state TEXT NOT NULL,receipt_code TEXT,terminal_evidence_kind TEXT,terminal_outcome TEXT,model_label TEXT,
        UNIQUE(assignment_key,sequence)
      );
    `)
    const assignmentKey = 'f150038ba2c01238297d909369f2dde97a826a5eb9b983268996feadde075da9'
    const ticketId = 'legacy-ticket-linked'
    const eventId = assignmentEventFixture().eventId
    legacy.prepare(`INSERT INTO tickets(id,status,source,origin,created_at,updated_at,payload_json,completed_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(
      ticketId, 'done', 'Codex', 'agent-runtime', '2026-07-14T17:00:00.000Z',
      '2026-07-14T17:00:07.000Z', JSON.stringify({ title: 'Human-owned title', status: 'done' }),
      '2026-07-14T17:00:07.000Z',
    )
    legacy.prepare(`INSERT INTO agent_activity_integrations(
      id,agent_kind,adapter_version,installed_version,enabled,configured,support_level,freshness_profile,
      heartbeat_seconds,freshness_window_seconds,retained_last_success,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'integration-codex-1', 'codex-cli', '1.0.0', '0.144.3', 1, 1, 'manual', 'manual',
      null, 1_800, 0, '2026-07-14T17:00:00.000Z', '2026-07-14T17:00:07.000Z',
    )
    legacy.prepare(`INSERT INTO agent_assignments(
      assignment_key,integration_id,agent_kind,generation,ticket_id,last_applied_sequence,last_event_id,
      reported_state,safe_summary,summary_source,summary_owner,project_mapping_state,project_id,
      project_review_token,project_owner,model_label,last_observed_at,fresh_until,terminal_at,
      terminal_evidence_kind,terminal_outcome,source_update_policy,record_version,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      assignmentKey, 'integration-codex-1', 'codex-cli', 1, ticketId, 7, eventId, 'completed',
      'Human-owned title', 'explicit-user', 'human', 'approved-project', 'project-human', null, 'human',
      'gpt-5-codex', '2026-07-14T17:00:07.000Z', null, '2026-07-14T17:00:07.000Z',
      'user-confirmed', 'completed', 'closed', 9, '2026-07-14T17:00:00.000Z', '2026-07-14T17:00:07.000Z',
    )
    legacy.prepare(`INSERT INTO agent_assignment_events(
      event_id,assignment_key,sequence,event_kind,reported_state,observed_at,received_at,evidence_kind,
      safe_summary,summary_source,project_mapping_state,project_id,apply_state,terminal_evidence_kind,
      terminal_outcome,model_label
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      eventId, assignmentKey, 7, 'completed', null, '2026-07-14T17:00:07.000Z',
      '2026-07-14T17:00:07.000Z', 'manual-command', 'Human-owned title', 'explicit-user',
      'approved-project', 'project-human', 'applied', 'user-confirmed', 'completed', 'gpt-5-codex',
    )
    legacy.prepare(`INSERT INTO ticket_source_links(ticket_id,source_id,external_id,provenance_ref)
      VALUES(?,?,?,?)`).run(ticketId, 'agent-activity', assignmentKey, `agent-activity://integration-codex-1/${assignmentKey}`)
    legacy.close()

    const migrated = await openFindMnemoDatabase({ path })
    expect(migrated.db.prepare(`SELECT assignment_key,ticket_id,last_applied_sequence,safe_summary,summary_owner,
      project_id,project_owner,source_update_policy,record_version,terminal_at,terminal_evidence_kind,
      terminal_outcome,agent_family,execution_surface,model_label,model_source,model_confidence
      FROM agent_assignments`).get()).toEqual({
      assignment_key: assignmentKey,
      ticket_id: ticketId,
      last_applied_sequence: 7,
      safe_summary: 'Human-owned title',
      summary_owner: 'human',
      project_id: 'project-human',
      project_owner: 'human',
      source_update_policy: 'closed',
      record_version: 9,
      terminal_at: '2026-07-14T17:00:07.000Z',
      terminal_evidence_kind: 'user-confirmed',
      terminal_outcome: 'completed',
      agent_family: 'codex',
      execution_surface: 'legacy-ambiguous',
      model_label: 'gpt-5-codex',
      model_source: null,
      model_confidence: null,
    })
    expect(migrated.db.prepare('SELECT ticket_id,external_id,provenance_ref FROM ticket_source_links').get()).toEqual({
      ticket_id: ticketId,
      external_id: assignmentKey,
      provenance_ref: `agent-activity://integration-codex-1/${assignmentKey}`,
    })
    expect(migrated.db.prepare(`SELECT agent_family,execution_surface,model_source,model_confidence
      FROM agent_assignment_events`).get()).toEqual({
      agent_family: 'codex',
      execution_surface: 'legacy-ambiguous',
      model_source: null,
      model_confidence: null,
    })
    const operational = new OperationalRepository(migrated.db)
    const activity = new AgentActivityRepository(
      migrated.db,
      operational,
      new TicketLifecycleService(operational),
      Buffer.alloc(32, 7),
    )
    expect(activity.ingest(assignmentEventFixture())).toMatchObject({
      outcome: 'duplicate',
      assignmentKey,
      ticketId,
    })
    migrated.close()

    const reopened = await openFindMnemoDatabase({ path })
    expect(reopened.db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get())
      .toEqual({ value: String(DATABASE_SCHEMA_VERSION) })
    expect(reopened.db.prepare(`SELECT assignment_key,ticket_id,last_applied_sequence,summary_owner,project_owner,
      source_update_policy,terminal_outcome,agent_family,execution_surface FROM agent_assignments`).get()).toEqual({
      assignment_key: assignmentKey,
      ticket_id: ticketId,
      last_applied_sequence: 7,
      summary_owner: 'human',
      project_owner: 'human',
      source_update_policy: 'closed',
      terminal_outcome: 'completed',
      agent_family: 'codex',
      execution_surface: 'legacy-ambiguous',
    })
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
