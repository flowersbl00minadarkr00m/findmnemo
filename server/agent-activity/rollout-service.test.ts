import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import { MemorySecretStore } from '../auth/secret-store.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { IntegrationAuthService, activityTokenReference } from './integration-auth-service.js'
import { AgentActivityRolloutService } from './rollout-service.js'
import { retrySpoolSecretRef } from './reporter/retry-spool.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('AgentActivityRolloutService', () => {
  it('disables ingress and removes only owned setup, tokens, and retry data while preserving operational evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-activity-rollout-')); cleanup.push(root)
    const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
    const operational = new OperationalRepository(database.db); const store = new MemorySecretStore(); const auth = new IntegrationAuthService(database.db, store)
    const clock = () => new Date('2026-07-14T20:00:00.000Z')
    const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, clock), Buffer.alloc(32, 4), clock)
    repository.registerIntegration({ id: 'auto:codex-cli', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3', supportLevel: 'automatic-partial', freshnessProfile: 'hook-observed', freshnessWindowSeconds: 900 })
    const receipt = repository.ingest(assignmentEventFixture({ integrationId: 'auto:codex-cli' }))
    await auth.issue('auto:codex-cli'); await store.set(retrySpoolSecretRef('auto:codex-cli'), '{"version":1}')
    const setup = { remove: vi.fn(async () => true) }
    const service = new AgentActivityRolloutService({ database, auth, store, setup, clock })
    service.enable()
    const preserved = { tickets: database.db.prepare('SELECT count(*) AS count FROM tickets').get(), assignments: database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get() }

    await expect(service.rollback(true)).resolves.toMatchObject({ captureEnabled: false, integrationsDisabled: 1, setupFailures: 0 })
    expect(service.isEnabled()).toBe(false)
    expect(database.db.prepare("SELECT enabled,configured FROM agent_activity_integrations WHERE id='auto:codex-cli'").get()).toEqual({ enabled: 0, configured: 0 })
    expect(await store.has(activityTokenReference('auto:codex-cli'))).toBe(false)
    expect(await store.has(retrySpoolSecretRef('auto:codex-cli'))).toBe(false)
    expect(setup.remove).toHaveBeenCalledWith('codex-cli')
    expect(database.db.prepare('SELECT count(*) AS count FROM tickets').get()).toEqual(preserved.tickets)
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual(preserved.assignments)
    expect(operational.getTicket(receipt.ticketId)).toBeDefined()
    database.close()
  })

  it('requires confirmation and isolates one setup-removal failure from healthy integrations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-activity-rollout-')); cleanup.push(root)
    const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') }); const store = new MemorySecretStore(); const auth = new IntegrationAuthService(database.db, store)
    const operational = new OperationalRepository(database.db); const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational), Buffer.alloc(32, 3))
    repository.registerIntegration({ id: 'auto:codex-cli', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3' })
    repository.registerIntegration({ id: 'auto:claude-code', agent: 'claude-code', adapterVersion: '1.0.0', installedVersion: '2.1.207' })
    const setup = { remove: vi.fn(async (agent: string) => { if (agent === 'codex-cli') throw new Error('fixture'); return true }) }
    const service = new AgentActivityRolloutService({ database, auth, store, setup })
    await expect(service.rollback(false)).rejects.toThrow('LOCAL_CONFIRMATION_REQUIRED')
    await expect(service.rollback(true)).resolves.toMatchObject({ captureEnabled: false, integrationsDisabled: 2, setupFailures: 1 })
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_activity_integrations WHERE enabled=1').get()).toEqual({ count: 0 })
    database.close()
  })
})
