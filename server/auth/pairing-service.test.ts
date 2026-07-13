import { describe, expect, it } from 'vitest'
import { PairingService } from './pairing-service.js'

describe('PairingService', () => {
  it('expires codes after five minutes and sessions after fifteen minutes', () => {
    let now = new Date('2026-07-10T00:00:00.000Z')
    const service = new PairingService(() => now)
    const code = service.issueCode()
    now = new Date('2026-07-10T00:05:00.000Z')
    expect(service.exchange(code, 'browser_nonce_1234567890')).toEqual({ ok: false, code: 'PAIRING_CODE_EXPIRED' })

    now = new Date('2026-07-10T01:00:00.000Z')
    const freshCode = service.issueCode()
    const session = service.exchange(freshCode, 'browser_nonce_1234567890')
    expect(session.ok).toBe(true)
    if (!session.ok) return
    now = new Date('2026-07-10T01:15:00.000Z')
    expect(service.validate(session.token)).toEqual({ ok: false, code: 'SESSION_EXPIRED' })
  })

  it('applies cooldown after five failed attempts', () => {
    const service = new PairingService(() => new Date('2026-07-10T00:00:00.000Z'))
    service.issueCode()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(service.exchange('00000000', 'browser_nonce_1234567890')).toEqual({ ok: false, code: 'PAIRING_CODE_INVALID' })
    }
    expect(service.exchange('00000000', 'browser_nonce_1234567890')).toEqual({ ok: false, code: 'PAIRING_RATE_LIMITED' })
  })

  it('makes local bootstrap nonces single use', () => {
    const service = new PairingService(() => new Date('2026-07-10T00:00:00.000Z'))
    const nonce = service.issueLocalBootstrap()
    expect(service.exchangeLocalBootstrap(nonce, 'local_browser_nonce_123456').ok).toBe(true)
    expect(service.exchangeLocalBootstrap(nonce, 'local_browser_nonce_123456')).toEqual({ ok: false, code: 'PAIRING_CODE_INVALID' })
  })
})
