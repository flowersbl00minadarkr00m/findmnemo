import { describe, expect, it, vi } from 'vitest'
import { MemorySecretStore } from '../auth/secret-store.js'
import { DesktopGmailOAuth, GMAIL_METADATA_SCOPE, type OAuthTransport } from './oauth.js'
import { GmailTokenManager, type TokenProvider } from './token-manager.js'

function provider(): TokenProvider {
  return { refresh: vi.fn(async () => ({ access_token: 'fixture-a2', expires_in: 3600 })), revoke: vi.fn(async () => undefined) }
}

function callbackTransport(mode: 'success' | 'deny' | 'mismatch'): OAuthTransport {
  return {
    openBrowser: async (authorizationUrl) => {
      const authorization = new URL(authorizationUrl)
      expect(authorization.searchParams.get('scope')).toBe(GMAIL_METADATA_SCOPE)
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
      const callback = new URL(authorization.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', mode === 'mismatch' ? 'wrong' : authorization.searchParams.get('state')!)
      if (mode === 'deny') callback.searchParams.set('error', 'access_denied')
      else callback.searchParams.set('code', 'fixture-code')
      setTimeout(() => void fetch(callback), 5)
    },
    exchange: vi.fn(async ({ verifier }) => {
      expect(verifier.length).toBeGreaterThan(32)
      return { access_token: 'fixture-a1', refresh_token: 'fixture-r1', expires_in: 3600 }
    }),
  }
}

describe('Desktop Gmail OAuth', () => {
  it('uses PKCE and persists only the refresh secret', async () => {
    const store = new MemorySecretStore()
    const tokens = new GmailTokenManager(store, provider())
    const result = await new DesktopGmailOAuth({ clientId: 'fixture-client' }, callbackTransport('success'), tokens).connect()
    expect(result).toEqual({ connected: true, scope: GMAIL_METADATA_SCOPE })
    expect(await store.has('gmail-refresh-token')).toBe(true)
    expect(await tokens.accessToken()).toBe('fixture-a1')
  })

  it('returns the authorization URL before consent completes', async () => {
    const store = new MemorySecretStore()
    const tokens = new GmailTokenManager(store, provider())
    const transport = callbackTransport('success')
    const attempt = await new DesktopGmailOAuth({ clientId: 'fixture-client' }, transport, tokens).begin()

    expect(new URL(attempt.authorizationUrl).hostname).toBe('accounts.google.com')
    await transport.openBrowser(attempt.authorizationUrl)
    await expect(attempt.completion).resolves.toEqual({ connected: true, scope: GMAIL_METADATA_SCOPE })
  })

  it.each([
    ['deny', 'OAUTH_DENIED'],
    ['mismatch', 'OAUTH_STATE_MISMATCH'],
  ] as const)('fails closed on %s', async (mode, code) => {
    const tokens = new GmailTokenManager(new MemorySecretStore(), provider())
    await expect(new DesktopGmailOAuth({ clientId: 'fixture-client' }, callbackTransport(mode), tokens).connect()).rejects.toThrow(code)
  })

  it('times out without exchanging a code', async () => {
    const transport: OAuthTransport = { openBrowser: async () => undefined, exchange: vi.fn() }
    const tokens = new GmailTokenManager(new MemorySecretStore(), provider())
    await expect(new DesktopGmailOAuth({ clientId: 'fixture-client', timeoutMs: 10 }, transport, tokens).connect()).rejects.toThrow('OAUTH_TIMEOUT')
    expect(transport.exchange).not.toHaveBeenCalled()
  })

  it('refreshes in memory and revokes the protected secret', async () => {
    let now = 0
    const store = new MemorySecretStore()
    const tokenProvider = provider()
    const tokens = new GmailTokenManager(store, tokenProvider, () => now)
    await tokens.accept({ access_token: 'fixture-a1', refresh_token: 'fixture-r1', expires_in: 61 })
    expect(await tokens.accessToken()).toBe('fixture-a1')
    now = 2_000
    expect(await tokens.accessToken()).toBe('fixture-a2')
    await tokens.revoke()
    expect(await tokens.connected()).toBe(false)
    expect(tokenProvider.revoke).toHaveBeenCalledOnce()
  })
})
