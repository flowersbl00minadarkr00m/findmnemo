import { randomBytes, randomUUID } from 'node:crypto'
import { win32 } from 'node:path'
import type { SecretStore } from './secret-store.js'
import { NativeKeyringSecretStore, type NativeKeyringEntryFactory } from './native-keyring-store.js'
import { WindowsDpapiSecretStore } from './windows-dpapi-store.js'
import { resolvePlatformPaths } from '../platform/platform-paths.js'

export type CredentialBackend = 'windows-dpapi' | 'macos-keychain' | 'linux-secret-service'
export type CredentialCapabilityState = 'available' | 'permission-required' | 'locked' | 'unavailable' | 'unsupported'

export interface CredentialCapability {
  backend?: CredentialBackend
  state: CredentialCapabilityState
  code: string
  guidance: string
}

export interface PlatformSecretStoreResult {
  capability: CredentialCapability
  store?: SecretStore
}

interface KeyringModule {
  AsyncEntry: new (service: string, account: string) => {
    setPassword(value: string): Promise<void>
    getPassword(): Promise<string | undefined>
    deleteCredential(): Promise<boolean>
  }
}

export interface PlatformSecretStoreOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
  loadKeyring?: () => Promise<KeyringModule>
  windowsStore?: () => SecretStore
  probeId?: () => string
  probeValue?: () => string
}

export async function createPlatformSecretStore(options: PlatformSecretStoreOptions = {}): Promise<PlatformSecretStoreResult> {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    const store = options.windowsStore?.() ?? new WindowsDpapiSecretStore(win32.join(resolvePlatformPaths({ platform, env: options.env ?? process.env }).dataRoot, 'secrets'))
    return { capability: available('windows-dpapi'), store }
  }
  if (platform !== 'darwin' && platform !== 'linux') {
    return { capability: { state: 'unsupported', code: 'UNSUPPORTED_PLATFORM', guidance: 'Use a supported Windows, macOS, or Linux host. No credential was stored.' } }
  }

  const backend: CredentialBackend = platform === 'darwin' ? 'macos-keychain' : 'linux-secret-service'
  try {
    const module = await (options.loadKeyring ?? (() => import('@napi-rs/keyring')))()
    const entryFactory: NativeKeyringEntryFactory = (service, account) => new module.AsyncEntry(service, account)
    const store = new NativeKeyringSecretStore(entryFactory)
    await probeNativeStore(store, options.probeId?.() ?? randomUUID(), options.probeValue?.() ?? randomBytes(24).toString('base64url'))
    return { capability: available(backend), store }
  } catch (cause) {
    return { capability: unavailableCapability(backend, cause) }
  }
}

async function probeNativeStore(store: SecretStore, id: string, value: string): Promise<void> {
  const key = `findmnemo-probe-${id.replace(/[^a-z0-9_-]/gi, '')}`
  let primaryError: unknown
  try {
    await store.set(key, value)
    if (await store.get(key) !== value) throw new Error('KEYRING_PROBE_MISMATCH')
  } catch (cause) {
    primaryError = cause
  }
  try {
    await store.delete(key)
  } catch (cause) {
    throw new Error('KEYRING_PROBE_CLEANUP_FAILED', { cause })
  }
  if (primaryError) throw primaryError
}

function available(backend: CredentialBackend): CredentialCapability {
  return { backend, state: 'available', code: 'CREDENTIAL_STORE_AVAILABLE', guidance: 'The operating-system credential store is available.' }
}

function unavailableCapability(backend: CredentialBackend, cause: unknown): CredentialCapability {
  const message = cause instanceof Error ? cause.message.toLowerCase() : ''
  if (/permission|denied|consent/.test(message)) {
    return { backend, state: 'permission-required', code: 'CREDENTIAL_PERMISSION_REQUIRED', guidance: 'Allow FindMnemo to use the local operating-system credential store, then retry.' }
  }
  if (/locked|interaction.*not.*allowed/.test(message)) {
    return { backend, state: 'locked', code: 'CREDENTIAL_STORE_UNAVAILABLE', guidance: 'Unlock the local operating-system credential store, then retry.' }
  }
  return { backend, state: 'unavailable', code: message.includes('cleanup') ? 'CREDENTIAL_STORE_UNAVAILABLE' : 'NATIVE_ADAPTER_UNSUPPORTED', guidance: 'The approved native credential store is unavailable. Gmail remains disconnected and no plaintext fallback is used.' }
}
