import { describe, expect, it } from 'vitest'
import { deriveCompanionConnectionState, sessionRotationDelay } from './companion-client'

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

  it('rotates two minutes before expiry and immediately when the rotation window has started', () => {
    expect(sessionRotationDelay(session, Date.parse('2026-07-10T00:00:00.000Z'))).toBe(13 * 60_000)
    expect(sessionRotationDelay(session, Date.parse('2026-07-10T00:14:00.000Z'))).toBe(0)
    expect(sessionRotationDelay({ ...session, expiresAt: 'invalid' })).toBe(0)
  })
})
