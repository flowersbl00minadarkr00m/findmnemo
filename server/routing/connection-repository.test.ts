import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RoutingConnectionDto } from '../../shared/companion-contract.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { RoutingConnectionRepository } from './connection-repository.js'
import { RoutingRepository } from './routing-repository.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function createRepository() {
  const directory = await mkdtemp(join(tmpdir(), 'findmnemo-connections-'))
  cleanup.push(directory)
  const database = await openFindMnemoDatabase({ path: join(directory, 'findmnemo.db') })
  return { database, repository: new RoutingConnectionRepository(database.db) }
}

function connection(overrides: Partial<RoutingConnectionDto> = {}): RoutingConnectionDto {
  return { id: 'connection:pi', adapterId: 'pi-rpc', displayName: 'Pi', enabled: false, authMode: 'tool-owned', authState: 'unchecked', installedVersion: null, supportedRange: '^1', readinessCheckedAt: null, catalogRefreshedAt: null, config: {}, secretRef: null, ...overrides }
}

describe('RoutingConnectionRepository', () => {
  it('persists safe connection-scoped catalogs without enabling discovery', async () => {
    const { database, repository } = await createRepository()
    repository.save(connection())
    repository.saveCatalog({ connectionId: 'connection:pi', adapterId: 'pi-rpc', adapterVersion: '1', installedVersion: '1.2.3', checkedAt: '2026-07-14T10:00:00.000Z', expiresAt: '2026-07-14T10:15:00.000Z', source: 'cli', verification: 'observed', models: [{ providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4', displayName: 'Claude', reasoning: true, supportedEfforts: ['high'] }] })
    expect(repository.get('connection:pi')).toMatchObject({ enabled: false, authState: 'unchecked' })
    expect(repository.readCatalog('connection:pi')).toMatchObject({ connectionId: 'connection:pi', verification: 'observed' })
    database.close()
  })

  it('rejects credentials, raw paths, and enabling an unready connection', async () => {
    const { database, repository } = await createRepository()
    expect(() => repository.save(connection({ config: { apiToken: 'secret' } }))).toThrow('ROUTING_CONNECTION_INVALID')
    expect(() => repository.save(connection({ config: { executablePath: 'C:\\private\\tool.exe' } }))).toThrow('ROUTING_CONNECTION_INVALID')
    expect(() => repository.save(connection({ enabled: true }))).toThrow('ROUTING_CONNECTION_NOT_READY')
    database.close()
  })

  it('invalidates catalog, effort, readiness, and enablement when connection identity changes', async () => {
    const { database, repository } = await createRepository()
    repository.save(connection({ authState: 'ready', enabled: true }))
    repository.saveCatalog({ connectionId: 'connection:pi', adapterId: 'pi-rpc', adapterVersion: '1', installedVersion: '1.2.3', checkedAt: '2026-07-14T10:00:00.000Z', expiresAt: '2026-07-14T10:15:00.000Z', source: 'cli', verification: 'observed', models: [] })
    new RoutingRepository(database.db).compareAndSetPolicyV3({ schemaVersion: '3.0.0', policyProfile: 'findmnemo.model-routing.v3', policyVersion: 0, updatedAt: '2026-07-14T10:00:00.000Z', capabilities: [{ id: 'writing', family: 'creation', label: 'Writing', description: 'Draft', origin: 'built-in' }], profiles: [{ id: 'route:pi', displayName: 'Pi', kind: 'executable', connectionId: 'connection:pi', providerId: 'openrouter', modelId: 'model', effort: 'high', readiness: { state: 'ready', checkedAt: '2026-07-14T10:00:00.000Z', expiresAt: '2026-07-14T10:15:00.000Z', adapterVersion: '1', installedVersion: '1.2.3', reasonCode: null }, enabled: true }], assignments: [{ capabilityId: 'default', profileOrder: ['route:pi'], behavior: 'ask-before-send' }, { capabilityId: 'writing', profileOrder: ['route:pi'], behavior: 'ask-before-send' }] }, null, repository.list())
    repository.save(connection({ adapterId: 'codex-cli', authState: 'ready', enabled: true }))
    expect(repository.readCatalog('connection:pi')).toBeNull()
    expect(new RoutingRepository(database.db).readPolicyV3()?.profiles[0]).toMatchObject({ enabled: false, effort: null, readiness: { state: 'unchecked', reasonCode: 'CONNECTION_CHANGED' } })
    database.close()
  })
})
