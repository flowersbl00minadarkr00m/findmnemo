import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { SecretStore } from '../auth/secret-store.js'

const KEY = 'routing-integration-token-v1'
export type RoutingIntegrationScope = 'routing:dispatch' | 'routing:read' | 'routing:cancel'
const ALL_SCOPES: RoutingIntegrationScope[] = ['routing:dispatch', 'routing:read', 'routing:cancel']
interface StoredRoutingCredential { token: string; scopes: RoutingIntegrationScope[]; expiresAt: string }

export class RoutingIntegrationAuthService {
  private readonly store: SecretStore
  private readonly clock: () => Date
  constructor(store: SecretStore, clock: () => Date = () => new Date()) { this.store = store; this.clock = clock }

  async issue(scopes: RoutingIntegrationScope[] = ALL_SCOPES, ttlMs = 30 * 24 * 60 * 60_000): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    const record: StoredRoutingCredential = { token, scopes: [...new Set(scopes)], expiresAt: new Date(this.clock().getTime() + ttlMs).toISOString() }
    await this.store.set(KEY, JSON.stringify(record))
    return token
  }

  async ensure(): Promise<string> {
    const record = await this.read()
    return record && Date.parse(record.expiresAt) > this.clock().getTime() ? record.token : await this.issue()
  }

  async rotate(): Promise<string> { return await this.issue() }

  async verify(token: string | undefined, scope: RoutingIntegrationScope): Promise<boolean> {
    if (!['routing:dispatch', 'routing:read', 'routing:cancel'].includes(scope) || !token) return false
    const record = await this.read()
    if (!record || Date.parse(record.expiresAt) <= this.clock().getTime() || !record.scopes.includes(scope)) return false
    const expected = record.token
    const left = Buffer.from(token)
    const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
  }

  private async read(): Promise<StoredRoutingCredential | undefined> {
    const value = await this.store.get(KEY)
    if (!value) return undefined
    try {
      const parsed = JSON.parse(value) as Partial<StoredRoutingCredential>
      return typeof parsed.token === 'string' && Array.isArray(parsed.scopes) && typeof parsed.expiresAt === 'string' ? parsed as StoredRoutingCredential : undefined
    } catch { return undefined }
  }
}
