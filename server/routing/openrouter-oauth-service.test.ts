import { describe, expect, it } from 'vitest'
import { MemorySecretStore } from '../auth/secret-store.js'
import { OPENROUTER_SECRET_KEY, OpenRouterOAuthService } from './openrouter-oauth-service.js'

describe('OpenRouterOAuthService', () => {
  it('uses S256 on a random loopback callback and stores the exchanged key without returning it', async () => {
    const store = new MemorySecretStore()
    let exchangeBody: Record<string, unknown> | undefined
    const fixtureKey = `${'sk'}-or-v1-fixture-key-with-safe-length-123456`
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => { exchangeBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ key: fixtureKey }), { status: 200 }) }
    const service = new OpenRouterOAuthService(store, fetcher as typeof fetch)
    const begun = await service.begin()
    const authorization = new URL(begun.authorizationUrl)
    expect(authorization.origin).toBe('https://openrouter.ai')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(begun.authorizationUrl).not.toMatch(/code_verifier|sk-or-v1/)
    const callback = new URL(authorization.searchParams.get('callback_url')!)
    callback.searchParams.set('code', 'fixture-code')
    expect((await fetch(callback)).status).toBe(200)
    for (let index = 0; index < 20 && service.status().state === 'pending'; index += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(service.status()).toMatchObject({ state: 'ready', expiresAt: null })
    expect(exchangeBody).toMatchObject({ code: 'fixture-code', code_challenge_method: 'S256', code_verifier: expect.any(String) })
    expect(await store.get(OPENROUTER_SECRET_KEY)).toBe(fixtureKey)
    expect(JSON.stringify(service.status())).not.toContain('sk-or-v1')
  })
  it('rejects bad state, clears transient flow, and cannot replay', async () => {
    const service = new OpenRouterOAuthService(new MemorySecretStore(), fetch as typeof fetch)
    const begun = await service.begin()
    const authorization = new URL(begun.authorizationUrl)
    const callback = new URL(authorization.searchParams.get('callback_url')!); callback.searchParams.set('state', 'wrong'); callback.searchParams.set('code', 'code')
    expect((await fetch(callback)).status).toBe(400)
    expect(service.status()).toMatchObject({ state: 'failed', errorCode: 'OPENROUTER_OAUTH_INVALID' })
    await expect(fetch(callback)).rejects.toThrow()
  })
})
