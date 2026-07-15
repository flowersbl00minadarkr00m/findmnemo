import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import type { SecretStore } from '../auth/secret-store.js'
import { AgentActivityManagementService } from './management-service.js'

describe('AgentActivityManagementService', () => {
  it('keeps capability dimensions independent and safe-tests without creating a ticket', async () => {
    const database = await openFindMnemoDatabase({ path: join(await mkdtemp(join(tmpdir(), 'findmnemo-management-')), 'findmnemo.db') }); const db = database.db
    const secrets = new Map<string, string>()
    const store: SecretStore = { get: async (key) => secrets.get(key), has: async (key) => secrets.has(key), set: async (key, value) => { secrets.set(key, value) }, delete: async (key) => { secrets.delete(key) } }
    const auth = { issue: vi.fn(async () => 'secret'), ensure: vi.fn(async () => 'secret'), verify: vi.fn(async () => true), revoke: vi.fn(async () => undefined) }
    const capabilities = { registration: vi.fn((id, agent, version) => ({ id, agent, adapterVersion: '1.0.0', installedVersion: version, enabled: false, configured: false, supportLevel: version === '0.80.7' ? 'unsupported' : 'automatic-partial', freshnessProfile: agent === 'pi' ? 'resident-extension' : 'hook-observed', heartbeatSeconds: agent === 'pi' ? 45 : null, freshnessWindowSeconds: agent === 'pi' ? 120 : 900 })), validate: vi.fn() }
    const snapshots = { request: vi.fn(() => ({ requestId: 'snap-1', integrationId: 'auto:codex-cli', mode: 'next-interaction', requestedAt: '2026-07-14T22:00:00.000Z', coverageStartedAt: null, coverageEndedAt: null, assignmentsObserved: 0, gapCount: 0, state: 'waiting', completedAt: null, failureCode: null, limitation: 'Limited snapshot.' })) }
    const setup = { enable: vi.fn(), verify: vi.fn(async () => true), remove: vi.fn() }
    const service = new AgentActivityManagementService({
      db, auth: auth as never, capabilities: capabilities as never, snapshots: snapshots as never, store, setup: setup as never,
      detectStatus: async () => ({
        'codex-cli': { installedVersion: '0.144.3', agentAuthState: 'signed-out', checkedAt: '2026-07-14T22:00:00.000Z' },
        'claude-code': { installedVersion: '2.1.207', agentAuthState: 'authenticated', checkedAt: '2026-07-14T22:00:00.000Z' },
        pi: { installedVersion: '0.80.7', agentAuthState: 'not-applicable', checkedAt: '2026-07-14T22:00:00.000Z' },
      }),
      clock: () => new Date('2026-07-14T22:00:00.000Z'),
    })
    service.initialize({ 'codex-cli': '0.144.3', 'claude-code': '2.1.207', pi: '0.80.7' })
    db.prepare("UPDATE agent_activity_integrations SET configured=1,enabled=1,secret_ref='ref' WHERE id='auto:codex-cli'").run()
    await store.set('ref', 'findmnemo-secret')
    const before = Number((db.prepare('SELECT COUNT(*) AS count FROM tickets').get() as { count: number }).count)
    const receipt = await service.test('auto:codex-cli')
    const after = Number((db.prepare('SELECT COUNT(*) AS count FROM tickets').get() as { count: number }).count)
    expect(receipt).toMatchObject({ operation: 'test', outcome: 'complete', changed: false })
    expect(after).toBe(before)
    const integrations = await service.listIntegrations()
    expect(integrations.find((item) => item.agent === 'codex-cli')).toMatchObject({
      supported: true, configured: true, enabled: true,
      agentAuthState: 'signed-out', integrationAuthState: 'ready', trustState: 'unknown',
      coverageState: 'unavailable', primaryAction: 'sign-in',
    })
    expect(integrations.find((item) => item.agent === 'pi')).toMatchObject({
      supported: false, coverageState: 'unsupported', primaryAction: 'manual-report',
      agentAuthState: 'not-applicable', integrationAuthState: 'not-configured', trustState: 'not-applicable',
      capabilities: { snapshot: 'none' },
    })
    await expect(service.snapshot('auto:codex-cli')).resolves.toMatchObject({ operation: 'snapshot', outcome: 'unavailable', changed: false })
    await expect(service.snapshot('auto:pi')).resolves.toMatchObject({ operation: 'snapshot', outcome: 'unsupported', changed: false })
    expect(snapshots.request).not.toHaveBeenCalled()
    expect(JSON.stringify(integrations)).not.toMatch(/secret|token|path/i)
  })

  it('requires local confirmation for setup mutation', async () => {
    const database = await openFindMnemoDatabase({ path: join(await mkdtemp(join(tmpdir(), 'findmnemo-management-')), 'findmnemo.db') }); const db = database.db
    const service = new AgentActivityManagementService({ db, auth: {} as never, capabilities: { registration: (_id: string, agent: string, version: string) => ({ id: `auto:${agent}`, agent, adapterVersion: '1.0.0', installedVersion: version, enabled: false, configured: false, supportLevel: 'automatic-partial', freshnessProfile: 'hook-observed', freshnessWindowSeconds: 900 }) } as never, snapshots: {} as never, store: {} as never })
    service.initialize({ 'codex-cli': '0.144.3', 'claude-code': null, pi: null })
    await expect(service.enable('auto:codex-cli', false)).rejects.toThrow('LOCAL_CONFIRMATION_REQUIRED')
  })
})
