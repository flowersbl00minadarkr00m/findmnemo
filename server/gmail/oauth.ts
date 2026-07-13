import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { GmailTokenManager, OAuthTokenResponse } from './token-manager.js'

export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata'

export interface DesktopOAuthConfig {
  clientId: string
  clientSecret?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  timeoutMs?: number
}

export interface OAuthTransport {
  openBrowser(url: string): Promise<void>
  exchange(input: { code: string; redirectUri: string; verifier: string; config: DesktopOAuthConfig }): Promise<OAuthTokenResponse>
}

export interface OAuthFlowResult { connected: true; scope: typeof GMAIL_METADATA_SCOPE }
export interface OAuthFlowAttempt { authorizationUrl: string; completion: Promise<OAuthFlowResult> }

export class DesktopGmailOAuth {
  private readonly config: DesktopOAuthConfig
  private readonly transport: OAuthTransport
  private readonly tokens: GmailTokenManager
  constructor(config: DesktopOAuthConfig, transport: OAuthTransport, tokens: GmailTokenManager) {
    this.config = config
    this.transport = transport
    this.tokens = tokens
  }

  async connect(): Promise<OAuthFlowResult> {
    const attempt = await this.begin()
    await this.transport.openBrowser(attempt.authorizationUrl)
    return await attempt.completion
  }

  async begin(): Promise<OAuthFlowAttempt> {
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(24).toString('base64url')
    const callback = await createCallback(state, this.config.timeoutMs ?? 120_000)
    const authorization = new URL(this.config.authorizationEndpoint ?? 'https://accounts.google.com/o/oauth2/v2/auth')
    authorization.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: callback.redirectUri,
      response_type: 'code',
      scope: GMAIL_METADATA_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()
    const completion = (async (): Promise<OAuthFlowResult> => {
      const code = await callback.code
      const response = await this.transport.exchange({ code, redirectUri: callback.redirectUri, verifier, config: this.config })
      await this.tokens.accept(response)
      return { connected: true, scope: GMAIL_METADATA_SCOPE }
    })()
    return { authorizationUrl: authorization.toString(), completion }
  }
}

async function createCallback(expectedState: string, timeoutMs: number): Promise<{ redirectUri: string; code: Promise<string> }> {
  let resolveCode!: (value: string) => void
  let rejectCode!: (cause: Error) => void
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.searchParams.get('error')) rejectCode(new Error('OAUTH_DENIED'))
    else if (url.searchParams.get('state') !== expectedState) rejectCode(new Error('OAUTH_STATE_MISMATCH'))
    else if (!url.searchParams.get('code')) rejectCode(new Error('OAUTH_DENIED'))
    else resolveCode(url.searchParams.get('code')!)
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end('Return to FindMnemo.')
    server.close()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('INTERNAL_ERROR')
  const timer = setTimeout(() => { rejectCode(new Error('OAUTH_TIMEOUT')); server.close() }, timeoutMs)
  void code.finally(() => clearTimeout(timer)).catch(() => undefined)
  return { redirectUri: `http://127.0.0.1:${address.port}/oauth/callback`, code }
}
