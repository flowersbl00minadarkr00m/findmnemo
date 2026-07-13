import type { OAuthTransport } from './oauth.js'
import { DesktopGmailOAuth, GMAIL_METADATA_SCOPE, type OAuthFlowAttempt } from './oauth.js'
import { GoogleOAuthTransport } from './google-oauth-transport.js'
import { GmailTokenManager } from './token-manager.js'
import { createPlatformSecretStore, type CredentialCapability, type PlatformSecretStoreOptions, type PlatformSecretStoreResult } from '../auth/platform-secret-store.js'

export interface GmailServices {
  configured: boolean
  credentialCapability: CredentialCapability
  scope: typeof GMAIL_METADATA_SCOPE
  connect(): Promise<void>
  startConnect(): Promise<{ authorizationUrl: string }>
  connected(): Promise<boolean>
  revoke(): Promise<void>
  accessToken(): Promise<string>
}

export interface CreateGmailServicesOptions {
  env?: NodeJS.ProcessEnv
  secretStoreResult?: PlatformSecretStoreResult
  platformSecretStore?: PlatformSecretStoreOptions
  transport?: OAuthTransport & { refresh: GoogleOAuthTransport['refresh']; revoke: GoogleOAuthTransport['revoke'] }
}

export async function createGmailServices(options: CreateGmailServicesOptions = {}): Promise<GmailServices> {
  const env = options.env ?? process.env
  const clientId = env.FINDMNEMO_GOOGLE_CLIENT_ID?.trim().replace(/^"|"$/g, '')
  const clientSecret = env.FINDMNEMO_GOOGLE_CLIENT_SECRET?.trim().replace(/^"|"$/g, '')
  const config = { clientId: clientId ?? '', clientSecret: clientSecret || undefined }
  const storeResult = options.secretStoreResult ?? await createPlatformSecretStore(options.platformSecretStore)
  if (!storeResult.store) return unavailableGmailServices(storeResult.capability)
  const transport = options.transport ?? new GoogleOAuthTransport(config)
  const store = storeResult.store
  const tokens = new GmailTokenManager(store, transport)
  const oauth = new DesktopGmailOAuth(config, transport, tokens)
  let pendingAttempt: OAuthFlowAttempt | undefined
  return {
    configured: Boolean(clientId),
    credentialCapability: storeResult.capability,
    scope: GMAIL_METADATA_SCOPE,
    connect: async () => { if (!clientId) throw new Error('GMAIL_NOT_CONFIGURED'); await oauth.connect() },
    startConnect: async () => {
      if (!clientId) throw new Error('GMAIL_NOT_CONFIGURED')
      if (!pendingAttempt) {
        const attempt = await oauth.begin()
        pendingAttempt = attempt
        void attempt.completion.finally(() => {
          if (pendingAttempt === attempt) pendingAttempt = undefined
        }).catch(() => undefined)
      }
      return { authorizationUrl: pendingAttempt.authorizationUrl }
    },
    connected: () => clientId ? tokens.connected() : Promise.resolve(false),
    revoke: () => tokens.revoke(),
    accessToken: () => tokens.accessToken(),
  }
}

function unavailableGmailServices(credentialCapability: CredentialCapability): GmailServices {
  const error = () => Promise.reject(new Error(credentialCapability.code))
  return {
    configured: false,
    credentialCapability,
    scope: GMAIL_METADATA_SCOPE,
    connect: error,
    startConnect: error,
    connected: async () => false,
    revoke: async () => undefined,
    accessToken: error,
  }
}
