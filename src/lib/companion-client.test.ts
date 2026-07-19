import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveCompanionConnectionState, getCompanionIdentity, getUsageCapability, sessionRotationDelay } from './companion-client'

const identity = { protocolVersion: '1.0.0', companionVersion: '0.1.0', instanceId: 'test', pairingRequired: true } as const
const session = { token: 'memory-only', browserNonce: 'browser_nonce_1234567890', expiresAt: '2026-07-10T00:15:00.000Z' }
const status = {
  companion: { state: 'connected', version: '0.1.0', instanceId: 'test' },
  database: { state: 'pending' },
  gmail: { state: 'disconnected' },
  sources: [],
  checkedAt: '2026-07-10T00:00:00.000Z',
} as const

describe('companion connection state', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('requires identity, session, and current authenticated status for connected', () => {
    expect(deriveCompanionConnectionState({ permission: 'prompt' })).toBe('permission-required')
    expect(deriveCompanionConnectionState({ identity })).toBe('pairing-required')
    expect(deriveCompanionConnectionState({ identity, session })).toBe('error')
    expect(deriveCompanionConnectionState({ identity, session, status }, Date.parse('2026-07-10T00:01:00.000Z'))).toBe('connected')
    expect(deriveCompanionConnectionState({ identity, session, status }, Date.parse('2026-07-10T00:03:00.001Z'))).toBe('stale')
  })

  it('preserves explicit denied and unsupported evidence', () => {
    expect(deriveCompanionConnectionState({ permission: 'denied' })).toBe('permission-denied')
    expect(deriveCompanionConnectionState({ permission: 'unsupported' })).toBe('unsupported')
  })

  it('aborts an identity probe that never resolves', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCompanionIdentity(5)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rotates two minutes before expiry and immediately when the rotation window has started', () => {
    expect(sessionRotationDelay(session, Date.parse('2026-07-10T00:00:00.000Z'))).toBe(13 * 60_000)
    expect(sessionRotationDelay(session, Date.parse('2026-07-10T00:14:00.000Z'))).toBe(0)
    expect(sessionRotationDelay({ ...session, expiresAt: 'invalid' })).toBe(0)
  })

  it('reads the paired usage capability through the fixed endpoint', async () => {
    const capability = {
      schema: 'findmnemo.usage-capability.v1', state: 'not-installed', executableLabel: 'tokscale', collectorSource: 'unavailable', installedVersion: null,
      supportedRange: '>=4.4.1 <4.6.0', adapterId: null, checkedAt: '2026-07-13T12:00:00.000Z', lastSuccessfulRefreshAt: null,
      sources: [], reasonCode: 'TOKSCALE_NOT_INSTALLED', guidance: { summary: 'Install locally.', installationUrl: 'https://github.com/junhoyeo/tokscale', automaticInstall: false },
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: capability }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getUsageCapability(session)).resolves.toEqual(capability)
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3210/api/v1/usage/capability', expect.objectContaining({ redirect: 'error' }))
  })
})
