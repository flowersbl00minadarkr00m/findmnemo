import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OperationalPolicyMigrationPreview, OperationalRoutingPolicy } from '../../shared/companion-contract.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { RoutingRepository } from './routing-repository.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

function policy(version = 0): OperationalRoutingPolicy {
  return {
    schemaVersion: '2.0.0', policyProfile: 'findmnemo.model-routing.v2', policyVersion: version,
    updatedAt: '2026-07-12T20:00:00.000Z',
    capabilities: [{ id: 'writing', family: 'creation', label: 'Writing', description: 'Draft text', origin: 'built-in' }],
    profiles: [{
      id: 'route:pi-writing', displayName: 'Pi writing', destinationAdapterId: 'manual', destinationInstanceId: 'legacy:route:pi-writing',
      providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4', effort: null, capabilityIds: ['writing'], enabled: true,
      behavior: 'recommend', fallbackOrder: 0,
      readiness: { state: 'unchecked', checkedAt: null, expiresAt: null, adapterVersion: null, installedVersion: null, reasonCode: null },
    }],
    defaultProfileOrder: ['route:pi-writing'], capabilityOverrides: [{ capabilityId: 'writing', profileOrder: ['route:pi-writing'] }],
  }
}

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), 'findmnemo-routing-'))
  cleanup.push(directory)
  return join(directory, 'findmnemo.db')
}

describe('RoutingRepository', () => {
  it('persists a normalized policy across restart and assigns monotonic versions', async () => {
    const path = await databasePath()
    const first = await openFindMnemoDatabase({ path })
    const saved = new RoutingRepository(first.db).compareAndSetPolicy(policy(), null)
    expect(saved).toMatchObject({ status: 'saved', policy: { policyVersion: 1 } })
    first.close()

    const reopened = await openFindMnemoDatabase({ path })
    expect(new RoutingRepository(reopened.db).readPolicy()).toEqual({ ...policy(), policyVersion: 1 })
    reopened.close()
  })

  it('rejects stale compare-and-set writes without overwriting the current policy', async () => {
    const path = await databasePath()
    const database = await openFindMnemoDatabase({ path })
    const repository = new RoutingRepository(database.db)
    repository.compareAndSetPolicy(policy(), null)
    const next = { ...policy(1), updatedAt: '2026-07-12T20:01:00.000Z' }
    expect(repository.compareAndSetPolicy(next, 0)).toMatchObject({ status: 'conflict', current: { policyVersion: 1 } })
    expect(repository.readPolicy()?.updatedAt).toBe('2026-07-12T20:00:00.000Z')
    database.close()
  })

  it('previews without writing and commits one migration idempotently', async () => {
    const path = await databasePath()
    const database = await openFindMnemoDatabase({ path })
    const repository = new RoutingRepository(database.db)
    const preview: OperationalPolicyMigrationPreview = { sourcePolicyRevision: 'v1:stable', policy: policy() }
    expect(repository.previewMigration(preview).policy.policyVersion).toBe(1)
    expect(repository.readPolicy()).toBeNull()
    const committed = repository.commitMigration(preview, '2026-07-12T20:00:00.000Z')
    expect(repository.commitMigration(preview, '2026-07-12T20:01:00.000Z')).toEqual(committed)
    expect(repository.exportV1Compatible()).toMatchObject({ schemaVersion: '1.0.0', routes: [{ id: 'route:pi-writing', enabled: true }] })
    database.close()
  })

  it('rejects private or malformed policy fields', async () => {
    const path = await databasePath()
    const database = await openFindMnemoDatabase({ path })
    const repository = new RoutingRepository(database.db)
    expect(() => repository.compareAndSetPolicy({ ...policy(), accessToken: 'canary-secret' } as never, null)).toThrow('ROUTING_POLICY_INVALID')
    expect(() => repository.compareAndSetPolicy({ ...policy(), profiles: [{ ...policy().profiles[0], modelId: 'C:\\Users\\private\\model.bin' }] }, null)).toThrow('ROUTING_POLICY_INVALID')
    expect(() => repository.compareAndSetPolicy({ ...policy(), defaultProfileOrder: ['missing'] }, null)).toThrow('ROUTING_POLICY_INVALID')
    database.close()
  })

  it('persists safe catalog evidence and applies readiness with policy concurrency', async () => {
    const path = await databasePath()
    const database = await openFindMnemoDatabase({ path })
    const repository = new RoutingRepository(database.db)
    const operational = policy()
    operational.profiles[0] = { ...operational.profiles[0], destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default' }
    const saved = repository.compareAndSetPolicy(operational, null)
    expect(saved.status).toBe('saved')
    const catalog = { adapterId: 'pi-rpc', adapterVersion: '1.0.0', installedVersion: '0.80.3', checkedAt: '2026-07-12T20:00:00.000Z', expiresAt: '2026-07-12T20:15:00.000Z', models: [{ providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4', displayName: 'Claude Sonnet 4', reasoning: true, supportedEfforts: ['high'] }] }
    repository.saveCatalog(catalog)
    expect(repository.readCatalog('pi-rpc')).toEqual(catalog)
    const readiness = { profileId: 'route:pi-writing', state: 'ready' as const, checkedAt: '2026-07-12T20:01:00.000Z', expiresAt: '2026-07-12T20:16:00.000Z', adapterVersion: '1.0.0', installedVersion: '0.80.3', reasonCode: null }
    expect(repository.applyReadiness(readiness.profileId, readiness, 1)).toMatchObject({ status: 'saved', policy: { policyVersion: 2, profiles: [{ readiness: { state: 'ready' } }] } })
    expect(repository.applyReadiness(readiness.profileId, readiness, 1)).toMatchObject({ status: 'conflict', current: { policyVersion: 2 } })
    database.close()
  })
})
