import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { MemorySecretStore } from '../auth/secret-store.js'
import { startCompanion } from '../companion.js'
import { HttpManualActivityTransport } from '../mcp/activity-transport.js'
import { retrySpoolSecretRef } from './reporter/retry-spool.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityService } from './agent-activity-service.js'
import { ActivityCapabilityRegistry, manualActivityRegistration } from './capability-manifests.js'
import { ManualReportingService, type ManualReportInput } from './manual-reporting-service.js'
import { activityTokenReference } from './integration-auth-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture(precise = false) {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-manual-activity-')); cleanup.push(root)
  const databasePath = join(root, 'test.db')
  const database = await openFindMnemoDatabase({ path: databasePath, backupBeforeMigration: false })
  const operational = new OperationalRepository(database.db)
  let now = new Date('2026-07-14T21:00:00.000Z'); let id = 0
  const clock = () => now
  const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, clock), Buffer.alloc(32, 5), clock)
  repository.registerIntegration({
    ...manualActivityRegistration(precise ? 'surface:codex-desktop' : 'manual:codex-cli', 'codex-cli'),
    ...(precise ? { agentFamily: 'codex' as const, executionSurface: 'codex-desktop' as const } : {}),
  })
  const capabilities = new ActivityCapabilityRegistry(database.db)
  const service = new ManualReportingService({ repository, activities: new AgentActivityService(repository, clock), capabilities, clock, eventId: () => `018f6f7e-6f52-7e54-8aa5-${String(++id).padStart(12, '0')}` })
  return { database, databasePath, operational, repository, service, advance: () => { now = new Date(now.getTime() + 1_000) } }
}

const base: Omit<ManualReportInput, 'action'> = { integrationId: 'manual:codex-cli', agent: 'codex-cli', assignmentId: 'manual-work-1', generation: 1, summary: 'Manually reported current work', projectRef: { kind: 'unassigned' }, evidenceKind: 'manual-command' }
const preciseBase: Omit<ManualReportInput, 'action'> = {
  ...base,
  integrationId: 'surface:codex-desktop',
  agentFamily: 'codex',
  executionSurface: 'codex-desktop',
  evidenceKind: 'mcp-tool',
}

describe('ManualReportingService', () => {
  it('creates and updates one visibly manual assignment through every explicit lifecycle action', async () => {
    const { database, operational, repository, service, advance } = await fixture()
    const first = service.report({ ...base, action: 'start' })
    for (const action of ['update', 'wait', 'block', 'needs-action'] as const) { advance(); expect(service.report({ ...base, action }).outcome).toBe('applied') }
    advance(); const completed = service.report({ ...base, action: 'complete' })

    expect(completed).toMatchObject({ outcome: 'applied', supportLevel: 'manual', evidenceKind: 'manual-command' })
    expect(repository.getAssignment(first.assignmentKey)).toMatchObject({ lastAppliedSequence: 6, reportedState: 'completed', evidenceKind: 'manual-command', terminalOutcome: 'completed' })
    expect(operational.getTicket(first.ticketId)).toMatchObject({ status: 'done', completedAt: '2026-07-14T21:00:05.000Z' })
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual({ count: 1 })
    database.close()
  })

  it('accepts approved or Unassigned project references and rejects unknown/private input without mutation', async () => {
    const { database, service } = await fixture()
    expect(() => service.report({ ...base, action: 'start', prompt: 'must not be accepted' })).toThrow('MANUAL_REPORT_INVALID')
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual({ count: 0 })
    const minimized = service.report({ ...base, action: 'start', summary: 'password=private-value', projectRef: { kind: 'approved-project', id: 'project-safe' } })
    expect(minimized).toMatchObject({ outcome: 'applied', receiptCodes: ['SUMMARY_MINIMIZED'] })
    expect(database.db.prepare('SELECT project_id FROM agent_assignments').get()).toEqual({ project_id: 'project-safe' })
    database.close()
  })

  it('queues while the companion is stopped, then replays idempotently after restart into one ticket', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-offline-manual-')); cleanup.push(root)
    const databasePath = join(root, 'offline.db'); const store = new MemorySecretStore()
    const first = await startCompanion({ port: 0, databasePath, routingSecretStore: store, activitySecretStore: store })
    const port = first.port; const integrationId = 'manual:codex-cli'
    const token = await store.get(activityTokenReference(integrationId)); if (!token) throw new Error('manual token missing')
    const transport = new HttpManualActivityTransport(token, { integrationId, agent: 'codex-cli', store, baseUrl: `http://127.0.0.1:${port}/api/v1/integration/agent-activity`, clock: () => new Date('2026-07-14T21:30:00.000Z') })
    await first.stop()
    expect(await transport.report({ ...base, integrationId, action: 'start', evidenceKind: 'manual-command' })).toMatchObject({ outcome: 'queued', queued: true })
    const restarted = await startCompanion({ port, databasePath, routingSecretStore: store, activitySecretStore: store })
    expect(await transport.replay()).toMatchObject({ removed: 1, remaining: 0, haltReason: null })
    const freshProcess = new HttpManualActivityTransport(token, { integrationId, agent: 'codex-cli', store, baseUrl: `http://127.0.0.1:${port}/api/v1/integration/agent-activity`, clock: () => new Date('2026-07-14T21:30:01.000Z') })
    expect(await freshProcess.report({ ...base, integrationId, action: 'update', evidenceKind: 'manual-command' })).toMatchObject({ outcome: 'applied' })
    await restarted.stop()
    const database = await openFindMnemoDatabase({ path: databasePath, backupBeforeMigration: false })
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual({ count: 1 })
    expect(database.db.prepare('SELECT count(*) AS count FROM tickets').get()).toEqual({ count: 1 })
    expect(database.db.prepare('SELECT last_applied_sequence FROM agent_assignments').get()).toEqual({ last_applied_sequence: 2 })
    database.close()
  })

  it('maps all nine precise-surface actions with stable identity, sequence, model fallback, and explicit terminal truth', async () => {
    const { database, repository, service, advance } = await fixture(true)
    const first = service.report({ ...preciseBase, action: 'start', modelLabel: 'openai/gpt-5.6' })
    expect(first).toMatchObject({
      outcome: 'applied',
      agentFamily: 'codex',
      executionSurface: 'codex-desktop',
      modelLabel: 'openai/gpt-5.6',
    })
    for (const action of ['update', 'wait', 'block', 'needs-action'] as const) {
      advance()
      expect(service.report({ ...preciseBase, action }).assignmentKey).toBe(first.assignmentKey)
    }
    advance()
    expect(service.report({
      ...preciseBase,
      action: 'snapshot',
      snapshot: { requestId: 'snapshot-request-1', mode: 'explicit-report', coverageStartedAt: '2026-07-14T21:00:05.000Z' },
    }).assignmentKey).toBe(first.assignmentKey)
    expect(repository.getAssignment(first.assignmentKey)).toMatchObject({
      lastAppliedSequence: 6,
      reportedState: 'active',
      agentFamily: 'codex',
      executionSurface: 'codex-desktop',
      modelLabel: 'openai/gpt-5.6',
      terminalOutcome: null,
    })

    advance()
    const ignored = service.report({ ...preciseBase, action: 'update', modelLabel: 'password=private-value' })
    expect(ignored).toMatchObject({ outcome: 'applied', receiptCodes: ['MODEL_LABEL_IGNORED'], modelLabel: null })
    expect(repository.getAssignment(first.assignmentKey)).toMatchObject({ lastAppliedSequence: 7, modelLabel: 'openai/gpt-5.6', terminalOutcome: null })

    const terminalActions = [
      ['complete', 'completed'],
      ['fail', 'failed'],
      ['cancel', 'cancelled'],
    ] as const
    for (const [action, outcome] of terminalActions) {
      const assignmentId = `terminal-${action}`
      advance()
      const started = service.report({ ...preciseBase, assignmentId, action: 'start' })
      advance()
      const terminal = service.report({ ...preciseBase, assignmentId, action })
      expect(terminal.assignmentKey).toBe(started.assignmentKey)
      expect(repository.getAssignment(started.assignmentKey)).toMatchObject({
        lastAppliedSequence: 2,
        terminalOutcome: outcome,
      })
      advance()
      expect(service.report({ ...preciseBase, assignmentId, action })).toMatchObject({
        outcome: 'duplicate',
        assignmentKey: started.assignmentKey,
      })
      advance()
      const mismatchedTerminal = action === 'complete' ? 'fail' : 'complete'
      expect(service.report({ ...preciseBase, assignmentId, action: mismatchedTerminal })).toMatchObject({
        outcome: 'conflict',
        reasonCode: 'TERMINAL_CONFLICT',
      })
      advance()
      expect(service.report({ ...preciseBase, assignmentId, action: 'update' })).toMatchObject({
        outcome: 'rejected',
        reasonCode: 'TERMINAL_ASSIGNMENT',
      })
    }

    const kinds = database.db.prepare('SELECT event_kind FROM agent_assignment_events WHERE assignment_key=? ORDER BY sequence').all(first.assignmentKey)
    expect(kinds).toEqual([
      { event_kind: 'started' },
      { event_kind: 'heartbeat' },
      { event_kind: 'waiting' },
      { event_kind: 'blocked' },
      { event_kind: 'needs-action' },
      { event_kind: 'snapshot' },
      { event_kind: 'heartbeat' },
    ])
    database.close()
  })

  it('does not synthesize terminal state from silence or session closure', async () => {
    const { database, databasePath, repository, service, advance } = await fixture(true)
    const first = service.report({ ...preciseBase, action: 'start', assignmentId: 'silent-work' })
    advance()
    expect(repository.getAssignment(first.assignmentKey)).toMatchObject({ reportedState: 'active', terminalOutcome: null, lastAppliedSequence: 1 })
    database.close()

    const reopened = await openFindMnemoDatabase({ path: databasePath, backupBeforeMigration: false })
    const operational = new OperationalRepository(reopened.db)
    const repositoryAfterClosure = new AgentActivityRepository(reopened.db, operational, new TicketLifecycleService(operational), Buffer.alloc(32, 5))
    expect(repositoryAfterClosure.getAssignment(first.assignmentKey)).toMatchObject({ reportedState: 'active', terminalOutcome: null, lastAppliedSequence: 1 })
    reopened.close()
  })

  it('waits long enough for an interactive MCP or manual receipt without weakening hook latency', async () => {
    const store = new MemorySecretStore()
    const server = createServer((request, response) => {
      request.resume()
      request.once('end', () => setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'applied', assignmentKey: 'a'.repeat(64), ticketId: 'agent-activity:test' }))
      }, 350))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('test listener missing')
      const transport = new HttpManualActivityTransport('test-token', {
        integrationId: 'manual:codex-cli', agent: 'codex-cli', store,
        baseUrl: `http://127.0.0.1:${address.port}/api/v1/integration/agent-activity`,
        clock: () => new Date('2026-07-14T21:45:00.000Z'),
      })
      await expect(transport.report({ ...base, action: 'start' })).resolves.toMatchObject({ outcome: 'applied' })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('emits strict v2 from a trusted transport binding and ignores an unsafe optional model label', async () => {
    const store = new MemorySecretStore()
    let received: Record<string, unknown> | undefined
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.once('end', () => {
        received = JSON.parse(body) as Record<string, unknown>
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ outcome: 'applied', assignmentKey: 'a'.repeat(64), ticketId: 'agent-activity:test' }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('test listener missing')
      const transport = new HttpManualActivityTransport('test-token', {
        integrationId: 'surface:codex-desktop',
        agent: 'codex-cli',
        agentFamily: 'codex',
        executionSurface: 'codex-desktop',
        store,
        baseUrl: `http://127.0.0.1:${address.port}/api/v1/integration/agent-activity`,
        clock: () => new Date('2026-07-14T21:47:00.000Z'),
      })
      await expect(transport.report({ ...preciseBase, action: 'start', modelLabel: 'password=private-value' })).resolves.toMatchObject({
        outcome: 'applied',
        agentFamily: 'codex',
        executionSurface: 'codex-desktop',
        modelLabel: null,
        receiptCodes: ['MODEL_LABEL_IGNORED'],
      })
      expect(received).toMatchObject({
        schema: 'findmnemo.assignment-event.v2',
        integrationId: 'surface:codex-desktop',
        agentFamily: 'codex',
        executionSurface: 'codex-desktop',
        model: null,
      })
      expect(received).not.toHaveProperty('agent')

      await expect(transport.report({ ...preciseBase, executionSurface: 'codex-cli', action: 'update' })).rejects.toThrow('ACTIVITY_INTEGRATION_MISMATCH')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('drains an already-applied timed-out event as a duplicate before delivering the next lifecycle event', async () => {
    const store = new MemorySecretStore()
    const applied = new Set<string>()
    let requestCount = 0
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { body += chunk })
      request.once('end', () => {
        const event = JSON.parse(body) as { eventId: string }
        const duplicate = applied.has(event.eventId)
        applied.add(event.eventId)
        requestCount += 1
        const delay = requestCount === 1 ? 2_100 : 0
        setTimeout(() => {
          if (response.destroyed) return
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ outcome: duplicate ? 'duplicate' : 'applied', assignmentKey: 'a'.repeat(64), ticketId: 'agent-activity:test' }))
        }, delay)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('test listener missing')
      const transport = new HttpManualActivityTransport('test-token', {
        integrationId: 'manual:codex-cli', agent: 'codex-cli', store,
        baseUrl: `http://127.0.0.1:${address.port}/api/v1/integration/agent-activity`,
        clock: () => new Date('2026-07-14T21:50:00.000Z'),
      })

      await expect(transport.report({ ...base, action: 'start' })).resolves.toMatchObject({ outcome: 'queued', queued: true })
      await expect(transport.report({ ...base, action: 'update' })).resolves.toMatchObject({ outcome: 'applied' })
      expect(await store.has(retrySpoolSecretRef('manual:codex-cli'))).toBe(false)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
