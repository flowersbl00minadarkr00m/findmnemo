import { describe, expect, it } from 'vitest'
import { createSourceRunCapabilityReport, type PlatformCapabilityInput } from './platform-capabilities.js'

const availableCredential = { backend: 'macos-keychain' as const, state: 'available' as const, code: 'CREDENTIAL_STORE_AVAILABLE', guidance: 'Available.' }
const base: Omit<PlatformCapabilityInput, 'platform' | 'architecture'> = {
  nodeVersion: 'v24.17.0', filesystem: { dataRootWritable: true, code: 'DATA_ROOT_WRITABLE' },
  listener: { port: 3210, state: 'available', code: 'COMPANION_STOPPED' }, database: { state: 'not-created', code: 'DATABASE_NOT_CREATED' },
  gmailConfigured: true, credentialCapability: availableCredential, generatedAt: '2026-07-12T00:00:00.000Z',
}

describe('source-run platform capabilities', () => {
  it.each([
    ['win32', 'x64', undefined, true, 'supported'],
    ['darwin', 'arm64', undefined, false, 'experimental'],
    ['darwin', 'x64', undefined, true, 'supported'],
    ['linux', 'x64', 'ubuntu-24.04-desktop', false, 'experimental'],
    ['linux', 'arm64', 'ubuntu-24.04-desktop', true, 'supported'],
    ['linux', 'x64', 'glibc', true, 'experimental'],
    ['linux', 'x64', 'musl', true, 'unsupported'],
    ['linux', 'x64', 'wsl', true, 'unsupported'],
    ['linux', 'arm64', 'headless', true, 'unsupported'],
    ['freebsd', 'x64', undefined, true, 'unsupported'],
  ] as const)('maps %s/%s/%s to %s', (platform, architecture, linuxEnvironment, cleanHostAccepted, supportLevel) => {
    expect(createSourceRunCapabilityReport({ ...base, platform, architecture, linuxEnvironment, cleanHostAccepted }).supportLevel).toBe(supportLevel)
  })

  it('separates core support from full Gmail parity and rejects non-Node-24 support claims', () => {
    const unavailable = createSourceRunCapabilityReport({ ...base, platform: 'darwin', architecture: 'arm64', cleanHostAccepted: true, credentialCapability: { state: 'locked', code: 'CREDENTIAL_STORE_UNAVAILABLE', guidance: 'Unlock locally.' } })
    expect(unavailable).toMatchObject({ supportLevel: 'experimental', gmail: { configured: false, credentialStore: { state: 'locked' } } })
    const wrongNode = createSourceRunCapabilityReport({ ...base, platform: 'win32', architecture: 'x64', nodeVersion: 'v26.1.0', credentialCapability: { ...availableCredential, backend: 'windows-dpapi' } })
    expect(wrongNode).toMatchObject({ supportLevel: 'experimental', node: { supported: false, code: 'NODE_VERSION_UNSUPPORTED' } })
  })

  it('sanitizes the runtime version and emits no private path or identity fields', () => {
    const report = createSourceRunCapabilityReport({ ...base, platform: 'linux', architecture: 'x64', linuxEnvironment: 'glibc', nodeVersion: 'v24.17.0-private/home/fixture', credentialCapability: { ...availableCredential, backend: 'linux-secret-service' } })
    expect(report.node.detected).toBe('v24.17.0')
    expect(JSON.stringify(report)).not.toMatch(/hostname|username|homeDir|env|account|credentialValue|private\/home/i)
  })
})
