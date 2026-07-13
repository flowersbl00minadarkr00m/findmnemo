import { spawn } from 'node:child_process'
import type { OAuthTokenResponse, TokenProvider } from './token-manager.js'
import type { DesktopOAuthConfig, OAuthTransport } from './oauth.js'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export class GoogleOAuthTransport implements OAuthTransport, TokenProvider {
  private readonly config: DesktopOAuthConfig
  constructor(config: DesktopOAuthConfig) { this.config = config }

  async openBrowser(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:FINDMNEMO_OAUTH_URL'],
        {
          windowsHide: true,
          stdio: 'ignore',
          env: { ...process.env, FINDMNEMO_OAUTH_URL: url },
        },
      )
      child.on('error', reject)
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error('OAUTH_BROWSER_OPEN_FAILED')))
    })
  }

  async exchange({ code, redirectUri, verifier, config }: { code: string; redirectUri: string; verifier: string; config: DesktopOAuthConfig }): Promise<OAuthTokenResponse> {
    return tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }, config.tokenEndpoint)
  }

  async refresh(refreshToken: string): Promise<OAuthTokenResponse> {
    return tokenRequest({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }, this.config.tokenEndpoint)
  }

  async revoke(token: string): Promise<void> {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
    if (!response.ok && response.status !== 400) throw new Error('GMAIL_TOKEN_REVOKED')
  }
}

async function tokenRequest(values: Record<string, string | undefined>, endpoint = TOKEN_ENDPOINT): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) body.set(key, value)
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  if (!response.ok) throw new Error('GMAIL_REFRESH_FAILED')
  return await response.json() as OAuthTokenResponse
}
