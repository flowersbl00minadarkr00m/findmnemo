import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SecretStore } from '../auth/secret-store.js'

const IDENTITY_KEY_REF = 'agent-activity.identity-key.v1'
const INTEGRATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

export class IntegrationAuthService {
  private readonly db: DatabaseSync
  private readonly store: SecretStore

  constructor(db: DatabaseSync, store: SecretStore) {
    this.db = db
    this.store = store
  }

  async issue(integrationId: string): Promise<string> {
    const secretRef = activityTokenReference(integrationId)
    const row = this.db.prepare('SELECT configured FROM agent_activity_integrations WHERE id=?').get(integrationId) as { configured?: number } | undefined
    if (!row?.configured) throw new Error('ACTIVITY_INTEGRATION_NOT_CONFIGURED')
    const token = randomBytes(32).toString('base64url')
    await this.store.set(secretRef, token)
    this.db.prepare('UPDATE agent_activity_integrations SET secret_ref=?,enabled=1,updated_at=? WHERE id=?').run(secretRef, new Date().toISOString(), integrationId)
    return token
  }

  async ensure(integrationId: string): Promise<string> {
    const secretRef = activityTokenReference(integrationId)
    const row = this.db.prepare('SELECT enabled,configured,secret_ref FROM agent_activity_integrations WHERE id=?').get(integrationId) as { enabled?: number; configured?: number; secret_ref?: string | null } | undefined
    if (!row?.configured) throw new Error('ACTIVITY_INTEGRATION_NOT_CONFIGURED')
    if (!row.enabled) throw new Error('ACTIVITY_INTEGRATION_NOT_ENABLED')
    if (row.secret_ref === secretRef) {
      const current = await this.store.get(secretRef)
      if (current) return current
    }
    return this.issue(integrationId)
  }

  async verify(integrationId: string, token: string | undefined): Promise<boolean> {
    if (!token || !INTEGRATION_ID.test(integrationId)) return false
    const row = this.db.prepare('SELECT enabled,configured,secret_ref FROM agent_activity_integrations WHERE id=?').get(integrationId) as Record<string, unknown> | undefined
    if (!row?.enabled || !row.configured || row.secret_ref !== activityTokenReference(integrationId)) return false
    const expected = await this.store.get(String(row.secret_ref))
    if (!expected) return false
    const left = Buffer.from(token); const right = Buffer.from(expected)
    return left.length === right.length && timingSafeEqual(left, right)
  }

  async revoke(integrationId: string): Promise<void> {
    const secretRef = activityTokenReference(integrationId)
    await this.store.delete(secretRef)
    this.db.prepare('UPDATE agent_activity_integrations SET secret_ref=NULL,enabled=0,updated_at=? WHERE id=?').run(new Date().toISOString(), integrationId)
  }

  async identityKey(): Promise<Buffer> {
    const current = await this.store.get(IDENTITY_KEY_REF)
    if (current && /^[A-Za-z0-9_-]{43}$/.test(current)) return Buffer.from(current, 'base64url')
    const created = randomBytes(32)
    await this.store.set(IDENTITY_KEY_REF, created.toString('base64url'))
    return created
  }
}

export function activityTokenReference(integrationId: string): string {
  if (!INTEGRATION_ID.test(integrationId)) throw new Error('ACTIVITY_INTEGRATION_ID_INVALID')
  const digest = createHash('sha256').update(integrationId, 'utf8').digest('hex').slice(0, 32)
  return `agent-activity.integration.${digest}.token.v1`
}
