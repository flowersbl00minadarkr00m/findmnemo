import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPANION_HOST, startCompanion, type RunningCompanion } from '../companion.js'
import { COMPANION_PROTOCOL_VERSION, type OperationalRoutingPolicy } from '../../shared/companion-contract.js'
import type { TokscaleRecipeInput } from './tokscale-command-runner.js'
import type { UsageCommandExecutor } from './usage-refresh-service.js'
import { MemorySecretStore } from '../auth/secret-store.js'
import { usageIdentityKey } from './usage-mapping.js'

const running: RunningCompanion[] = []
const cleanup: string[] = []
afterEach(async () => { await Promise.all(running.splice(0).map((item) => item.stop())); await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('usage refresh API', () => {
  it('starts, polls, and rejects browser-supplied process controls through a paired session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-usage-api-')); cleanup.push(directory); await mkdir(join(directory, 'dist'))
    await writeFile(join(directory, 'dist', 'index.html'), '<!doctype html>')
    const root = join(process.cwd(), 'server', 'usage', 'fixtures', 'v4.5.2')
    const executor: UsageCommandExecutor = {
      capability: async () => ({ schema: 'findmnemo.usage-capability.v1', state: 'installed-supported', executableLabel: 'tokscale', collectorSource: 'embedded', installedVersion: '4.5.2', supportedRange: '>=4.4.1 <4.6.0', adapterId: 'tokscale-v4.4-v4.5', checkedAt: '2026-07-13T12:00:00.000Z', lastSuccessfulRefreshAt: null, sources: [], reasonCode: null, guidance: { summary: 'Built-in collector ready.', installationUrl: 'https://github.com/flowersbl00minadarkr00m/findmnemo#model-usage', automaticInstall: false } }),
      run: async (input: TokscaleRecipeInput) => {
        const file = input.recipeId === 'canonical-graph' ? 'graph.json' : input.recipeId === 'clients' ? 'clients.json' : input.recipeId === 'session-attribution' ? 'models-session.json' : 'models-workspace.json'
        return { ok: true, recipeId: input.recipeId, json: await readFile(join(root, file), 'utf8'), durationMs: 1 }
      },
    }
    const companion = await startCompanion({ port: 0, distPath: join(directory, 'dist'), databasePath: join(directory, 'findmnemo.db'), routingSecretStore: new MemorySecretStore(), usageCommandExecutor: executor, clock: () => new Date('2026-07-13T12:00:00.000Z') }); running.push(companion)
    const base = `http://${COMPANION_HOST}:${companion.port}/api/v1`; const nonce = 'usage_api_nonce_1234567890'
    const baseHeaders = { origin: `http://${COMPANION_HOST}:${companion.port}`, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION }
    const paired = await fetch(`${base}/pairing/session`, { method: 'POST', headers: { ...baseHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ code: companion.pairingCode, browserNonce: nonce }) })
    const token = ((await paired.json()) as { data: { token: string } }).data.token
    const headers = { ...baseHeaders, authorization: `Bearer ${token}`, 'x-findmnemo-browser-nonce': nonce, 'content-type': 'application/json' }
    const policy: OperationalRoutingPolicy = {
      schemaVersion: '2.0.0', policyProfile: 'findmnemo.model-routing.v2', policyVersion: 0, updatedAt: '2026-07-13T12:00:00.000Z', capabilities: [{ id: 'writing', family: 'creation', label: 'Writing', description: 'Draft', origin: 'built-in' }],
      profiles: [{ id: 'route:exact', displayName: 'Exact', destinationAdapterId: 'codex', destinationInstanceId: 'codex:default', providerId: 'openrouter', modelId: 'openai/gpt-5', effort: null, capabilityIds: ['writing'], enabled: true, behavior: 'recommend', fallbackOrder: 0, readiness: { state: 'unchecked', checkedAt: null, expiresAt: null, adapterVersion: null, installedVersion: null, reasonCode: null } }], defaultProfileOrder: ['route:exact'], capabilityOverrides: [],
    }
    expect((await fetch(`${base}/routing/policy`, { method: 'PUT', headers, body: JSON.stringify({ policy, expectedPolicyVersion: null }) })).status).toBe(200)
    const startedResponse = await fetch(`${base}/usage/refreshes?command=login&executable=unsafe`, { method: 'POST', headers, body: JSON.stringify({ since: '2026-07-01', until: '2026-07-13', args: ['login'], env: { TOKEN: 'private' } }) })
    const started = (await startedResponse.json()) as { data: UsageRefreshRunDto }
    expect(startedResponse.status).toBe(202)
    let final = started.data
    for (let attempt = 0; attempt < 100 && !['complete', 'partial', 'failed'].includes(final.state); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      final = ((await (await fetch(`${base}/usage/refreshes/${started.data.id}`, { headers })).json()) as { data: UsageRefreshRunDto }).data
    }
    expect(final).toMatchObject({ state: 'partial', canonicalCount: 1 })
    expect(JSON.stringify(final)).not.toMatch(/login|unsafe|TOKEN|private|args|env/i)
    const policyBefore = (await (await fetch(`${base}/routing/policy`, { headers })).json() as { data: { policy: OperationalRoutingPolicy } }).data.policy
    const summary = await (await fetch(`${base}/usage/summary?clientId=codex&sort=unsafe`, { headers })).json() as { data: { recordCount: number; reasoningTokens: { state: string } } }
    expect(summary.data).toMatchObject({ recordCount: 1, reasoningTokens: { state: 'complete' } })
    const records = await (await fetch(`${base}/usage/records?limit=1`, { headers })).json() as { data: { records: Array<{ modelId: string; routeMapping: { state: string; profileId: string } }> } }
    expect(records.data.records[0].routeMapping).toMatchObject({ state: 'automatic', profileId: 'route:exact' })
    const identity = { clientId: 'codex', providerId: 'openrouter', modelId: records.data.records[0].modelId }
    const identityKey = usageIdentityKey(identity)
    expect((await fetch(`${base}/usage/mappings/${identityKey}`, { method: 'PUT', headers, body: JSON.stringify({ ...identity, profileId: 'route:exact' }) })).status).toBe(200)
    expect((await (await fetch(`${base}/usage/mappings`, { headers })).json() as { data: Array<{ state: string }> }).data).toEqual([expect.objectContaining({ state: 'manual' })])
    expect((await (await fetch(`${base}/usage/route-observations`, { headers })).json() as { data: unknown[] }).data.length).toBeGreaterThan(0)
    expect((await (await fetch(`${base}/routing/policy`, { headers })).json() as { data: { policy: OperationalRoutingPolicy } }).data.policy).toEqual(policyBefore)
    const csv = await (await fetch(`${base}/usage/export?format=csv&includeAttribution=true`, { headers })).text()
    expect(csv).toContain('canonical-daily')
    expect(csv).not.toMatch(/stdout|stderr|private|credential/i)
    expect((await fetch(`${base}/usage/history`, { method: 'DELETE', headers, body: JSON.stringify({ confirmation: 'clear-usage-history' }) })).status).toBe(200)
    expect((await (await fetch(`${base}/usage/mappings`, { headers })).json() as { data: unknown[] }).data).toHaveLength(1)
    expect((await fetch(`${base}/usage/mappings`, { method: 'DELETE', headers, body: JSON.stringify({ confirmation: 'clear-usage-mappings' }) })).status).toBe(200)
    expect((await (await fetch(`${base}/usage/mappings`, { headers })).json() as { data: unknown[] }).data).toEqual([])
  })
})

import type { UsageRefreshRunDto } from '../../shared/companion-contract.js'
