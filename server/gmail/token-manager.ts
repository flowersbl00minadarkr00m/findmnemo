import type { SecretStore } from '../auth/secret-store.js'

const REFRESH_TOKEN_KEY = 'gmail-refresh-token'

export interface OAuthTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  token_type?: string
  scope?: string
}

export interface TokenProvider {
  refresh(refreshToken: string): Promise<OAuthTokenResponse>
  revoke(token: string): Promise<void>
}

export class GmailTokenManager {
  private access?: { value: string; expiresAt: number }
  private readonly store: SecretStore
  private readonly provider: TokenProvider
  private readonly now: () => number
  constructor(store: SecretStore, provider: TokenProvider, now = () => Date.now()) {
    this.store = store
    this.provider = provider
    this.now = now
  }

  async accept(response: OAuthTokenResponse): Promise<void> {
    if (response.refresh_token) await this.store.set(REFRESH_TOKEN_KEY, response.refresh_token)
    this.access = { value: response.access_token, expiresAt: this.now() + Math.max(0, response.expires_in - 60) * 1000 }
  }

  async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > this.now()) return this.access.value
    const refresh = await this.store.get(REFRESH_TOKEN_KEY)
    if (!refresh) throw new Error('GMAIL_TOKEN_REVOKED')
    try {
      const response = await this.provider.refresh(refresh)
      await this.accept(response)
      return response.access_token
    } catch {
      throw new Error('GMAIL_REFRESH_FAILED')
    }
  }

  async connected(): Promise<boolean> { return this.store.has(REFRESH_TOKEN_KEY) }

  async revoke(): Promise<void> {
    const refresh = await this.store.get(REFRESH_TOKEN_KEY)
    if (refresh) await this.provider.revoke(refresh)
    this.access = undefined
    await this.store.delete(REFRESH_TOKEN_KEY)
  }
}
