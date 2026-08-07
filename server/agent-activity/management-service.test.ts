import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import type { SecretStore } from '../auth/secret-store.js'
import { AgentActivityManagementService } from './management-service.js'
import {
  PRECISE_ACTIVITY_CELLS,
  SurfaceQualificationRegistry,
  unavailableQualification,
  type SurfaceQualificationModule,
} from './qualifications/index.js'

describe('AgentActivityManagementService', () => {
  it('returns six independent cells, preserves legacy rows, and safe-tests without changing production artifact counts', async () => {
    const database = await openFindMnemoDatabase({ path: join(await mkdtemp(join(tmpdir(), 'findmnemo-management-')), 'findmnemo.db') })
    const db = database.db
    const now = '2026-07-23T05:00:00.000Z'
    insertLegacyRow(db, 'auto:codex-cli', now)
    insertLegacyRow(db, 'manual:codex-cli', now)
    insertPrecisePlaceholderRow(db, now)
    const legacyBefore = db.prepare("SELECT * FROM agent_activity_integrations WHERE id IN ('auto:codex-cli','manual:codex-cli') ORDER BY id").all()

    const secrets = new Map<string, string>()
    const store: SecretStore = {
      get: async (key) => secrets.get(key),
      has: async (key) => secrets.has(key),
      set: async (key, value) => { secrets.set(key, value) },
      delete: async (key) => { secrets.delete(key) },
    }
    const validationIngress = { validateOnly: vi.fn() }
    const service = new AgentActivityManagementService({
      db,
      auth: {
        issue: vi.fn(async () => 'secret'),
        ensure: vi.fn(async () => 'secret'),
        verify: vi.fn(async () => true),
        revoke: vi.fn(async () => undefined),
      } as never,
      capabilities: { validate: vi.fn() } as never,
      snapshots: { request: vi.fn() } as never,
      store,
      qualifications: registryWith(
        healthyModule(PRECISE_ACTIVITY_CELLS[0], 'stale'),
        reachableButUnqualified(PRECISE_ACTIVITY_CELLS[1]),
      ),
      validationIngress,
      clock: () => new Date(now),
    })

    service.initialize({ 'codex-cli': 'legacy-ignored', 'claude-code': 'legacy-ignored', pi: 'legacy-ignored' })
    expect(db.prepare("SELECT * FROM agent_activity_integrations WHERE id IN ('auto:codex-cli','manual:codex-cli') ORDER BY id").all()).toEqual(legacyBefore)
    expect(db.prepare("SELECT adapter_version,support_level,installed_version FROM agent_activity_integrations WHERE id='surface:claude-desktop-code'").get()).toEqual({
      adapter_version: 'manual-1.0.0',
      support_level: 'manual',
      installed_version: '1.2.3',
    })

    db.prepare("UPDATE agent_activity_integrations SET configured=1,enabled=1,secret_ref='surface-secret' WHERE id='surface:claude-desktop-code'").run()
    await store.set('surface-secret', 'findmnemo-secret')
    const integrations = await service.listIntegrations()
    expect(integrations).toHaveLength(6)
    expect(integrations[0]).toMatchObject({
      id: 'surface:claude-desktop-code',
      agentFamily: 'claude',
      executionSurface: 'claude-desktop-code',
      qualifiedVersions: ['1.2.3'],
      reachability: 'reachable',
      healthState: 'stale',
      capabilities: { manual: true, snapshot: 'next-interaction', automaticEvents: 'none', explicitTerminal: 'explicit' },
    })
    expect(integrations[1]).toMatchObject({ reachability: 'reachable', supported: false, capabilities: { manual: false, automaticEvents: 'none' } })
    expect(integrations.slice(1).every((cell) => cell.supported === false && ['unavailable', 'unsupported'].includes(cell.coverageState))).toBe(true)

    const before = artifactCounts(db)
    await expect(service.test('surface:claude-desktop-code')).resolves.toMatchObject({
      operation: 'test',
      outcome: 'complete',
      changed: false,
    })
    expect(validationIngress.validateOnly).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: 'surface:claude-desktop-code',
      agentFamily: 'claude',
      executionSurface: 'claude-desktop-code',
    }))
    expect(artifactCounts(db)).toEqual(before)
    expect(JSON.stringify(integrations)).not.toMatch(/secret_ref|activityToken|canonicalPath|rawPath|commandLine|configValue|credentialValue/i)
    database.close()
  })

  it('never synthesizes safe-test success without a verified precise binding', async () => {
    const database = await openFindMnemoDatabase({ path: join(await mkdtemp(join(tmpdir(), 'findmnemo-management-')), 'findmnemo.db') })
    const validationIngress = { validateOnly: vi.fn() }
    const unbound = {
      ...healthyModule(PRECISE_ACTIVITY_CELLS[0]),
      setup: { state: 'configured', mechanism: 'owned-test-binding', credentialState: 'ready', bindingVerified: false },
    } as SurfaceQualificationModule
    const service = new AgentActivityManagementService({
      db: database.db,
      auth: { ensure: vi.fn(async () => 'secret'), verify: vi.fn(async () => true) } as never,
      capabilities: {} as never,
      snapshots: {} as never,
      store: { has: vi.fn(async () => true) } as never,
      qualifications: registryWith(unbound),
      validationIngress,
    })
    service.initialize({ 'codex-cli': null, 'claude-code': null, pi: null })
    database.db.prepare("UPDATE agent_activity_integrations SET configured=1,enabled=1,secret_ref='surface-secret' WHERE id='surface:claude-desktop-code'").run()
    await expect(service.test('surface:claude-desktop-code')).resolves.toMatchObject({ outcome: 'unavailable', changed: false })
    expect(validationIngress.validateOnly).not.toHaveBeenCalled()
    database.close()
  })

  it('requires local confirmation for setup mutation', async () => {
    const database = await openFindMnemoDatabase({ path: join(await mkdtemp(join(tmpdir(), 'findmnemo-management-')), 'findmnemo.db') })
    const service = new AgentActivityManagementService({
      db: database.db,
      auth: {} as never,
      capabilities: {} as never,
      snapshots: {} as never,
      store: {} as never,
      qualifications: new SurfaceQualificationRegistry(),
    })
    service.initialize({ 'codex-cli': null, 'claude-code': null, pi: null })
    await expect(service.enable('surface:codex-cli', false)).rejects.toThrow('LOCAL_CONFIRMATION_REQUIRED')
    database.close()
  })
})

function registryWith(...modules: SurfaceQualificationModule[]): SurfaceQualificationRegistry {
  return new SurfaceQualificationRegistry(PRECISE_ACTIVITY_CELLS.map((cell) => modules.find((module) => module.integrationId === cell.integrationId) ?? unavailableQualification(cell)))
}

function healthyModule(cell: (typeof PRECISE_ACTIVITY_CELLS)[number], health: 'healthy' | 'stale' = 'healthy'): SurfaceQualificationModule {
  return {
    ...unavailableQualification(cell),
    adapterVersion: 'manual-1.0.0',
    detection: { state: 'detected', detectedVersion: '1.2.3', checkedAt: '2026-07-23T05:00:00.000Z' },
    setup: { state: 'verified', mechanism: 'owned-test-binding', credentialState: 'ready', bindingVerified: true },
    reachability: { state: 'reachable', checkedAt: '2026-07-23T05:00:00.000Z' },
    qualification: { qualifiedVersions: ['1.2.3'], manual: true, snapshot: 'next-interaction', automaticEvents: 'none', explicitTerminal: 'explicit', lastQualifiedAt: '2026-07-23T05:00:00.000Z' },
    health: { state: health, checkedAt: '2026-07-23T05:00:00.000Z', lastSuccessAt: '2026-07-23T04:00:00.000Z', failureCode: health === 'stale' ? 'HEALTH_STALE' : null },
  }
}

function reachableButUnqualified(cell: (typeof PRECISE_ACTIVITY_CELLS)[number]): SurfaceQualificationModule {
  return {
    ...unavailableQualification(cell),
    adapterVersion: 'manual-1.0.0',
    detection: { state: 'detected', detectedVersion: '9.9.9', checkedAt: '2026-07-23T05:00:00.000Z' },
    setup: { state: 'configured', mechanism: 'owned-test-binding', credentialState: 'ready', bindingVerified: false },
    reachability: { state: 'reachable', checkedAt: '2026-07-23T05:00:00.000Z' },
    health: { state: 'healthy', checkedAt: '2026-07-23T05:00:00.000Z', lastSuccessAt: '2026-07-23T05:00:00.000Z', failureCode: null },
  }
}

function insertLegacyRow(db: import('node:sqlite').DatabaseSync, id: string, now: string): void {
  db.prepare(`INSERT INTO agent_activity_integrations(
    id,agent_kind,agent_family,execution_surface,adapter_version,installed_version,enabled,configured,support_level,
    freshness_profile,heartbeat_seconds,freshness_window_seconds,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, 'codex-cli', 'codex', 'legacy-ambiguous', 'legacy-1.0.0', '0.144.3', 1, 1, 'manual',
    'legacy', null, 1800, now, now,
  )
}

function insertPrecisePlaceholderRow(db: import('node:sqlite').DatabaseSync, now: string): void {
  db.prepare(`INSERT INTO agent_activity_integrations(
    id,agent_kind,agent_family,execution_surface,adapter_version,installed_version,enabled,configured,support_level,
    freshness_profile,heartbeat_seconds,freshness_window_seconds,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'surface:claude-desktop-code', 'claude-code', 'claude', 'claude-desktop-code', 'unavailable', null,
    0, 0, 'unsupported', 'surface-qualified', null, 900, now, now,
  )
}

function artifactCounts(db: import('node:sqlite').DatabaseSync): Record<string, number> {
  return Object.fromEntries(['tickets', 'agent_assignments', 'agent_assignment_events', 'agent_activity_snapshots', 'agent_project_reviews'].map((table) => {
    const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
    return [table, count]
  }))
}
