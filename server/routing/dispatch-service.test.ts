import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OperationalRoutingPolicy, OperationalRoutingPolicyV3, RoutingConnectionDto, RoutingProfileV3 } from '../../shared/companion-contract.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { ProjectFolderRepository } from '../onboarding/project-folder-repository.js'
import type { AdapterConnectionContext, AdapterManifest, DestinationAdapter, DestinationExecutionEvent } from './adapter-contract.js'
import { FakeDestinationAdapter } from './adapters/fake-adapter.js'
import { RoutingConnectionRepository } from './connection-repository.js'
import { DispatchService } from './dispatch-service.js'
import { ProjectContextResolver } from './project-context-resolver.js'
import { RoutingRepository } from './routing-repository.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))
const clock = () => new Date('2026-07-12T22:00:00.000Z')

function policy(behavior: 'recommend' | 'auto-exact' = 'auto-exact'): OperationalRoutingPolicy {
  return {
    schemaVersion: '2.0.0', policyProfile: 'findmnemo.model-routing.v2', policyVersion: 0, updatedAt: clock().toISOString(),
    capabilities: [{ id: 'creation.writing', family: 'creation', label: 'Writing', description: 'Draft text', origin: 'built-in' }],
    profiles: [{ id: 'route:writer', displayName: 'Writer', destinationAdapterId: 'fake', destinationInstanceId: 'fake:one', providerId: 'openrouter', modelId: 'writer-model', effort: 'high', capabilityIds: ['creation.writing'], enabled: true, behavior, fallbackOrder: 0, readiness: { state: 'ready', checkedAt: '2026-07-12T21:55:00.000Z', expiresAt: '2026-07-12T22:15:00.000Z', adapterVersion: '1.0.0', installedVersion: '1.0.0', reasonCode: null } }],
    defaultProfileOrder: ['route:writer'], capabilityOverrides: [],
  }
}

async function setup(behavior: 'recommend' | 'auto-exact' = 'auto-exact') {
  const directory = await mkdtemp(join(tmpdir(), 'findmnemo-dispatch-')); cleanup.push(directory)
  const database = await openFindMnemoDatabase({ path: join(directory, 'findmnemo.db') })
  const repository = new RoutingRepository(database.db); repository.compareAndSetPolicy(policy(behavior), null)
  return { database, repository }
}

function request(idempotencyKey = 'dispatch-key') {
  return { idempotencyKey, origin: { adapterId: 'codex-mcp', correlationId: 'turn-1', conversationRefHash: 'hash-only' }, capabilityIds: ['writing'], classificationSource: 'explicit' as const, classificationAmbiguous: false, override: { mode: 'none' as const }, task: 'private task canary' }
}

describe('DispatchService', () => {
  it('executes an exact ready profile once and returns the existing receipt for duplicate keys', async () => {
    const { database, repository } = await setup(); const adapter = new FakeDestinationAdapter(); const service = new DispatchService(repository, [adapter], clock)
    const first = await service.dispatch(request())
    expect(first).toMatchObject({ disposition: 'completed', output: 'fake:private task canary', receipt: { state: 'completed', returnState: 'pending', policyVersion: 1, requestedProfileSnapshot: { modelId: 'writer-model', effort: 'high' } } })
    const duplicate = await service.dispatch(request())
    expect(duplicate).toMatchObject({ disposition: 'existing', output: 'fake:private task canary', receipt: { id: first.receipt?.id } })
    expect(adapter.calls).toBe(1)
    const stored = database.db.prepare('SELECT requested_profile_json,request_hash,result_hash FROM routing_dispatch_receipts').get()
    expect(JSON.stringify(stored)).not.toContain('private task canary')
    database.close()
  })

  it('collapses concurrent duplicate calls to one adapter execution', async () => {
    const { database, repository } = await setup(); const adapter = new FakeDestinationAdapter(); const service = new DispatchService(repository, [adapter], clock)
    const [left, right] = await Promise.all([service.dispatch(request('concurrent')), service.dispatch(request('concurrent'))])
    expect([left.disposition, right.disposition].sort()).toEqual(['completed', 'existing'])
    expect(adapter.calls).toBe(1); database.close()
  })

  it('does not invoke recommendation-only, ambiguous, stale, or partial routes', async () => {
    const { database, repository } = await setup('recommend'); const adapter = new FakeDestinationAdapter(); const service = new DispatchService(repository, [adapter], clock)
    await expect(service.dispatch(request())).resolves.toMatchObject({ disposition: 'decision-required', reasonCode: 'RECOMMENDATION_ONLY' })
    await expect(service.dispatch({ ...request('ambiguous'), classificationAmbiguous: true })).resolves.toMatchObject({ disposition: 'decision-required' })
    await expect(service.dispatch({ ...request('partial'), capabilityIds: ['writing', 'review'] })).resolves.toMatchObject({ disposition: 'unavailable', reasonCode: 'NO_EXACT_PROFILE' })
    expect(adapter.calls).toBe(0); database.close()
  })

  it('keeps healthy in-process preflight below 500 ms', async () => {
    const { database, repository } = await setup(); const service = new DispatchService(repository, [new FakeDestinationAdapter()], clock)
    const started = performance.now()
    expect(service.preflight(request())).toMatchObject({ disposition: 'auto-dispatch-eligible', policyVersion: 1 })
    expect(performance.now() - started).toBeLessThan(500)
    database.close()
  })

  it('normalizes plain-language capability labels and controlled aliases to the current stable policy ID', async () => {
    const { database, repository } = await setup(); const adapter = new FakeDestinationAdapter(); const service = new DispatchService(repository, [adapter], clock)
    const result = await service.dispatch({ ...request('plain-language'), capabilityIds: ['writing', 'text-generation'] })
    expect(result).toMatchObject({ disposition: 'completed', receipt: { capabilityIds: ['creation.writing'] } })
    expect(adapter.calls).toBe(1)
    database.close()
  })

  it.each([['fail', 'failed', 'FAKE_FAILURE'], ['mismatch', 'failed', 'ACTUAL_ROUTE_MISMATCH'], ['malformed', 'failed', 'DESTINATION_RESULT_MALFORMED'], ['hang', 'timed-out', 'DESTINATION_TIMEOUT']] as const)('records %s outcomes without presenting delivered success', async (behavior, disposition, reasonCode) => {
    const { database, repository } = await setup(); const adapter = new FakeDestinationAdapter(behavior); const service = new DispatchService(repository, [adapter], clock)
    const result = await service.dispatch({ ...request(behavior), timeoutMs: 100 })
    expect(result).toMatchObject({ disposition, reasonCode, receipt: { returnState: 'return-unavailable' } })
    if (behavior === 'mismatch') expect(result.receipt).toMatchObject({ actualRoute: { modelId: 'different-model' }, failureCode: 'ACTUAL_ROUTE_MISMATCH' })
    database.close()
  })

  it('cancels active work and creates an explicit linked retry generation', async () => {
    const { database, repository } = await setup(); const hanging = new FakeDestinationAdapter('hang'); const service = new DispatchService(repository, [hanging], clock)
    const pending = service.dispatch({ ...request('cancel-me'), timeoutMs: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const active = repository.listDispatchReceipts()[0]
    service.cancel(active.id)
    const cancelled = await pending
    expect(cancelled).toMatchObject({ disposition: 'cancelled', receipt: { state: 'cancelled' } })
    const retryService = new DispatchService(repository, [new FakeDestinationAdapter()], clock)
    const retry = await retryService.dispatch({ ...request('retry-key'), retryOfReceiptId: active.id })
    expect(retry).toMatchObject({ disposition: 'completed', receipt: { generation: 2, priorReceiptId: active.id } })
    database.close()
  })

  it('marks interrupted accepted/running work unavailable after companion restart', async () => {
    const { database, repository } = await setup()
    repository.createDispatchReceipt({ id: 'receipt-interrupted', idempotencyKey: 'interrupted', generation: 1, priorReceiptId: null, origin: request().origin, capabilityIds: ['writing'], classificationSource: 'explicit', policyVersion: 1, requestedProfileSnapshot: { profileId: 'route:writer', destinationAdapterId: 'fake', destinationInstanceId: 'fake:one', providerId: 'openrouter', modelId: 'writer-model', effort: 'high', behavior: 'auto-exact' }, createdAt: clock().toISOString(), requestHash: 'hash' })
    new DispatchService(repository, [new FakeDestinationAdapter()], clock)
    expect(repository.getDispatchReceipt('receipt-interrupted')).toMatchObject({ state: 'failed', returnState: 'return-unavailable', failureCode: 'COMPANION_RESTARTED' })
    database.close()
  })

  it('retries from bounded companion memory and fails honestly after that memory is lost', async () => {
    const { database, repository } = await setup(); const service = new DispatchService(repository, [new FakeDestinationAdapter('fail')], clock)
    const failed = await service.dispatch(request('retry-source'))
    expect(failed).toMatchObject({ disposition: 'failed', receipt: { generation: 1 } })
    const retryingService = service as DispatchService
    await expect(retryingService.retry(failed.receipt!.id, 'retry-generation')).resolves.toMatchObject({ receipt: { generation: 2, priorReceiptId: failed.receipt!.id } })
    const restarted = new DispatchService(repository, [new FakeDestinationAdapter()], clock)
    await expect(restarted.retry(failed.receipt!.id, 'retry-after-restart')).resolves.toMatchObject({ disposition: 'failed', reasonCode: 'RESULT_CONTENT_UNAVAILABLE' })
    database.close()
  })
})

class FakeConnectionAdapter implements DestinationAdapter {
  calls = 0
  readonly manifest: AdapterManifest
  private readonly adapterId: RoutingConnectionDto['adapterId']
  private readonly behavior: 'complete' | 'fail'
  constructor(adapterId: RoutingConnectionDto['adapterId'], behavior: 'complete' | 'fail', evidence: readonly ('provider' | 'model' | 'effort')[] = ['model']) {
    this.adapterId = adapterId
    this.behavior = behavior
    const authMode = adapterId === 'ollama-local' ? 'local-runtime' as const : 'tool-owned' as const
    this.manifest = { adapterId, displayName: adapterId, executableLabel: adapterId, versionArgs: [], supportedRange: '1.x', testedCapabilities: ['execution'], controllability: 'controllable', installationGuidance: '', authenticationGuidance: '', qualification: { adapterId, support: 'controllable', supportedVersions: '1.x', authMode, catalogMode: 'tested-manifest', actualRouteEvidence: evidence, cancellation: 'abort-request' } }
  }
  async detect() { return { adapterId: this.adapterId, displayName: this.adapterId, installation: 'detected' as const, compatibility: 'supported' as const, controllability: 'controllable' as const, readiness: 'unchecked' as const, executableLabel: this.adapterId, installedVersion: '1.0.0', supportedRange: '1.x', testedCapabilities: ['execution'], evidenceAt: clock().toISOString(), reasonCode: null, guidance: '' } }
  async *executeConnectionProfile(profile: RoutingProfileV3, task: string, context: AdapterConnectionContext): AsyncIterable<DestinationExecutionEvent> {
    this.calls += 1
    if (context.dispatchChain?.depth !== 1 || !context.dispatchChain.token) throw new Error('CHAIN_MISSING')
    if (this.behavior === 'fail') { yield { type: 'failed' as const, code: 'FAKE_FAILURE' }; return }
    const actualRoute = { destinationAdapterId: this.adapterId, destinationInstanceId: context.connection.id, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort }
    yield { type: 'started' as const, actualRoute }
    yield { type: 'completed' as const, text: `v3:${task}`, actualRoute }
  }
}

async function setupV3() {
  const directory = await mkdtemp(join(tmpdir(), 'findmnemo-dispatch-v3-')); cleanup.push(directory)
  const database = await openFindMnemoDatabase({ path: join(directory, 'findmnemo.db') })
  const repository = new RoutingRepository(database.db)
  const connections = new RoutingConnectionRepository(database.db)
  const profileReadiness = { state: 'ready' as const, checkedAt: clock().toISOString(), expiresAt: '2026-07-13T22:00:00.000Z', adapterVersion: '1.0.0', installedVersion: '1.0.0', reasonCode: null }
  const connection = (id: string, adapterId: RoutingConnectionDto['adapterId']): RoutingConnectionDto => ({ id, adapterId, displayName: id, enabled: true, authMode: adapterId === 'ollama-local' ? 'local-runtime' : 'tool-owned', authState: 'ready', installedVersion: '1.0.0', supportedRange: '1.x', readinessCheckedAt: clock().toISOString(), catalogRefreshedAt: clock().toISOString(), config: {}, secretRef: null })
  const primary = connection('connection:primary', 'codex-cli'); const backup = connection('connection:backup', 'ollama-local')
  for (const value of [primary, backup]) {
    connections.save(value)
    connections.saveCatalog({ connectionId: value.id, adapterId: value.adapterId, adapterVersion: '1.0.0', installedVersion: '1.0.0', checkedAt: clock().toISOString(), expiresAt: '2026-07-13T22:00:00.000Z', source: 'tested-manifest', verification: 'manifest', models: [{ providerId: value.adapterId, modelId: `${value.id}:model`, displayName: value.id, reasoning: false, supportedEfforts: [] }] })
  }
  const policy: OperationalRoutingPolicyV3 = { schemaVersion: '3.0.0', policyProfile: 'findmnemo.model-routing.v3', policyVersion: 0, updatedAt: clock().toISOString(), capabilities: [{ id: 'creation.writing', family: 'creation', label: 'Writing', description: 'Draft text', origin: 'built-in' }], profiles: [
    { id: 'profile:primary', displayName: 'Primary', kind: 'executable', connectionId: primary.id, providerId: 'openai', modelId: `${primary.id}:model`, effort: null, readiness: profileReadiness, enabled: true },
    { id: 'profile:backup', displayName: 'Backup', kind: 'executable', connectionId: backup.id, providerId: 'ollama', modelId: `${backup.id}:model`, effort: null, readiness: profileReadiness, enabled: true },
  ], assignments: [{ capabilityId: 'default', profileOrder: ['profile:primary', 'profile:backup'], behavior: 'send-automatically' }, { capabilityId: 'creation.writing', profileOrder: ['profile:primary', 'profile:backup'], behavior: 'send-automatically' }] }
  repository.compareAndSetPolicyV3(policy, null, connections.list())
  const contexts = new ProjectContextResolver(new ProjectFolderRepository(database.db), join(directory, 'scratch'))
  return { database, repository, connections, contexts }
}

describe('DispatchService v3', () => {
  it('falls back once, records honest evidence, and returns the result to the origin call', async () => {
    const { database, repository, connections, contexts } = await setupV3()
    const primary = new FakeConnectionAdapter('codex-cli', 'fail', [])
    const backup = new FakeConnectionAdapter('ollama-local', 'complete', ['model'])
    const service = new DispatchService(repository, [primary, backup], clock, { connections, projectContexts: contexts })
    const result = await service.dispatch(request('v3-fallback'))
    expect(result).toMatchObject({ disposition: 'completed', output: 'v3:private task canary', receipt: { state: 'completed' } })
    expect(primary.calls).toBe(1); expect(backup.calls).toBe(1)
    expect(repository.getDispatchReceiptV2(result.receipt!.id)).toMatchObject({ fallbackFromProfileIds: ['profile:primary'], requestedRoute: { connectionId: 'connection:primary', verification: 'requested-unverified' }, actualRoute: { connectionId: 'connection:backup', modelId: 'connection:backup:model', providerId: null, verification: 'destination-reported' }, chain: { depth: 0, parentDispatchId: null } })
    database.close()
  })

  it('executes an idempotency key once and blocks recursive re-entry', async () => {
    const { database, repository, connections, contexts } = await setupV3()
    const primary = new FakeConnectionAdapter('codex-cli', 'complete', [])
    const service = new DispatchService(repository, [primary], clock, { connections, projectContexts: contexts })
    const [first, duplicate] = await Promise.all([service.dispatch(request('v3-once')), service.dispatch(request('v3-once'))])
    expect([first.disposition, duplicate.disposition].sort()).toEqual(['completed', 'existing'])
    expect(primary.calls).toBe(1)
    await expect(service.dispatch({ ...request('v3-recursive'), chain: { id: 'chain', depth: 1, parentDispatchId: first.receipt!.id } })).resolves.toMatchObject({ disposition: 'failed', reasonCode: 'recursive-dispatch-blocked' })
    expect(primary.calls).toBe(1)
    database.close()
  })
})
