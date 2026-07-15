import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { SecretStore } from '../auth/secret-store.js'

export const OPENROUTER_SECRET_KEY = 'routing-secret:openrouter:default'
type OAuthState = { state: 'idle' | 'pending' | 'ready' | 'failed' | 'cancelled'; expiresAt: string | null; errorCode: string | null }

export class OpenRouterOAuthService {
  private readonly store: SecretStore
  private readonly fetcher: typeof fetch
  private readonly clock: () => Date
  private server?: Server
  private verifier?: string
  private stateToken?: string
  private snapshot: OAuthState = { state: 'idle', expiresAt: null, errorCode: null }
  private timer?: NodeJS.Timeout
  private connectionChangePending = false
  constructor(store: SecretStore, fetcher: typeof fetch = fetch, clock: () => Date = () => new Date()) { this.store = store; this.fetcher = fetcher; this.clock = clock }

  async begin(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    await this.cancel()
    this.verifier = randomBytes(48).toString('base64url')
    this.stateToken = randomBytes(24).toString('base64url')
    const challenge = createHash('sha256').update(this.verifier).digest('base64url')
    this.server = createServer((request, response) => { void this.handleCallback(request.url ?? '/', response) })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('OPENROUTER_CALLBACK_UNAVAILABLE')
    const callback = `http://127.0.0.1:${address.port}/callback?state=${encodeURIComponent(this.stateToken)}`
    const expiresAt = new Date(this.clock().getTime() + 5 * 60_000).toISOString()
    this.snapshot = { state: 'pending', expiresAt, errorCode: null }
    this.connectionChangePending = false
    this.timer = setTimeout(() => { void this.fail('OPENROUTER_OAUTH_EXPIRED') }, 5 * 60_000); this.timer.unref()
    const authorizationUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`
    return { authorizationUrl, expiresAt }
  }
  status(): OAuthState { return { ...this.snapshot } }
  consumeConnectionChange(): boolean { const pending = this.connectionChangePending; this.connectionChangePending = false; return pending }
  async cancel(): Promise<void> { if (this.snapshot.state === 'pending') this.snapshot = { state: 'cancelled', expiresAt: null, errorCode: null }; this.clearTransient() }
  async revoke(): Promise<void> { await this.store.delete(OPENROUTER_SECRET_KEY); await this.cancel(); this.snapshot = { state: 'idle', expiresAt: null, errorCode: null } }
  async storeExistingKey(key: string): Promise<void> { if (!/^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error('OPENROUTER_KEY_INVALID'); await this.store.set(OPENROUTER_SECRET_KEY, key) }

  private async handleCallback(rawUrl: string, response: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(rawUrl, 'http://127.0.0.1')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (this.snapshot.state !== 'pending' || !code || state !== this.stateToken || !this.verifier || Date.parse(this.snapshot.expiresAt ?? '') <= this.clock().getTime()) { response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); response.end('FindMnemo could not accept this authorization. You can close this window.'); await this.fail('OPENROUTER_OAUTH_INVALID'); return }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); response.end('OpenRouter is connected to FindMnemo. You can close this window.')
    try {
      const exchange = await this.fetcher('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: this.verifier, code_challenge_method: 'S256' }), redirect: 'error', signal: AbortSignal.timeout(15_000) })
      const data = await exchange.json() as { key?: unknown }
      if (!exchange.ok || typeof data.key !== 'string') throw new Error('exchange failed')
      await this.store.set(OPENROUTER_SECRET_KEY, data.key)
      this.snapshot = { state: 'ready', expiresAt: null, errorCode: null }
      this.connectionChangePending = true
      this.clearTransient()
    } catch { await this.fail('OPENROUTER_OAUTH_EXCHANGE_FAILED') }
  }
  private async fail(code: string): Promise<void> { this.snapshot = { state: 'failed', expiresAt: null, errorCode: code }; this.clearTransient() }
  private clearTransient(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.verifier = undefined; this.stateToken = undefined; this.server?.close(); this.server = undefined }
}
