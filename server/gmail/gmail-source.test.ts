import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openFindMnemoDatabase, type FindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { classifyGmailThread } from './candidate-classifier.js'
import { GmailMetadataClient, type GmailThread } from './gmail-client.js'
import { GmailCheckService, gmailAccountId } from './gmail-source.js'

const NOW = new Date('2026-07-11T08:00:00.000Z')
const recent = String(NOW.getTime() - 3_600_000)

function message(id: string, from: string, headers: Record<string, string> = {}, labels = ['INBOX'], snippet = 'A bounded metadata preview') {
  return {
    id, internalDate: recent, labelIds: labels, snippet,
    payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: `Subject ${id}` }, ...Object.entries(headers).map(([name, value]) => ({ name, value }))] },
  }
}

describe('Gmail metadata candidate classifier', () => {
  it('classifies conversational, self-replied, automated, discarded, dismissed, and linked threads', () => {
    const aliases = ['henry@example.com']
    const classify = (messages: GmailThread['messages'], prior = {}) => classifyGmailThread({ id: 'thread', messages }, aliases, prior)
    expect(classify([message('other', 'Colleague <person@example.com>')]).reasonCodes).toEqual(['LATEST_FROM_OTHER', 'NO_LATER_SELF_REPLY', 'NOT_AUTOMATED'])
    expect(classify([message('self', 'Henry <henry@example.com>')]).reasonCodes).toEqual(['LATEST_FROM_SELF'])
    expect(classify([message('bulk', 'newsletter@example.com', { Precedence: 'bulk' })]).reasonCodes).toEqual(['AUTOMATED_MESSAGE'])
    expect(classify([message('draft', 'person@example.com', {}, ['DRAFT'])]).reasonCodes).toEqual(['DRAFT_SPAM_OR_TRASH'])
    expect(classify([message('dismissed', 'person@example.com')], { state: 'dismissed' }).reasonCodes).toEqual(['ALREADY_DISMISSED'])
    expect(classify([message('linked', 'person@example.com')], { linked: true }).reasonCodes).toEqual(['ALREADY_LINKED'])
  })
})

describe('Gmail metadata source', () => {
  let directory: string
  let database: FindMnemoDatabase
  let repository: OperationalRepository

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'findmnemo-gmail-source-'))
    database = await openFindMnemoDatabase({ path: join(directory, 'test.db'), backupBeforeMigration: false })
    repository = new OperationalRepository(database.db)
  })

  afterEach(async () => {
    database.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('persists incremental metadata-only candidates and reports thread gaps as partial', async () => {
    const requested: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'history-2' })
      if (url.includes('/threads?')) return json({ threads: [{ id: 'candidate' }, { id: 'self' }, { id: 'automated' }, { id: 'failed' }] })
      if (url.includes('/threads/candidate?')) return json({ id: 'candidate', messages: [message('m1', 'Person <person@example.com>', {}, ['INBOX'], 'x'.repeat(300))] })
      if (url.includes('/threads/self?')) return json({ id: 'self', messages: [message('m2', 'Henry <henry@example.com>')] })
      if (url.includes('/threads/automated?')) return json({ id: 'automated', messages: [message('m3', 'no-reply@example.com')] })
      return json({ error: 'fixture failure' }, 500)
    })
    const service = new GmailCheckService(new GmailMetadataClient(async () => 'fake-access', fetcher as unknown as typeof fetch), repository, () => new Date(NOW))

    const started = service.start()
    await vi.waitFor(() => expect(service.get(started.id)?.state).not.toBe('running'))
    const result = service.get(started.id)

    expect(result).toMatchObject({ state: 'partial', checkedThreads: 3, candidateThreads: 1, excludedThreads: 2, failedThreadIds: ['failed'] })
    const candidates = service.candidates()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].accountId).toBe(gmailAccountId('henry@example.com'))
    expect(service.records().map((record) => record.threadId)).toEqual(['candidate'])
    expect([...candidates[0].snippet]).toHaveLength(240)
    expect(candidates[0].gmailUrl).toContain('/#inbox/candidate')
    expect(requested.some((url) => url.includes('q='))).toBe(false)
    expect(requested.filter((url) => url.includes('/threads/')).every((url) => url.includes('format=metadata'))).toBe(true)
    expect(requested.join(' ')).not.toContain('body')
    expect(JSON.stringify(database.db.prepare('SELECT * FROM email_threads').all())).not.toContain('MIME_FIXTURE_BODY')
    expect(JSON.stringify(database.db.prepare('SELECT * FROM email_threads').all())).not.toContain('henry@example.com')
  })

  it('removes legacy synthetic exclusion cards without deleting real confirmed work', () => {
    repository.saveEmailThread({ accountId: 'henry@example.com', threadId: 'synthetic', latestMessageId: 'm1', sender: 'no-reply@example.com', subject: 'Automated', receivedAt: NOW.toISOString(), snippet: '', reasonCodes: ['AUTOMATED_MESSAGE'], triageState: 'confirmed-untracked', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() })
    repository.saveEmailThread({ accountId: 'henry@example.com', threadId: 'confirmed', latestMessageId: 'm2', sender: 'person@example.com', subject: 'Real follow-up', receivedAt: NOW.toISOString(), snippet: '', reasonCodes: ['LATEST_FROM_OTHER'], triageState: 'confirmed-untracked', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() })

    new GmailCheckService(new GmailMetadataClient(async () => 'fake-access'), repository, () => new Date(NOW))

    expect(repository.listEmailThreads().map((record) => record.threadId)).toEqual(['confirmed'])
  })

  it('uses a five-day default and stops pagination after crossing the lookback boundary', async () => {
    const old = String(NOW.getTime() - 6 * 86_400_000)
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'history-5d' })
      if (url.includes('/threads?') && !url.includes('pageToken=')) return json({ threads: [{ id: 'recent' }], nextPageToken: 'page-2' })
      if (url.includes('pageToken=page-2')) return json({ threads: [{ id: 'old' }], nextPageToken: 'page-3' })
      if (url.includes('/threads/recent?')) return json({ id: 'recent', messages: [message('recent-message', 'person@example.com')] })
      if (url.includes('/threads/old?')) return json({ id: 'old', messages: [{ ...message('old-message', 'person@example.com'), internalDate: old }] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const service = new GmailCheckService(new GmailMetadataClient(async () => 'fake-access', fetcher as unknown as typeof fetch), repository, () => new Date(NOW))

    const run = service.start()
    await vi.waitFor(() => expect(service.get(run.id)?.state).toBe('complete'))

    expect(service.get(run.id)?.coverageStart).toBe(new Date(NOW.getTime() - 5 * 86_400_000).toISOString())
    expect(service.get(run.id)?.checkedThreads).toBe(1)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('pageToken=page-3'))).toBe(false)
  })

  it('uses the history cursor on repeat without duplicating candidates', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'history-3' })
      if (url.includes('/history?')) return json({ historyId: 'history-3', history: [{ messagesAdded: [{ message: { threadId: 'candidate' } }] }] })
      if (url.includes('/threads?')) return json({ threads: [{ id: 'candidate' }] })
      if (url.includes('/threads/candidate?')) return json({ id: 'candidate', messages: [message('m1', 'person@example.com')] })
      return json({}, 404)
    })
    const service = new GmailCheckService(new GmailMetadataClient(async () => 'fake-access', fetcher as unknown as typeof fetch), repository, () => new Date(NOW))

    const first = service.start()
    await vi.waitFor(() => expect(service.get(first.id)?.state).toBe('complete'))
    const second = service.start()
    await vi.waitFor(() => expect(service.get(second.id)?.state).toBe('complete'))

    expect(service.candidates()).toHaveLength(1)
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/history?'))).toBe(true)
    expect(repository.getConfiguredSource('gmail-followups')?.lastSuccessAt).toBe(NOW.toISOString())
  })

  it('reads every Gmail history page and de-duplicates thread IDs', async () => {
    repository.saveConfiguredSource({ id: 'gmail-followups', label: 'Gmail', adapterVersion: '1.0.0', enabled: true, policy: 'review' }, { historyId: 'history-start' })
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'history-final' })
      if (url.includes('/history?') && !url.includes('pageToken=')) return json({ historyId: 'history-mid', nextPageToken: 'page-2', history: [{ messagesAdded: [{ message: { threadId: 'one' } }] }] })
      if (url.includes('/history?') && url.includes('pageToken=page-2')) return json({ historyId: 'history-final', history: [{ messagesAdded: [{ message: { threadId: 'one' } }, { message: { threadId: 'two' } }] }] })
      if (url.includes('/threads/one?')) return json({ id: 'one', messages: [message('one-message', 'person@example.com')] })
      if (url.includes('/threads/two?')) return json({ id: 'two', messages: [message('two-message', 'person@example.com')] })
      throw new Error(`Unexpected request: ${url}`)
    })
    const service = new GmailCheckService(new GmailMetadataClient(async () => 'fake-access', fetcher as unknown as typeof fetch), repository, () => new Date(NOW))

    const run = service.start()
    await vi.waitFor(() => expect(service.get(run.id)?.state).toBe('complete'))

    expect(service.candidates().map((candidate) => candidate.threadId).sort()).toEqual(['one', 'two'])
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/history?'))).toHaveLength(2)
    expect(repository.getConfiguredSource('gmail-followups')?.config.historyId).toBe('history-final')
  })

  it('migrates raw account identifiers and linked provenance to the stable account hash', () => {
    const previousAccountId = 'henry@example.com'
    const accountId = gmailAccountId(previousAccountId)
    repository.saveTicket({ id: 'ticket-1', status: 'todo', source: 'Codex', origin: 'local-bridge', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), payload: { id: 'ticket-1', status: 'todo', source: 'Codex', origin: 'local-bridge', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() } })
    repository.saveEmailThread({ accountId: previousAccountId, threadId: 'thread-1', latestMessageId: 'm1', sender: 'person@example.com', subject: 'Follow up', receivedAt: NOW.toISOString(), snippet: 'Preview', reasonCodes: ['LATEST_FROM_OTHER'], triageState: 'confirmed-untracked', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() })
    repository.associateEmailThread({ accountId: previousAccountId, threadId: 'thread-1', expectedVersion: 1, idempotencyKey: 'migration-result', ticket: repository.getTicket('ticket-1')!, create: false, createdAt: NOW.toISOString() })
    database.db.prepare("INSERT INTO reconciliation_runs(id,started_at,state,requested_source_ids_json,initiating_surface) VALUES('run-1',?,'complete','[]','local')").run(NOW.toISOString())
    database.db.prepare("INSERT INTO reconciliation_items(run_id,source_id,external_id,classification) VALUES('run-1','gmail-followups',?,'unchanged')").run(`${previousAccountId}:thread-1`)

    repository.migrateGmailAccountId(previousAccountId, accountId)

    expect(repository.listEmailThreads()[0]).toMatchObject({ accountId, state: 'linked' })
    expect(repository.listEmailThreads()[0].gmailUrl).toContain('/mail/u/0/#inbox/thread-1')
    const stored = JSON.stringify([
      ...database.db.prepare('SELECT * FROM email_threads').all(),
      ...database.db.prepare('SELECT * FROM email_ticket_links').all(),
      ...database.db.prepare('SELECT * FROM idempotency_results').all(),
      ...database.db.prepare('SELECT * FROM reconciliation_items').all(),
    ])
    expect(stored).not.toContain(previousAccountId)
    expect(stored).toContain(accountId)
  })

  it('falls back from an invalid history cursor and reports the reset honestly', async () => {
    repository.saveConfiguredSource({ id: 'gmail-followups', label: 'Gmail', adapterVersion: '1.0.0', enabled: true, policy: 'review' }, { historyId: 'expired' })
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'fresh' })
      if (url.includes('/history?')) return json({}, 404)
      if (url.includes('/threads?')) return json({ threads: [] })
      return json({}, 404)
    })
    const service = new GmailCheckService(new GmailMetadataClient(async () => 'fake-access', fetcher as unknown as typeof fetch), repository, () => new Date(NOW))

    const run = service.start()
    await vi.waitFor(() => expect(service.get(run.id)?.state).toBe('partial'))
    expect(service.get(run.id)?.errorCode).toBe('GMAIL_HISTORY_INVALID')
  })

  it('bounds concurrency, exposes incremental results promptly, and aborts timed-out requests', async () => {
    let active = 0
    let maxActive = 0
    let aborted = 0
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'history-bounded' })
      if (url.includes('/threads?')) return json({ threads: [{ id: 'one' }, { id: 'two' }, { id: 'timeout' }] })
      if (url.includes('/threads/timeout?')) return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { aborted += 1; reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
      })
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      const id = url.includes('/threads/one?') ? 'one' : 'two'
      return json({ id, messages: [message(`message-${id}`, 'person@example.com')] })
    })
    const service = new GmailCheckService(
      new GmailMetadataClient(async () => 'fake-access', fetcher as unknown as typeof fetch),
      repository,
      () => new Date(NOW),
      30,
      20,
      2,
      50,
    )

    const startedAt = Date.now()
    const run = service.start()
    await vi.waitFor(() => expect(service.candidates().length).toBeGreaterThan(0))
    expect(Date.now() - startedAt).toBeLessThan(10_000)
    await vi.waitFor(() => expect(service.get(run.id)?.state).toBe('partial'))

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(aborted).toBe(3)
    expect(service.get(run.id)?.failedThreadIds).toEqual(['timeout'])
  })

  it('applies candidate decisions only at the expected record version', () => {
    repository.saveEmailThread({
      accountId: 'henry@example.com', threadId: 'decision-thread', latestMessageId: 'message-1',
      sender: 'person@example.com', subject: 'Decision', receivedAt: NOW.toISOString(), snippet: 'Preview',
      reasonCodes: ['LATEST_FROM_OTHER'], triageState: 'candidate', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    })

    const updated = repository.updateEmailThreadState('henry@example.com', 'decision-thread', 1, 'deferred', NOW.toISOString())
    const stale = repository.updateEmailThreadState('henry@example.com', 'decision-thread', 1, 'dismissed', NOW.toISOString())

    expect(updated).toMatchObject({ state: 'deferred', recordVersion: 2 })
    expect(stale).toBeUndefined()
    expect(repository.listEmailThreads()[0]).toMatchObject({ state: 'deferred', recordVersion: 2 })
  })

  it('persists incremental results before a slow thread finishes and bounds timed-out retries', async () => {
    let releaseSlow!: () => void
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve })
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'bounded' })
      if (url.includes('/threads?')) return json({ threads: [{ id: 'fast' }, { id: 'slow' }] })
      if (url.includes('/threads/fast?')) return json({ id: 'fast', messages: [message('fast-message', 'person@example.com')] })
      if (url.includes('/threads/slow?')) { await slow; return json({ id: 'slow', messages: [message('slow-message', 'person@example.com')] }) }
      return json({}, 404)
    })
    const service = new GmailCheckService(new GmailMetadataClient(async () => 'fake-access', fetcher as unknown as typeof fetch), repository, () => new Date(NOW), 30, 20, 2, 1_000)
    const startedAt = performance.now()
    const run = service.start()
    await vi.waitFor(() => expect(service.candidates().map((candidate) => candidate.threadId)).toContain('fast'))
    expect(service.get(run.id)?.state).toBe('running')
    expect(performance.now() - startedAt).toBeLessThan(10_000)
    releaseSlow()
    await vi.waitFor(() => expect(service.get(run.id)?.state).toBe('complete'))

    const never = new Promise<Response>(() => undefined)
    const timeoutFetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/profile')) return json({ emailAddress: 'henry@example.com', historyId: 'timeout' })
      if (url.includes('/history?')) return json({ historyId: 'timeout', history: [{ messagesAdded: [{ message: { threadId: 'timed-out' } }] }] })
      if (url.includes('/threads/timed-out?')) return never
      return json({ threads: [] })
    })
    const timeoutService = new GmailCheckService(new GmailMetadataClient(async () => 'fake-access', timeoutFetcher as unknown as typeof fetch), repository, () => new Date(NOW), 30, 20, 2, 10)
    const timed = timeoutService.start()
    await vi.waitFor(() => expect(timeoutService.get(timed.id)?.state).toBe('partial'))
    expect(timeoutService.get(timed.id)?.failedThreadIds).toEqual(['timed-out'])
    expect(timeoutFetcher.mock.calls.filter(([url]) => String(url).includes('/threads/timed-out?'))).toHaveLength(3)
  })
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
