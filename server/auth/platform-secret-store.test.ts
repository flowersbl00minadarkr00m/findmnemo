import { describe, expect, it, vi } from 'vitest'
import type { SecretStore } from './secret-store.js'
import { createPlatformSecretStore } from './platform-secret-store.js'

function fakeKeyring(options: { setError?: Error; getError?: Error; deleteError?: Error } = {}) {
  const values = new Map<string, string>()
  const accounts: string[] = []
  class AsyncEntry {
    readonly service: string
    readonly account: string
    constructor(service: string, account: string) { this.service = service; this.account = account; accounts.push(account) }
    async setPassword(value: string) { if (options.setError) throw options.setError; values.set(this.account, value) }
    async getPassword() { if (options.getError) throw options.getError; return values.get(this.account) }
    async deleteCredential() { if (options.deleteError) throw options.deleteError; return values.delete(this.account) }
  }
  return { module: { AsyncEntry }, values, accounts }
}

describe('platform secret-store factory', () => {
  it('retains the Windows DPAPI factory without loading a native adapter', async () => {
    const store = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), has: vi.fn() } as unknown as SecretStore
    const loadKeyring = vi.fn()
    const result = await createPlatformSecretStore({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\fixture' }, windowsStore: () => store, loadKeyring })
    expect(result).toEqual({ capability: expect.objectContaining({ backend: 'windows-dpapi', state: 'available' }), store })
    expect(loadKeyring).not.toHaveBeenCalled()
  })

  it.each([
    ['darwin', 'macos-keychain'],
    ['linux', 'linux-secret-service'],
  ] as const)('probes, cleans, and returns the approved %s store', async (platform, backend) => {
    const fake = fakeKeyring()
    const result = await createPlatformSecretStore({ platform, loadKeyring: async () => fake.module, probeId: () => 'fixture', probeValue: () => 'private-probe-value' })
    expect(result.capability).toMatchObject({ backend, state: 'available', code: 'CREDENTIAL_STORE_AVAILABLE' })
    expect(result.store).toBeDefined()
    expect(fake.values.size).toBe(0)
    expect(JSON.stringify(result.capability)).not.toMatch(/fixture|private-probe-value|FindMnemo/i)
  })

  it.each([
    [new Error('permission denied'), 'permission-required', 'CREDENTIAL_PERMISSION_REQUIRED'],
    [new Error('keychain locked'), 'locked', 'CREDENTIAL_STORE_UNAVAILABLE'],
    [new Error('native module missing'), 'unavailable', 'NATIVE_ADAPTER_UNSUPPORTED'],
  ] as const)('fails closed and maps native errors without returning a store', async (error, state, code) => {
    const fake = fakeKeyring({ setError: error })
    const result = await createPlatformSecretStore({ platform: 'linux', loadKeyring: async () => fake.module, probeId: () => 'fixture', probeValue: () => 'private-probe-value' })
    expect(result).toEqual({ capability: expect.objectContaining({ state, code }) })
    expect(result.store).toBeUndefined()
    expect(fake.values.size).toBe(0)
    expect(JSON.stringify(result)).not.toMatch(/private-probe-value|native module missing/i)
  })

  it('fails closed when probe cleanup fails', async () => {
    const fake = fakeKeyring({ deleteError: new Error('cleanup fixture failure') })
    const result = await createPlatformSecretStore({ platform: 'darwin', loadKeyring: async () => fake.module, probeId: () => 'fixture', probeValue: () => 'private-probe-value' })
    expect(result).toEqual({ capability: expect.objectContaining({ state: 'unavailable', code: 'CREDENTIAL_STORE_UNAVAILABLE' }) })
    expect(result.store).toBeUndefined()
  })

  it('returns unsupported without loading or persisting a fallback', async () => {
    const loadKeyring = vi.fn()
    const result = await createPlatformSecretStore({ platform: 'freebsd', loadKeyring })
    expect(result).toEqual({ capability: expect.objectContaining({ state: 'unsupported', code: 'UNSUPPORTED_PLATFORM' }) })
    expect(loadKeyring).not.toHaveBeenCalled()
    expect(result.store).toBeUndefined()
  })
})
