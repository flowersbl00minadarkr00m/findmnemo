import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { MemorySecretStore } from '../auth/secret-store.js'
import { startCompanion } from '../companion.js'
import { HttpManualActivityTransport } from '../mcp/activity-transport.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityService } from './agent-activity-service.js'
import { ActivityCapabilityRegistry, manualActivityRegistration } from './capability-manifests.js'
import { ManualReportingService, type ManualReportInput } from './manual-reporting-service.js'
import { activityTokenReference } from './integration-auth-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-manual-activity-')); cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'test.db'), backupBeforeMigration: false })
  const operational = new OperationalRepository(database.db)
  let now = new Date('2026-07-14T21:00:00.000Z'); let id = 0
  const clock = () => now
  const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, clock), Buffer.alloc(32, 5), clock)
  repository.registerIntegration(manualActivityRegistration('manual:codex-cli', 'codex-cli'))
  const capabilities = new ActivityCapabilityRegistry(database.db)
  const service = new ManualReportingService({ repository, activities: new AgentActivityService(repository, clock), capabilities, clock, eventId: () => `018f6f7e-6f52-7e54-8aa5-${String(++id).padStart(12, '0')}` })
  return { database, operational, repository, service, advance: () => { now = new Date(now.getTime() + 1_000) } }
}

const base: Omit<ManualReportInput, 'action'> = { integrationId: 'manual:codex-cli', agent: 'codex-cli', assignmentId: 'manual-work-1', generation: 1, summary: 'Manually reported current work', projectRef: { kind: 'unassigned' }, evidenceKind: 'manual-command' }

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
})
