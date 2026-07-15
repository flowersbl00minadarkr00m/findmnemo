import { describe, expect, it } from 'vitest'
import type { RoutingConnectionDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import { OllamaLocalAdapter } from './ollama-local-adapter.js'

const connection: RoutingConnectionDto = { id: 'connection:ollama', adapterId: 'ollama-local', displayName: 'Ollama', enabled: true, authMode: 'local-runtime', authState: 'ready', installedVersion: '0.31.2', supportedRange: '0.x', readinessCheckedAt: null, catalogRefreshedAt: null, config: {}, secretRef: null }
const profile: RoutingProfileV3 = { id: 'route:ollama', displayName: 'Ollama', kind: 'executable', connectionId: connection.id, providerId: 'ollama', modelId: 'qwen3:8b', effort: 'off', readiness: { state: 'ready', checkedAt: null, expiresAt: null, adapterVersion: '1', installedVersion: '0.31.2', reasonCode: null }, enabled: true }
const context = { connection, projectContext: { kind: 'scratch' as const, opaqueId: 'scratch:empty', localPath: 'unused' } }

function fake(responses: Array<{ status?: number; body: unknown }>) { const calls: Array<{ url: string; init?: RequestInit }> = []; const fetcher = async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); const item = responses.shift()!; return new Response(JSON.stringify(item.body), { status: item.status ?? 200, headers: { 'content-type': 'application/json' } }) }; return { calls, fetcher: fetcher as typeof fetch } }

describe('OllamaLocalAdapter', () => {
  it('distinguishes runtime readiness from an empty installed inventory', async () => {
    const network = fake([{ body: { version: '0.31.2' } }, { body: { version: '0.31.2' } }, { body: { models: [] } }])
    const adapter = new OllamaLocalAdapter(network.fetcher)
    expect(await adapter.detect(new AbortController().signal)).toMatchObject({ compatibility: 'supported', installedVersion: '0.31.2' })
    expect(await adapter.listConnectionModels!(context, new AbortController().signal)).toMatchObject({ models: [] })
    expect(network.calls.every((call) => call.url.startsWith('http://127.0.0.1:11434/'))).toBe(true)
  })
  it('lists only installed models and sends the explicit model to local chat', async () => {
    const network = fake([{ body: { version: '0.31.2' } }, { body: { models: [{ name: 'qwen3:8b' }] } }, { body: { model: 'qwen3:8b', message: { role: 'assistant', content: 'Local result.' }, done: true } }])
    const adapter = new OllamaLocalAdapter(network.fetcher)
    expect((await adapter.listConnectionModels!(context, new AbortController().signal)).models).toEqual([expect.objectContaining({ modelId: 'qwen3:8b' })])
    const events = []
    for await (const event of adapter.executeConnectionProfile!(profile, 'private task', context, new AbortController().signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'completed', text: 'Local result.', actualRoute: { modelId: 'qwen3:8b' } })
    expect(JSON.parse(String(network.calls.at(-1)?.init?.body))).toMatchObject({ model: 'qwen3:8b', stream: false })
    expect(network.calls.map((call) => call.url)).toEqual(['http://127.0.0.1:11434/api/version', 'http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/chat'])
  })
  it('fails closed on malformed inventory and exposes no model management endpoint', async () => {
    const network = fake([{ body: { version: '0.31.2' } }, { body: { models: [{ changed: true }] } }])
    await expect(new OllamaLocalAdapter(network.fetcher).listConnectionModels!(context, new AbortController().signal)).rejects.toThrow('OLLAMA_SCHEMA_CHANGED')
    expect(network.calls.some((call) => /pull|create|copy|delete|push|cloud/i.test(call.url))).toBe(false)
  })
})
