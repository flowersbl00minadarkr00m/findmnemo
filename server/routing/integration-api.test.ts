import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemorySecretStore } from '../auth/secret-store.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { FakeDestinationAdapter } from './adapters/fake-adapter.js'
import { DispatchService } from './dispatch-service.js'
import { RoutingIntegrationApi } from './integration-api.js'
import { RoutingIntegrationAuthService } from './integration-auth.js'
import { RoutingRepository } from './routing-repository.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('RoutingIntegrationApi', () => {
  it('rejects unscoped callers before dispatch and exposes no task through read methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-integration-')); roots.push(root)
    const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') }); const repository = new RoutingRepository(database.db)
    const adapter = new FakeDestinationAdapter(); const dispatches = new DispatchService(repository, [adapter]); const auth = new RoutingIntegrationAuthService(new MemorySecretStore()); const api = new RoutingIntegrationApi(auth, dispatches, repository)
    await expect(api.dispatch('wrong', { idempotencyKey: 'nope', origin: { adapterId: 'codex', correlationId: 'turn', conversationRefHash: null }, capabilityIds: ['writing'], classificationSource: 'explicit', classificationAmbiguous: false, override: { mode: 'none' }, task: 'private' })).rejects.toThrow('ROUTING_INTEGRATION_UNAUTHORIZED')
    expect(adapter.calls).toBe(0)
    const token = await auth.ensure()
    await expect(api.read(token, 'missing')).resolves.toBeNull()
    database.close()
  })
})
