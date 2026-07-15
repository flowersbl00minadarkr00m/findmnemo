import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RoutingConnectionDto } from '../../shared/companion-contract.js'
import { openFindMnemoDatabase } from '../db/database.js'
import type { DestinationAdapter } from './adapter-contract.js'
import { RoutingConnectionRepository } from './connection-repository.js'
import { RoutingConnectionService } from './connection-service.js'
import { RoutingRepository } from './routing-repository.js'
import { ROUTING_COMPATIBILITY_MANIFESTS } from './compatibility-manifests.js'
import { FakeDestinationAdapter } from './adapters/fake-adapter.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture(adapters: DestinationAdapter[]) {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-qualification-'))
  cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
  const repository = new RoutingConnectionRepository(database.db)
  const service = new RoutingConnectionService(adapters, repository, new RoutingRepository(database.db), () => new Date('2026-07-14T10:00:00.000Z'))
  return { database, repository, service }
}

function adapter(id: 'codex-cli' | 'ollama-local', behavior: 'healthy' | 'broken' | 'malformed' = 'healthy'): DestinationAdapter & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    manifest: { adapterId: id, displayName: id, executableLabel: id, versionArgs: ['--version'], supportedRange: '0.x', testedCapabilities: ['detection', 'catalog'], controllability: 'controllable', installationGuidance: '', authenticationGuidance: '', qualification: ROUTING_COMPATIBILITY_MANIFESTS[id] },
    detect: async () => { calls.push('detect'); if (behavior === 'broken') throw new Error('private output'); return { adapterId: id, displayName: id, installation: 'detected', compatibility: 'supported', controllability: 'controllable', readiness: 'unchecked', executableLabel: id, installedVersion: '0.1.0', supportedRange: '0.x', testedCapabilities: ['detection'], evidenceAt: '2026-07-14T10:00:00.000Z', reasonCode: null, guidance: '' } },
    checkAuthentication: async () => { calls.push('auth'); return { state: 'ready', reasonCode: null } },
    listConnectionModels: async () => { calls.push('catalog'); return behavior === 'malformed' ? { changed: true } : { adapterId: id, adapterVersion: '1', installedVersion: '0.1.0', checkedAt: '2026-07-14T10:00:00.000Z', expiresAt: '2026-07-14T10:15:00.000Z', models: [{ providerId: 'provider', modelId: 'model', displayName: 'Model', reasoning: true, supportedEfforts: ['high'] }] } },
  }
}

describe('destination adapter qualification lifecycle', () => {
  it.each(['complete', 'fail', 'mismatch', 'malformed'] as const)('normalizes bounded execution behavior for the reusable fake (%s)', async (behavior) => {
    const fake = new FakeDestinationAdapter(behavior)
    const controller = new AbortController()
    const profile = { id: 'route:fake', displayName: 'Fake', destinationAdapterId: 'fake', destinationInstanceId: 'fake:default', providerId: 'provider', modelId: 'model', effort: 'high', capabilityIds: ['writing'], enabled: true, behavior: 'auto-exact' as const, fallbackOrder: 0, readiness: { state: 'ready' as const, checkedAt: '2026-07-14T10:00:00.000Z', expiresAt: '2026-07-14T10:15:00.000Z', adapterVersion: '1', installedVersion: '1', reasonCode: null } }
    const events = []
    for await (const event of fake.execute!(profile, 'bounded fixture', controller.signal)) events.push(event)
    if (behavior === 'complete') expect(events.at(-1)).toMatchObject({ type: 'completed', actualRoute: { modelId: 'model' } })
    if (behavior === 'fail') expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'FAKE_FAILURE' })
    if (behavior === 'mismatch') expect(events.at(-1)).toMatchObject({ actualRoute: { modelId: 'different-model' } })
    if (behavior === 'malformed') expect(events).toHaveLength(1)
  })

  it('propagates cancellation through the reusable fake without producing a completion', async () => {
    const fake = new FakeDestinationAdapter('hang')
    const controller = new AbortController()
    const profile = { id: 'route:fake', displayName: 'Fake', destinationAdapterId: 'fake', destinationInstanceId: 'fake:default', providerId: 'provider', modelId: 'model', effort: null, capabilityIds: ['writing'], enabled: true, behavior: 'auto-exact' as const, fallbackOrder: 0, readiness: { state: 'ready' as const, checkedAt: '2026-07-14T10:00:00.000Z', expiresAt: '2026-07-14T10:15:00.000Z', adapterVersion: '1', installedVersion: '1', reasonCode: null } }
    const events: unknown[] = []
    const consume = (async () => { try { for await (const event of fake.execute!(profile, 'cancel fixture', controller.signal)) events.push(event) } catch { /* expected abort */ } })()
    while (events.length === 0) await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    controller.abort(); await consume
    expect(events).toEqual([expect.objectContaining({ type: 'started' })])
  })

  it('discovery is detection-only and cannot enable, authenticate, catalog, or execute', async () => {
    const healthy = adapter('codex-cli')
    const { database, service } = await fixture([healthy])
    const connections = await service.discover()
    expect(healthy.calls).toEqual(['detect'])
    expect(connections).toEqual([expect.objectContaining({ adapterId: 'codex-cli', enabled: false, authState: 'unchecked' })])
    database.close()
  })

  it('qualifies auth and catalog before explicit enablement and returns only safe evidence', async () => {
    const healthy = adapter('codex-cli')
    const { database, service } = await fixture([healthy])
    const [detected] = await service.discover()
    const refreshed = await service.refresh(detected.id, new AbortController().signal)
    expect(healthy.calls).toEqual(['detect', 'detect', 'auth', 'catalog'])
    expect(refreshed).toMatchObject({ connection: { enabled: false, authState: 'ready' }, catalog: { connectionId: detected.id, verification: 'manifest' } })
    expect(service.setEnabled(detected.id, true)).toMatchObject({ enabled: true })
    expect(JSON.stringify(refreshed)).not.toMatch(/stdout|stderr|environment|executablePath|credential|secretRef|prompt|result/i)
    database.close()
  })

  it('isolates one failed adapter and rejects malformed catalogs as unsupported evidence', async () => {
    const healthy = adapter('codex-cli')
    const broken = adapter('ollama-local', 'broken')
    const { database, service } = await fixture([healthy, broken])
    const discovered = await service.discover()
    expect(discovered).toEqual(expect.arrayContaining([expect.objectContaining({ adapterId: 'codex-cli' }), expect.objectContaining({ adapterId: 'ollama-local', authState: 'unchecked' })]))
    const malformed = adapter('ollama-local', 'malformed')
    const second = new RoutingConnectionService([malformed], new RoutingConnectionRepository(database.db), new RoutingRepository(database.db), () => new Date('2026-07-14T10:00:00.000Z'))
    const connection: RoutingConnectionDto = { id: 'connection:ollama-local:default', adapterId: 'ollama-local', displayName: 'Ollama', enabled: false, authMode: 'local-runtime', authState: 'unchecked', installedVersion: '0.1.0', supportedRange: '0.x', readinessCheckedAt: null, catalogRefreshedAt: null, config: {}, secretRef: null }
    new RoutingConnectionRepository(database.db).save(connection)
    await expect(second.refresh(connection.id, new AbortController().signal)).rejects.toThrow('ROUTING_CATALOG_MALFORMED')
    expect(second.catalog(connection.id)).toBeNull()
    database.close()
  })
})
