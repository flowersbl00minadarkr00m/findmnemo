import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPANION_HOST, CompanionStartError, installCompanionSignalHandlers, startCompanion, type RunningCompanion } from './companion.js'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { COMPANION_PROTOCOL_VERSION } from '../shared/companion-contract.js'
import { OperationalRepository } from './db/operational-repository.js'

describe('loopback companion shell', () => {
  let distPath: string
  const running: RunningCompanion[] = []

  beforeEach(async () => {
    distPath = await mkdtemp(join(tmpdir(), 'findmnemo-companion-'))
    await mkdir(join(distPath, 'assets'))
    await writeFile(join(distPath, 'index.html'), '<!doctype html><title>FindMnemo local fallback</title><main>Operational fallback</main>')
    await writeFile(join(distPath, 'assets', 'app.js'), 'globalThis.findMnemoAsset = true')
  })

  afterEach(async () => {
    await Promise.all(running.splice(0).map((companion) => companion.stop()))
    await rm(distPath, { recursive: true, force: true })
  })

  async function start(port = 0): Promise<RunningCompanion> {
    const companion = await startCompanion({ port, distPath, databasePath: join(distPath, 'findmnemo.db'), instanceId: 'test-instance', clock: () => new Date('2026-07-10T00:00:00.000Z') })
    running.push(companion)
    return companion
  }

  function apiHeaders(companion: RunningCompanion, extra: Record<string, string> = {}): Record<string, string> {
    return {
      origin: `http://${COMPANION_HOST}:${companion.port}`,
      'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION,
      ...extra,
    }
  }

  it('binds only to literal IPv4 loopback and exposes minimal identity', async () => {
    const companion = await start()
    const address = companion.server.address()
    expect(address).toMatchObject({ address: COMPANION_HOST, family: 'IPv4', port: companion.port })

    const response = await fetch(`http://${COMPANION_HOST}:${companion.port}/api/v1/identity`, { headers: apiHeaders(companion) })
    const body = await response.json() as { data: Record<string, unknown> }
    expect(response.status).toBe(200)
    expect(body.data).toEqual({
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      companionVersion: '0.1.0',
      instanceId: 'test-instance',
      pairingRequired: true,
    })
    expect(Object.keys(body.data)).toEqual(['protocolVersion', 'companionVersion', 'instanceId', 'pairingRequired'])
  })

  it('serves the operational SPA rewrite and never rewrites API misses', async () => {
    const companion = await start()
    const base = `http://${COMPANION_HOST}:${companion.port}`
    const app = await fetch(`${base}/app/tickets`)
    const apiMiss = await fetch(`${base}/api/v1/missing`, { headers: apiHeaders(companion) })

    expect(app.status).toBe(200)
    const appHtml = await app.text()
    expect(appHtml).toContain('Operational fallback')
    expect(appHtml).toMatch(/name="findmnemo-local-bootstrap" content="[A-Za-z0-9_-]{16,128}"/)
    expect(app.headers.get('content-security-policy')).toContain("connect-src 'self' http://127.0.0.1:3210")
    expect(apiMiss.status).toBe(404)
    expect(apiMiss.headers.get('content-type')).toContain('application/json')
  })

  it('exchanges the local bootstrap once and still requires the authenticated session', async () => {
    const companion = await start()
    const base = `http://${COMPANION_HOST}:${companion.port}/api/v1`
    const browserNonce = 'local_browser_nonce_123456'
    const bootstrap = () => fetch(`${base}/local-session`, {
      method: 'POST',
      headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ bootstrapNonce: companion.localBootstrapNonce, browserNonce }),
    })
    const first = await bootstrap()
    const firstBody = await first.json() as { data: { token: string } }
    expect(first.status).toBe(200)
    expect((await bootstrap()).status).toBe(401)
    expect((await fetch(`${base}/status`, { headers: apiHeaders(companion) })).status).toBe(401)
    expect((await fetch(`${base}/status`, { headers: apiHeaders(companion, {
      authorization: `Bearer ${firstBody.data.token}`,
      'x-findmnemo-browser-nonce': browserNonce,
    }) })).status).toBe(200)
  })

  it('issues a fresh single-use local bootstrap for every fallback HTML load', async () => {
    const companion = await start()
    const base = `http://${COMPANION_HOST}:${companion.port}`
    const html = async () => await (await fetch(`${base}/app`)).text()
    const nonceFrom = (value: string) => value.match(/name="findmnemo-local-bootstrap" content="([A-Za-z0-9_-]+)"/)?.[1]
    const first = nonceFrom(await html())
    const second = nonceFrom(await html())
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)
    const exchange = await fetch(`${base}/api/v1/local-session`, {
      method: 'POST', headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ bootstrapNonce: second, browserNonce: 'fresh_local_nonce_123456' }),
    })
    expect(exchange.status).toBe(200)
    expect(nonceFrom(await html())).not.toBe(second)
  })

  it('fails closed on protocol mismatch with a stable code', async () => {
    const companion = await start()
    const response = await fetch(`http://${COMPANION_HOST}:${companion.port}/api/v1/identity`, {
      headers: apiHeaders(companion, { 'x-findmnemo-protocol-version': '2.0.0' }),
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(426)
    expect(body.error.code).toBe('UNSUPPORTED_PROTOCOL_VERSION')
  })

  it('rejects unapproved origins before pairing and echoes an approved exact origin', async () => {
    const companion = await start()
    const endpoint = `http://${COMPANION_HOST}:${companion.port}/api/v1/identity`
    const rejected = await fetch(endpoint, { headers: { origin: 'https://attacker.example' } })
    const accepted = await fetch(endpoint, { headers: apiHeaders(companion) })

    expect(rejected.status).toBe(403)
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('access-control-allow-origin')).toBe(`http://${COMPANION_HOST}:${companion.port}`)
    expect(accepted.headers.get('vary')).toContain('Origin')
  })

  it('allows browser-realistic PATCH and idempotent mutation preflights', async () => {
    const companion = await start()
    const endpoint = `http://${COMPANION_HOST}:${companion.port}/api/v1/tickets/ticket-1`
    const response = await fetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://mnemosync.vercel.app',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type,idempotency-key,x-findmnemo-protocol-version,x-findmnemo-browser-nonce',
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('PATCH')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('idempotency-key')
  })

  it('accepts an originless local GET only with same-origin fetch metadata', async () => {
    const companion = await start()
    const endpoint = `http://${COMPANION_HOST}:${companion.port}/api/v1/identity`
    const accepted = await fetch(endpoint, { headers: {
      'sec-fetch-site': 'same-origin',
      'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION,
    } })
    const rejected = await fetch(endpoint, { headers: { 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION } })
    expect(accepted.status).toBe(200)
    expect(rejected.status).toBe(403)
  })

  it('allows the exact production origin to pair but rejects a near-match origin', async () => {
    const companion = await start()
    const endpoint = `http://${COMPANION_HOST}:${companion.port}/api/v1/pairing/session`
    const browserNonce = 'hosted_browser_nonce_123456'
    const request = (origin: string) => fetch(endpoint, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ code: companion.pairingCode, browserNonce }),
    })
    expect((await request('https://mnemosync.vercel.app.attacker.example')).status).toBe(403)
    const accepted = await request('https://mnemosync.vercel.app')
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('access-control-allow-origin')).toBe('https://mnemosync.vercel.app')
  })

  it('exchanges a single-use code for a nonce-bound session, rotates it, and revokes it', async () => {
    const companion = await start()
    const base = `http://${COMPANION_HOST}:${companion.port}/api/v1`
    const browserNonce = 'browser_nonce_1234567890'
    const pair = await fetch(`${base}/pairing/session`, {
      method: 'POST',
      headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ code: companion.pairingCode, browserNonce }),
    })
    const pairBody = await pair.json() as { data: { token: string } }
    expect(pair.status).toBe(200)

    const replay = await fetch(`${base}/pairing/session`, {
      method: 'POST',
      headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ code: companion.pairingCode, browserNonce }),
    })
    expect(replay.status).toBe(401)

    const authenticatedHeaders = apiHeaders(companion, {
      authorization: `Bearer ${pairBody.data.token}`,
      'x-findmnemo-browser-nonce': browserNonce,
    })
    const status = await fetch(`${base}/status`, { headers: authenticatedHeaders })
    const statusBody = await status.json() as { data: { capabilities: Record<string, unknown> } }
    expect(status.status).toBe(200)
    expect(statusBody.data.capabilities).toMatchObject({ schemaVersion: 1, platform: process.platform, architecture: process.arch, node: { requiredMajor: 24 }, gmail: { credentialStore: { backend: process.platform === 'win32' ? 'windows-dpapi' : process.platform === 'darwin' ? 'macos-keychain' : 'linux-secret-service' } } })
    expect(JSON.stringify(statusBody.data.capabilities)).not.toMatch(/"(?:hostname|username|homeDir|account|token|secret|environment)"\s*:/i)
    const diagnostics = await fetch(`${base}/diagnostics`, { headers: authenticatedHeaders })
    const diagnosticsBody = await diagnostics.json() as { data: Record<string, unknown> }
    expect(diagnostics.status).toBe(200)
    expect(JSON.stringify(diagnosticsBody)).not.toMatch(/token|email|path/i)
    expect((await fetch(`${base}/status`, { headers: { ...authenticatedHeaders, 'x-findmnemo-browser-nonce': 'different_nonce_1234' } })).status).toBe(401)

    const rotate = await fetch(`${base}/pairing/rotate`, { method: 'POST', headers: authenticatedHeaders })
    const rotateBody = await rotate.json() as { data: { token: string } }
    expect(rotate.status).toBe(200)
    expect((await fetch(`${base}/status`, { headers: authenticatedHeaders })).status).toBe(401)

    const rotatedHeaders = apiHeaders(companion, {
      authorization: `Bearer ${rotateBody.data.token}`,
      'x-findmnemo-browser-nonce': browserNonce,
    })
    expect((await fetch(`${base}/pairing/session`, { method: 'DELETE', headers: rotatedHeaders })).status).toBe(200)
    expect((await fetch(`${base}/status`, { headers: rotatedHeaders })).status).toBe(401)
  })

  it('audits pairing outcomes and explicit Gmail triage without message content', async () => {
    const companion = await start()
    const database = new DatabaseSync(companion.databasePath)
    const repository = new OperationalRepository(database)
    const timestamp = '2026-07-10T00:00:00.000Z'
    repository.saveEmailThread({
      accountId: 'gmail-account-hash', threadId: 'thread-audit', latestMessageId: 'message-1',
      sender: 'person@example.com', subject: 'Private subject', receivedAt: timestamp, snippet: 'Private snippet',
      reasonCodes: ['LATEST_FROM_OTHER'], triageState: 'candidate', createdAt: timestamp, updatedAt: timestamp,
    })
    const base = `http://${COMPANION_HOST}:${companion.port}/api/v1`
    const browserNonce = 'audit_browser_nonce_123456789'
    const pair = await fetch(`${base}/pairing/session`, {
      method: 'POST', headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ code: companion.pairingCode, browserNonce }),
    })
    const pairBody = await pair.json() as { data: { token: string } }
    const decision = await fetch(`${base}/email/candidates/thread-audit/decision`, {
      method: 'POST',
      headers: apiHeaders(companion, { authorization: `Bearer ${pairBody.data.token}`, 'x-findmnemo-browser-nonce': browserNonce, 'content-type': 'application/json' }),
      body: JSON.stringify({ accountId: 'gmail-account-hash', expectedVersion: 1, action: 'dismiss' }),
    })

    expect(decision.status).toBe(200)
    const events = database.prepare("SELECT action,reason_code,object_refs_json,result FROM audit_events WHERE action IN ('pairing-session','gmail-triage') ORDER BY rowid").all()
    expect(events).toEqual([
      { action: 'pairing-session', reason_code: null, object_refs_json: '[]', result: 'accepted' },
      { action: 'gmail-triage', reason_code: 'dismiss', object_refs_json: '["email-thread:thread-audit"]', result: 'dismissed' },
    ])
    expect(JSON.stringify(events)).not.toMatch(/Private subject|Private snippet|person@example.com/)
    database.close()
  })

  it('exposes authenticated reconciliation source, start, status, history, and retry APIs', async () => {
    const companion = await start()
    const base = `http://${COMPANION_HOST}:${companion.port}/api/v1`
    const browserNonce = 'reconciliation_browser_nonce_1234'
    const pair = await fetch(`${base}/pairing/session`, {
      method: 'POST', headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ code: companion.pairingCode, browserNonce }),
    })
    const pairBody = await pair.json() as { data: { token: string } }
    const headers = apiHeaders(companion, { authorization: `Bearer ${pairBody.data.token}`, 'x-findmnemo-browser-nonce': browserNonce })

    const sources = await fetch(`${base}/sources`, { headers })
    expect((await sources.json() as { data: Array<{ id: string }> }).data.map((source) => source.id)).toEqual(['findmnemo-tickets', 'gmail-followups', 'project-sdd', 'agent-ledger'])
    const ledgerPath = join(distPath, 'registered-ledger.jsonl')
    await writeFile(ledgerPath, JSON.stringify({ eventId: 'fixture-event' }) + '\n')
    const configure = (body: Record<string, unknown>) => fetch(`${base}/sources/agent-ledger`, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    expect((await configure({ enabled: true, config: { path: ledgerPath, registrationId: 'fixture' } })).status).toBe(400)
    expect((await configure({ enabled: true, confirmed: true, policy: 'review', locationLabel: 'Fixture ledger', config: { path: ledgerPath, registrationId: 'fixture' } })).status).toBe(200)
    expect((await configure({ enabled: false, config: {} })).status).toBe(200)
    expect((await fetch(`${base}/sources/agent-ledger`, { method: 'DELETE', headers })).status).toBe(200)
    const migrationRecords = [{ legacyId: 'legacy-api-ticket', excluded: false, ticket: { id: 'legacy-api-ticket', title: 'Migrated through API', description: '', source: 'Codex', status: 'todo', origin: 'imported', workNotes: [], decisionLog: [], artifacts: [], createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' } }]
    const migrationRequest = (path: 'preview' | 'commit') => fetch(`${base}/migration/legacy-tickets/${path}`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...(path === 'commit' ? { 'idempotency-key': 'api-migration-fixture' } : {}) },
      body: JSON.stringify({ records: migrationRecords }),
    })
    expect((await (await migrationRequest('preview')).json() as { data: { eligible: number } }).data.eligible).toBe(1)
    expect((await (await migrationRequest('commit')).json() as { data: { imported: number } }).data.imported).toBe(1)
    expect((await (await migrationRequest('commit')).json() as { data: { imported: number } }).data.imported).toBe(1)
    expect((await (await fetch(`${base}/tickets`, { headers })).json() as { data: Array<{ id: string }> }).data.filter((ticket) => ticket.id === 'legacy-api-ticket')).toHaveLength(1)
    const started = await fetch(`${base}/reconciliation-runs`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })
    const startedBody = await started.json() as { data: { id: string } }
    expect(started.status).toBe(202)

    let final: { state: string } = { state: 'running' }
    for (let attempt = 0; attempt < 20 && final.state === 'running'; attempt += 1) {
      const status = await fetch(`${base}/reconciliation-runs/${startedBody.data.id}`, { headers })
      final = (await status.json() as { data: { state: string } }).data
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(final.state).toBe('complete')
    const history = await fetch(`${base}/reconciliation-runs`, { headers })
    expect((await history.json() as { data: Array<{ id: string }> }).data[0].id).toBe(startedBody.data.id)
    const retry = await fetch(`${base}/reconciliation-runs/${startedBody.data.id}/retry`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })
    expect(retry.status).toBe(202)
    expect((await retry.json() as { data: { id: string } }).data.id).not.toBe(startedBody.data.id)
  })

  it('previews and commits only safe non-demo legacy tickets through the authenticated API', async () => {
    const companion = await start()
    const base = `http://${COMPANION_HOST}:${companion.port}/api/v1`
    const browserNonce = 'migration_browser_nonce_123456'
    const pair = await fetch(`${base}/pairing/session`, {
      method: 'POST',
      headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ code: companion.pairingCode, browserNonce }),
    })
    const pairBody = await pair.json() as { data: { token: string } }
    const headers = apiHeaders(companion, {
      authorization: `Bearer ${pairBody.data.token}`,
      'x-findmnemo-browser-nonce': browserNonce,
      'content-type': 'application/json',
    })
    const ticket = {
      id: 'legacy-safe', title: 'Preserved ticket', description: 'Approved metadata', source: 'Codex', status: 'todo',
      origin: 'browser-ui', workNotes: [], decisionLog: [], artifacts: [],
      createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    }
    const body = JSON.stringify({ records: [
      { legacyId: 'legacy-safe', excluded: false, ticket },
      { legacyId: 'legacy-demo', excluded: false, ticket: { ...ticket, id: 'legacy-demo', origin: 'demo' } },
      { legacyId: 'legacy-private', excluded: false, ticket: { ...ticket, id: 'legacy-private', nested: { refreshToken: 'must-not-persist' } } },
    ] })

    const preview = await fetch(`${base}/migration/legacy-tickets/preview`, { method: 'POST', headers, body })
    const previewBody = await preview.json() as { data: Record<string, number> }
    const commit = await fetch(`${base}/migration/legacy-tickets/commit`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'migration-api-1' }, body })
    const commitBody = await commit.json() as { data: Record<string, number> }
    const repeat = await fetch(`${base}/migration/legacy-tickets/commit`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'migration-api-1' }, body })
    const repeatBody = await repeat.json() as { data: Record<string, number> }
    const tickets = await fetch(`${base}/tickets`, { headers })
    const ticketsBody = await tickets.json() as { data: Array<Record<string, unknown>> }

    expect(preview.status).toBe(200)
    expect(previewBody.data).toMatchObject({ eligible: 1, conflicts: 0, excluded: 2 })
    expect(commitBody.data).toMatchObject({ eligible: 1, conflicts: 0, excluded: 2, imported: 1 })
    expect(repeatBody.data).toEqual(commitBody.data)
    expect(ticketsBody.data).toHaveLength(1)
    expect(ticketsBody.data[0]).toMatchObject({ id: 'legacy-safe', title: 'Preserved ticket', origin: 'imported' })
    expect(JSON.stringify(ticketsBody)).not.toMatch(/refreshToken|must-not-persist|legacy-demo/)
  })

  it('persists authenticated ticket CRUD across companion restarts', async () => {
    const databasePath = join(distPath, 'durable-tickets.db')
    const first = await startCompanion({ port: 0, distPath, databasePath, instanceId: 'first-instance', clock: () => new Date('2026-07-10T00:00:00.000Z') })
    running.push(first)
    const browserNonce = 'crud_browser_nonce_12345678'
    const pair = await fetch(`http://${COMPANION_HOST}:${first.port}/api/v1/pairing/session`, {
      method: 'POST',
      headers: apiHeaders(first, { 'content-type': 'application/json' }),
      body: JSON.stringify({ code: first.pairingCode, browserNonce }),
    })
    const pairBody = await pair.json() as { data: { token: string } }
    const headers = apiHeaders(first, { authorization: `Bearer ${pairBody.data.token}`, 'x-findmnemo-browser-nonce': browserNonce })
    const ticket = {
      id: 'ticket-durable', title: 'Durable ticket', description: 'Companion-owned', source: 'Codex', status: 'todo',
      workNotes: [], artifacts: [], decisionLog: [], origin: 'manual', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    }
    const created = await fetch(`http://${COMPANION_HOST}:${first.port}/api/v1/tickets`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(ticket),
    })
    expect(created.status).toBe(201)
    await first.stop()
    running.splice(running.indexOf(first), 1)

    const second = await startCompanion({ port: 0, distPath, databasePath, instanceId: 'second-instance', clock: () => new Date('2026-07-10T00:01:00.000Z') })
    running.push(second)
    const secondNonce = 'second_browser_nonce_123456'
    const secondPair = await fetch(`http://${COMPANION_HOST}:${second.port}/api/v1/pairing/session`, {
      method: 'POST', headers: apiHeaders(second, { 'content-type': 'application/json' }),
      body: JSON.stringify({ code: second.pairingCode, browserNonce: secondNonce }),
    })
    const secondPairBody = await secondPair.json() as { data: { token: string } }
    const secondHeaders = apiHeaders(second, { authorization: `Bearer ${secondPairBody.data.token}`, 'x-findmnemo-browser-nonce': secondNonce })
    const listed = await fetch(`http://${COMPANION_HOST}:${second.port}/api/v1/tickets`, { headers: secondHeaders })
    const listedBody = await listed.json() as { data: Array<{ id: string }> }
    expect(listedBody.data).toEqual([expect.objectContaining({ id: 'ticket-durable' })])

    const updated = await fetch(`http://${COMPANION_HOST}:${second.port}/api/v1/tickets/ticket-durable`, {
      method: 'PATCH', headers: { ...secondHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ ...ticket, status: 'in-progress' }),
    })
    expect(updated.status).toBe(200)
    expect((await updated.json() as { data: { status: string } }).data.status).toBe('in-progress')
    expect((await fetch(`http://${COMPANION_HOST}:${second.port}/api/v1/tickets/ticket-durable`, { method: 'DELETE', headers: secondHeaders })).status).toBe(200)
  })

  it('shares one companion-owned ticket state between hosted and local sessions', async () => {
    const companion = await start()
    const base = `http://${COMPANION_HOST}:${companion.port}/api/v1`
    const hostedNonce = 'hosted_shared_nonce_1234567'
    const hostedPair = await fetch(`${base}/pairing/session`, {
      method: 'POST',
      headers: { origin: 'https://mnemosync.vercel.app', 'content-type': 'application/json', 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION },
      body: JSON.stringify({ code: companion.pairingCode, browserNonce: hostedNonce }),
    })
    const hostedBody = await hostedPair.json() as { data: { token: string } }
    const hostedHeaders = {
      origin: 'https://mnemosync.vercel.app', authorization: `Bearer ${hostedBody.data.token}`,
      'x-findmnemo-browser-nonce': hostedNonce, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION,
    }
    const ticket = {
      id: 'ticket-shared', title: 'Shared ticket', description: 'One database', source: 'Codex', status: 'todo',
      workNotes: [], artifacts: [], decisionLog: [], origin: 'browser-ui', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    }
    expect((await fetch(`${base}/tickets`, { method: 'POST', headers: { ...hostedHeaders, 'content-type': 'application/json' }, body: JSON.stringify(ticket) })).status).toBe(201)

    const localNonce = 'local_shared_nonce_12345678'
    const localPair = await fetch(`${base}/local-session`, {
      method: 'POST', headers: apiHeaders(companion, { 'content-type': 'application/json' }),
      body: JSON.stringify({ bootstrapNonce: companion.localBootstrapNonce, browserNonce: localNonce }),
    })
    const localBody = await localPair.json() as { data: { token: string } }
    const localList = await fetch(`${base}/tickets`, { headers: apiHeaders(companion, {
      authorization: `Bearer ${localBody.data.token}`, 'x-findmnemo-browser-nonce': localNonce,
    }) })
    expect((await localList.json() as { data: Array<{ id: string }> }).data).toEqual([expect.objectContaining({ id: 'ticket-shared' })])
  })

  it('rejects non-loopback hosts and detects a compatible owner before opening another database', async () => {
    await expect(startCompanion({ host: '0.0.0.0' as typeof COMPANION_HOST, port: 0, distPath, databasePath: join(distPath, 'rejected.db') })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
    const first = await start()

    const collisionPath = join(distPath, 'collision.db')
    await expect(startCompanion({ port: first.port, distPath, databasePath: collisionPath })).rejects.toEqual(
      expect.objectContaining<Partial<CompanionStartError>>({ code: 'COMPANION_ALREADY_RUNNING' }),
    )
    expect(existsSync(collisionPath)).toBe(false)
  })

  it('stops exactly once for repeated API calls and injected termination signals', async () => {
    const companion = await start()
    await Promise.all([companion.stop(), companion.stop()])
    running.splice(running.indexOf(companion), 1)

    const events = new EventEmitter() as EventEmitter & { exitCode?: number }
    const stop = vi.fn(async () => undefined)
    const handlers = installCompanionSignalHandlers({ stop }, events)
    events.emit('SIGTERM')
    events.emit('SIGINT')
    await handlers.shutdown()
    expect(stop).toHaveBeenCalledOnce()
    expect(events.exitCode).toBe(0)
    handlers.dispose()
  })

  it('reports an unknown listener without creating or opening its database', async () => {
    const unknown = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('not FindMnemo') })
    await new Promise<void>((resolve) => unknown.listen(0, COMPANION_HOST, resolve))
    const address = unknown.address()
    if (!address || typeof address === 'string') throw new Error('Unknown listener fixture did not bind.')
    const databasePath = join(distPath, 'unknown-owner.db')
    await expect(startCompanion({ port: address.port, distPath, databasePath })).rejects.toMatchObject({ code: 'PORT_IN_USE' })
    expect(existsSync(databasePath)).toBe(false)
    await new Promise<void>((resolve) => unknown.close(() => resolve()))
  })
})
