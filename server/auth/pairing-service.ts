import { randomBytes, timingSafeEqual } from 'node:crypto'

const CODE_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 15 * 60_000
const COOLDOWN_MS = 60_000
const MAX_FAILURES = 5

interface PairingCodeRecord {
  hash: Buffer
  expiresAt: number
  used: boolean
}

interface SessionRecord {
  browserNonce: string
  expiresAt: number
}

interface BootstrapRecord {
  hash: Buffer
  expiresAt: number
  used: boolean
}

export type PairingExchangeResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; code: 'PAIRING_CODE_INVALID' | 'PAIRING_CODE_EXPIRED' | 'PAIRING_RATE_LIMITED' }

export type SessionValidationResult =
  | { ok: true; browserNonce: string; expiresAt: string }
  | { ok: false; code: 'SESSION_INVALID' | 'SESSION_EXPIRED' }

function digest(value: string): Buffer {
  return Buffer.from(value.normalize('NFKC'))
}

function matches(left: Buffer, right: Buffer): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

function token(): string {
  return randomBytes(32).toString('base64url')
}

export class PairingService {
  private pairingCode?: PairingCodeRecord
  private localBootstrap?: BootstrapRecord
  private readonly sessions = new Map<string, SessionRecord>()
  private failedAttempts = 0
  private cooldownUntil = 0
  private readonly now: () => Date

  constructor(now: () => Date = () => new Date()) {
    this.now = now
  }

  issueCode(): string {
    const code = String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')
    this.pairingCode = { hash: digest(code), expiresAt: this.now().getTime() + CODE_TTL_MS, used: false }
    this.failedAttempts = 0
    this.cooldownUntil = 0
    return code
  }

  issueLocalBootstrap(): string {
    const nonce = token()
    this.localBootstrap = {
      hash: digest(nonce),
      expiresAt: this.now().getTime() + CODE_TTL_MS,
      used: false,
    }
    return nonce
  }

  exchangeLocalBootstrap(nonce: string, browserNonce: string): PairingExchangeResult {
    const current = this.now().getTime()
    if (!this.localBootstrap || this.localBootstrap.used || !matches(this.localBootstrap.hash, digest(nonce))) {
      return { ok: false, code: 'PAIRING_CODE_INVALID' }
    }
    if (current >= this.localBootstrap.expiresAt) return { ok: false, code: 'PAIRING_CODE_EXPIRED' }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(browserNonce)) return { ok: false, code: 'PAIRING_CODE_INVALID' }

    this.localBootstrap.used = true
    const sessionToken = token()
    const expiresAt = current + SESSION_TTL_MS
    this.sessions.set(sessionToken, { browserNonce, expiresAt })
    return { ok: true, token: sessionToken, expiresAt: new Date(expiresAt).toISOString() }
  }

  exchange(code: string, browserNonce: string): PairingExchangeResult {
    const current = this.now().getTime()
    if (current < this.cooldownUntil) return { ok: false, code: 'PAIRING_RATE_LIMITED' }
    if (!this.pairingCode || this.pairingCode.used) return this.failAttempt('PAIRING_CODE_INVALID', current)
    if (current >= this.pairingCode.expiresAt) return { ok: false, code: 'PAIRING_CODE_EXPIRED' }
    if (!matches(this.pairingCode.hash, digest(code))) return this.failAttempt('PAIRING_CODE_INVALID', current)
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(browserNonce)) return this.failAttempt('PAIRING_CODE_INVALID', current)

    this.pairingCode.used = true
    this.failedAttempts = 0
    const sessionToken = token()
    const expiresAt = current + SESSION_TTL_MS
    this.sessions.set(sessionToken, { browserNonce, expiresAt })
    return { ok: true, token: sessionToken, expiresAt: new Date(expiresAt).toISOString() }
  }

  validate(sessionToken: string | undefined, browserNonce?: string): SessionValidationResult {
    if (!sessionToken) return { ok: false, code: 'SESSION_INVALID' }
    const session = this.sessions.get(sessionToken)
    if (!session) return { ok: false, code: 'SESSION_INVALID' }
    if (this.now().getTime() >= session.expiresAt) {
      this.sessions.delete(sessionToken)
      return { ok: false, code: 'SESSION_EXPIRED' }
    }
    if (browserNonce && browserNonce !== session.browserNonce) return { ok: false, code: 'SESSION_INVALID' }
    return { ok: true, browserNonce: session.browserNonce, expiresAt: new Date(session.expiresAt).toISOString() }
  }

  rotate(sessionToken: string | undefined, browserNonce?: string): PairingExchangeResult | SessionValidationResult {
    const validation = this.validate(sessionToken, browserNonce)
    if (!validation.ok) return validation
    this.sessions.delete(sessionToken!)
    const rotatedToken = token()
    const expiresAt = this.now().getTime() + SESSION_TTL_MS
    this.sessions.set(rotatedToken, { browserNonce: validation.browserNonce, expiresAt })
    return { ok: true, token: rotatedToken, expiresAt: new Date(expiresAt).toISOString() }
  }

  revoke(sessionToken: string | undefined): boolean {
    return sessionToken ? this.sessions.delete(sessionToken) : false
  }

  private failAttempt(code: 'PAIRING_CODE_INVALID', current: number): PairingExchangeResult {
    this.failedAttempts += 1
    if (this.failedAttempts >= MAX_FAILURES) {
      this.cooldownUntil = current + COOLDOWN_MS
      return { ok: false, code: 'PAIRING_RATE_LIMITED' }
    }
    return { ok: false, code }
  }
}
