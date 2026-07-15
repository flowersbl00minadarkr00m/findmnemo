import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemorySecretStore } from '../auth/secret-store.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { SafeLogger } from '../observability/logger.js'
import { ProjectFolderRepository } from '../onboarding/project-folder-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { ActivityIngress } from './activity-ingress.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityService } from './agent-activity-service.js'
import { ActivityCapabilityRegistry } from './capability-manifests.js'
import { IntegrationAuthService } from './integration-auth-service.js'
import { ProjectAssociationService } from './project-association-service.js'

const cleanup: string[] = []
const running: Server[] = []
const loggers: SafeLogger[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(loggers.splice(0).map((logger) => logger.drain()))
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-activity-ingress-')); cleanup.push(root); await mkdir(join(root, 'outside'))
  const database = await openFindMnemoDatabase({ path: join(root, 'test.db'), backupBeforeMigration: false })
  const operational = new OperationalRepository(database.db)
  const capabilities = new ActivityCapabilityRegistry(database.db)
  const lifecycle = new TicketLifecycleService(operational, () => new Date('2026-07-14T20:00:01.000Z'))
  const repository = new AgentActivityRepository(database.db, operational, lifecycle, Buffer.alloc(32, 8), () => new Date('2026-07-14T20:00:01.000Z'))
  repository.registerIntegration(capabilities.registration('integration-codex-1', 'codex-cli', '0.144.3'))
  repository.registerIntegration(capabilities.registration('integration-codex-2', 'codex-cli', '0.144.3'))
  const auth = new IntegrationAuthService(database.db, new MemorySecretStore())
  const firstToken = await auth.issue('integration-codex-1'); const secondToken = await auth.issue('integration-codex-2')
  const associations = new ProjectAssociationService(database.db, new ProjectFolderRepository(database.db), operational, () => new Date('2026-07-14T20:00:01.000Z'))
  const logger = new SafeLogger(join(root, 'companion.log'))
  loggers.push(logger)
  const ingress = new ActivityIngress({ auth, capabilities, activities: new AgentActivityService(repository, () => new Date('2026-07-14T20:00:01.000Z'), associations), associations, repository, logger, clock: () => new Date('2026-07-14T20:00:01.000Z') })
  const server = createServer((request, response) => { void ingress.handle(request, response, new URL(request.url ?? '/', 'http://127.0.0.1')).then((handled) => { if (!handled) { response.writeHead(404); response.end() } }) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); running.push(server)
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server unavailable')
  return { root, database, repository, auth, firstToken, secondToken, logger, base: `http://127.0.0.1:${address.port}/api/v1/integration/agent-activity` }
}

describe('ActivityIngress', () => {
  it('accepts originless authenticated V1 events without browser CORS and exposes recovery immediately', async () => {
    const { database, repository, firstToken, base } = await fixture()
    const startedAt = Date.now()
    const response = await postEvent(base, firstToken, event('integration-codex-1', '000000000001'))
    const receipt = await response.json() as Record<string, unknown>
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(receipt).toMatchObject({ outcome: 'applied', assignmentKey: expect.stringMatching(/^[a-f0-9]{64}$/), ticketId: expect.stringContaining('agent-activity:') })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(repository.getAssignment(String(receipt.assignmentKey))).toMatchObject({ reportedState: 'active', integrationId: 'integration-codex-1' })

    const recovery = await fetch(`${base}/recovery?integrationId=integration-codex-1`, { headers: { 'x-findmnemo-activity-token': firstToken } })
    expect(await recovery.json()).toEqual({ assignments: [{ assignmentKey: receipt.assignmentKey, expectedSequence: 2 }], snapshots: [] })
    database.close()
  })

  it('rejects hosted/cross-site requests before auth even when the token and browser session headers are present', async () => {
    const { database, firstToken, base } = await fixture()
    const response = await postEvent(base, firstToken, event('integration-codex-1', '000000000001'), {
      origin: 'https://findmnemo.vercel.app', 'sec-fetch-site': 'cross-site', authorization: 'Bearer valid-browser-session',
    })
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.json()).toEqual({ requestId: expect.any(String), outcome: 'rejected', reasonCode: 'ORIGIN_NOT_ALLOWED' })
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual({ count: 0 })
    database.close()
  })

  it('fails revoked/wrong tokens, private fields, adapter/version mismatch, and oversize bodies without sensitive echoes or mutation', async () => {
    const { database, auth, firstToken, secondToken, logger, base } = await fixture()
    const privateEvent = { ...event('integration-codex-1', '000000000001'), prompt: 'private-prompt-canary' }
    const wrongAdapter = { ...event('integration-codex-1', '000000000002'), adapterVersion: '99.0.0' }
    const wrongVersion = { ...event('integration-codex-1', '000000000003'), agentVersion: '0.1.0' }
    const responses = [
      await postEvent(base, secondToken, event('integration-codex-1', '000000000004')),
      await postEvent(base, firstToken, privateEvent),
      await postEvent(base, firstToken, wrongAdapter),
      await postEvent(base, firstToken, wrongVersion),
      await fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-findmnemo-activity-token': firstToken }, body: JSON.stringify({ integrationId: 'integration-codex-1', padding: 'x'.repeat(17 * 1024) }) }),
    ]
    await auth.revoke('integration-codex-1')
    responses.push(await postEvent(base, firstToken, event('integration-codex-1', '000000000005')))
    const bodies = await Promise.all(responses.map((response) => response.text()))
    expect(responses.map((response) => response.status)).toEqual([401, 400, 409, 409, 413, 401])
    expect(bodies.join(' ')).not.toMatch(/private-prompt-canary|99\.0\.0|0\.1\.0|integration-codex-1/)
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual({ count: 0 })
    expect(JSON.stringify(await logger.preview())).not.toContain('private-prompt-canary')
    database.close()
  })

  it('rate-limits one integration without affecting another and resolves cwd only to a safe project reference', async () => {
    const { root, database, firstToken, secondToken, base } = await fixture()
    const contextBody = JSON.stringify({ integrationId: 'integration-codex-1', cwd: join(root, 'outside') })
    const contextHeaders = { 'content-type': 'application/json', 'x-findmnemo-activity-token': firstToken }
    const statuses: number[] = []
    for (let index = 0; index < 31; index += 1) statuses.push((await fetch(`${base}/context/resolve`, { method: 'POST', headers: contextHeaders, body: contextBody })).status)
    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(200))
    expect(statuses[30]).toBe(429)
    const healthy = await postEvent(base, secondToken, event('integration-codex-2', '000000000010'))
    expect(healthy.status).toBe(200)
    expect(await healthy.json()).toMatchObject({ outcome: 'applied' })
    const contextResponse = await (await fetch(`${base}/context/resolve`, { method: 'POST', headers: { ...contextHeaders, 'x-findmnemo-activity-token': secondToken }, body: JSON.stringify({ integrationId: 'integration-codex-2', cwd: join(root, 'outside') }) })).json()
    expect(contextResponse).toEqual({ kind: 'unassigned' })
    expect(JSON.stringify(database.db.prepare('SELECT * FROM agent_project_reviews').all())).not.toContain(root)
    database.close()
  })
})

function postEvent(base: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-findmnemo-activity-token': token, ...headers }, body: JSON.stringify(body) })
}

function event(integrationId: string, suffix: string) {
  return {
    schema: 'findmnemo.assignment-event.v1', eventId: `018f6f7e-6f52-7e54-8aa5-${suffix}`, integrationId, agent: 'codex-cli', adapterVersion: '1.0.0', agentVersion: '0.144.3',
    assignment: { originAssignmentId: `assignment-${suffix}`, generation: 1, summary: { text: 'Safe ingress work', source: 'explicit-user' }, projectRef: { kind: 'unassigned' } },
    observation: { sequence: 1, kind: 'started', reportedState: 'active', observedAt: '2026-07-14T20:00:00.000Z', evidenceKind: 'codex-hook' },
    modelLabel: 'gpt-5-codex',
  }
}
