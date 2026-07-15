import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemorySecretStore } from '../auth/secret-store.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { RoutingIntegrationAuthService } from '../routing/integration-auth.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { ActivityCapabilityRegistry, manualActivityRegistration } from './capability-manifests.js'
import { IntegrationAuthService } from './integration-auth-service.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-activity-auth-')); cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'test.db'), backupBeforeMigration: false })
  const store = new MemorySecretStore()
  const operational = new OperationalRepository(database.db)
  const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational), Buffer.alloc(32, 3))
  const capabilities = new ActivityCapabilityRegistry(database.db)
  repository.registerIntegration(capabilities.registration('integration-codex-1', 'codex-cli', '0.144.3'))
  repository.registerIntegration(capabilities.registration('integration-codex-2', 'codex-cli', '0.144.3'))
  return { database, store, auth: new IntegrationAuthService(database.db, store), repository }
}

describe('IntegrationAuthService', () => {
  it('issues random per-integration credentials in the secret store and keeps SQLite reference-only', async () => {
    const { database, store, auth } = await fixture()
    const first = await auth.issue('integration-codex-1')
    const second = await auth.issue('integration-codex-2')
    const routing = await new RoutingIntegrationAuthService(store).ensure()

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
    expect(routing).not.toBe(first)
    expect(await auth.verify('integration-codex-1', first)).toBe(true)
    expect(await auth.verify('integration-codex-1', second)).toBe(false)
    expect(await auth.verify('integration-codex-2', first)).toBe(false)
    const rows = database.db.prepare('SELECT id,secret_ref FROM agent_activity_integrations ORDER BY id').all()
    expect(rows).toHaveLength(2)
    expect(rows).toEqual(expect.arrayContaining([
      { id: 'integration-codex-1', secret_ref: expect.stringMatching(/^agent-activity\.integration\.[a-f0-9]{32}\.token\.v1$/) },
      { id: 'integration-codex-2', secret_ref: expect.stringMatching(/^agent-activity\.integration\.[a-f0-9]{32}\.token\.v1$/) },
    ]))
    expect(new Set((rows as Array<{ secret_ref: string }>).map((row) => row.secret_ref)).size).toBe(2)
    expect(JSON.stringify(rows)).not.toContain(first)
    database.close()
  })

  it('revokes one integration independently and persists a stable private identity key outside SQLite', async () => {
    const { database, store, auth } = await fixture()
    const first = await auth.issue('integration-codex-1'); const second = await auth.issue('integration-codex-2')
    const identity = await auth.identityKey()
    const reopened = new IntegrationAuthService(database.db, store)
    expect((await reopened.identityKey()).equals(identity)).toBe(true)
    expect(identity).toHaveLength(32)

    await auth.revoke('integration-codex-1')
    expect(await auth.verify('integration-codex-1', first)).toBe(false)
    expect(await auth.verify('integration-codex-2', second)).toBe(true)
    expect(database.db.prepare('SELECT enabled,secret_ref FROM agent_activity_integrations WHERE id=?').get('integration-codex-1')).toEqual({ enabled: 0, secret_ref: null })
    expect(JSON.stringify(database.db.prepare('SELECT * FROM app_meta').all())).not.toContain(identity.toString('base64url'))
    database.close()
  })

  it('does not recreate or re-enable a revoked manual integration during restart ensure', async () => {
    const { database, auth, repository } = await fixture()
    repository.registerIntegration(manualActivityRegistration('manual:codex-cli', 'codex-cli'))
    await auth.ensure('manual:codex-cli')
    await auth.revoke('manual:codex-cli')
    await expect(auth.ensure('manual:codex-cli')).rejects.toThrow('ACTIVITY_INTEGRATION_NOT_ENABLED')
    expect(database.db.prepare('SELECT enabled,secret_ref FROM agent_activity_integrations WHERE id=?').get('manual:codex-cli')).toEqual({ enabled: 0, secret_ref: null })
    database.close()
  })
})
