import { describe, expect, it } from 'vitest'
import type { RoutingConnectionDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import { MemorySecretStore } from '../../auth/secret-store.js'
import { OPENROUTER_SECRET_KEY } from '../openrouter-oauth-service.js'
import { OpenRouterAdapter } from './openrouter-adapter.js'

const connection: RoutingConnectionDto = { id: 'connection:openrouter', adapterId: 'openrouter', displayName: 'OpenRouter', enabled: true, authMode: 'companion-oauth', authState: 'ready', installedVersion: '1.0.0', supportedRange: '1.x', readinessCheckedAt: null, catalogRefreshedAt: null, config: {}, secretRef: OPENROUTER_SECRET_KEY }
const profile: RoutingProfileV3 = { id: 'route:openrouter', displayName: 'OpenRouter', kind: 'executable', connectionId: connection.id, providerId: 'openai', modelId: 'openai/gpt-5.4', effort: 'high', readiness: { state: 'ready', checkedAt: null, expiresAt: null, adapterVersion: '1', installedVersion: '1', reasonCode: null }, enabled: true }
const context = { connection, projectContext: { kind: 'scratch' as const, opaqueId: 'scratch:empty', localPath: 'unused' } }
const FIXTURE_KEY = `${'sk'}-or-v1-private-fixture-key`
async function configuredStore() { const store = new MemorySecretStore(); await store.set(OPENROUTER_SECRET_KEY, FIXTURE_KEY); return store }

describe('OpenRouterAdapter', () => {
  it('validates the current key and normalizes a live connection-scoped catalog', async () => {
    const store = await configuredStore(); const calls: Array<{ url: string; auth: string | null }> = []
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => { const headers = new Headers(init?.headers); calls.push({ url: String(url), auth: headers.get('authorization') }); return String(url).endsWith('/key') ? new Response('{"data":{"label":"redacted"}}') : new Response(JSON.stringify({ data: [{ id: 'openai/gpt-5.4', name: 'GPT-5.4', supported_parameters: ['reasoning'] }] })) }
    const adapter = new OpenRouterAdapter(store, fetcher as typeof fetch)
    expect(await adapter.checkAuthentication!(context, new AbortController().signal)).toEqual({ state: 'ready', reasonCode: null })
    expect(await adapter.listConnectionModels!(context, new AbortController().signal)).toMatchObject({ models: [{ modelId: 'openai/gpt-5.4', supportedEfforts: ['low', 'medium', 'high'] }] })
    expect(calls.every((call) => call.auth === `Bearer ${FIXTURE_KEY}`)).toBe(true)
  })
  it('sends exact model and returns the destination-reported response model without exposing the key', async () => {
    const store = await configuredStore(); let request: RequestInit | undefined
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => { request = init; return new Response(JSON.stringify({ model: 'openai/gpt-5.4-20260701', choices: [{ message: { role: 'assistant', content: 'Cloud result.' } }] })) }
    const adapter = new OpenRouterAdapter(store, fetcher as typeof fetch)
    const events = []; for await (const event of adapter.executeConnectionProfile!(profile, 'private task', context, new AbortController().signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'completed', text: 'Cloud result.', actualRoute: { modelId: 'openai/gpt-5.4-20260701' } })
    expect(JSON.parse(String(request?.body))).toMatchObject({ model: 'openai/gpt-5.4', reasoning: { effort: 'high' } })
    expect(JSON.stringify(events)).not.toContain('sk-or-v1')
  })
  it.each([[401, 'OPENROUTER_KEY_INVALID'], [402, 'OPENROUTER_CREDITS_REQUIRED'], [429, 'OPENROUTER_RATE_LIMITED'], [404, 'OPENROUTER_MODEL_UNAVAILABLE']])('maps safe HTTP failure %s', async (status, code) => {
    const adapter = new OpenRouterAdapter(await configuredStore(), (async () => new Response('{}', { status })) as typeof fetch)
    const events = []; for await (const event of adapter.executeConnectionProfile!(profile, 'task', context, new AbortController().signal)) events.push(event)
    expect(events.at(-1)).toEqual({ type: 'failed', code })
  })
})
