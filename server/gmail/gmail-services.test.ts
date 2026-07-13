import { describe, expect, it, vi } from 'vitest'
import { MemorySecretStore } from '../auth/secret-store.js'
import type { OAuthTransport } from './oauth.js'
import type { TokenProvider } from './token-manager.js'
import { createGmailServices } from './gmail-services.js'

const transport: OAuthTransport & TokenProvider = {
  openBrowser: vi.fn(async () => undefined), exchange: vi.fn(),
  refresh: vi.fn(async () => ({ access_token: 'fixture-access', expires_in: 3600 })), revoke: vi.fn(async () => undefined),
}

describe('Gmail service platform store', () => {
  it.each([
    ['windows-dpapi'], ['macos-keychain'], ['linux-secret-service'],
  ] as const)('uses an available %s SecretStore through the shared token manager', async (backend) => {
    const store = new MemorySecretStore()
    const service = await createGmailServices({ env: { FINDMNEMO_GOOGLE_CLIENT_ID: 'fixture-client' }, secretStoreResult: { capability: { backend, state: 'available', code: 'CREDENTIAL_STORE_AVAILABLE', guidance: 'Available.' }, store }, transport })
    expect(service).toMatchObject({ configured: true, credentialCapability: { backend, state: 'available' } })
    expect(await service.connected()).toBe(false)
    await store.set('gmail-refresh-token', 'fixture-refresh')
    expect(await service.connected()).toBe(true)
    await service.revoke()
    expect(await store.has('gmail-refresh-token')).toBe(false)
  })

  it.each([
    ['locked', 'CREDENTIAL_STORE_UNAVAILABLE'],
    ['permission-required', 'CREDENTIAL_PERMISSION_REQUIRED'],
    ['unavailable', 'NATIVE_ADAPTER_UNSUPPORTED'],
  ] as const)('fails closed when the credential backend is %s', async (state, code) => {
    const service = await createGmailServices({ env: { FINDMNEMO_GOOGLE_CLIENT_ID: 'fixture-client' }, secretStoreResult: { capability: { backend: 'linux-secret-service', state, code, guidance: 'Safe local recovery.' } } })
    expect(service).toMatchObject({ configured: false, credentialCapability: { state, code } })
    expect(await service.connected()).toBe(false)
    await expect(service.startConnect()).rejects.toThrow(code)
    expect(JSON.stringify(service.credentialCapability)).not.toMatch(/account|token|secret value|native error/i)
  })

  it('does not claim configured when OAuth client configuration is absent', async () => {
    const service = await createGmailServices({ env: {}, secretStoreResult: { capability: { backend: 'macos-keychain', state: 'available', code: 'CREDENTIAL_STORE_AVAILABLE', guidance: 'Available.' }, store: new MemorySecretStore() }, transport })
    expect(service.configured).toBe(false)
    expect(await service.connected()).toBe(false)
    await expect(service.startConnect()).rejects.toThrow('GMAIL_NOT_CONFIGURED')
  })
})
