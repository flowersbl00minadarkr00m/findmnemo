import type { AgentKind } from '../../shared/agent-activity-contract.js'
import type { SecretStore } from '../auth/secret-store.js'
import type { FindMnemoDatabase } from '../db/database.js'
import type { IntegrationAuthService } from './integration-auth-service.js'
import { RetrySpool } from './reporter/retry-spool.js'

export interface ActivityOwnedSetupRemovalPort { remove(agent: AgentKind): Promise<boolean> }

interface RolloutDependencies {
  database: FindMnemoDatabase
  auth: IntegrationAuthService
  store: SecretStore
  setup?: ActivityOwnedSetupRemovalPort
  clock?: () => Date
}

export interface ActivityRollbackResult {
  captureEnabled: false
  integrationsDisabled: number
  setupFailures: number
  credentialFailures: number
  completedAt: string
}

export class AgentActivityRolloutService {
  private readonly dependencies: RolloutDependencies
  private readonly clock: () => Date

  constructor(dependencies: RolloutDependencies) { this.dependencies = dependencies; this.clock = dependencies.clock ?? (() => new Date()) }

  isEnabled(): boolean {
    return Boolean((this.dependencies.database.db.prepare('SELECT capture_enabled FROM agent_activity_runtime WHERE singleton_id=1').get() as { capture_enabled?: number } | undefined)?.capture_enabled)
  }

  enable(): void {
    const now = this.clock().toISOString()
    this.dependencies.database.transaction(() => {
      this.dependencies.database.db.prepare("UPDATE agent_activity_runtime SET capture_enabled=1,rollout_state='enabled',updated_at=? WHERE singleton_id=1").run(now)
      this.dependencies.database.db.prepare("UPDATE configured_sources SET enabled=1,last_attempt_at=? WHERE source_id='agent-activity'").run(now)
    })
  }

  async rollback(confirmed: boolean): Promise<ActivityRollbackResult> {
    if (confirmed !== true) throw new Error('LOCAL_CONFIRMATION_REQUIRED')
    const now = this.clock().toISOString()
    const rows = this.dependencies.database.db.prepare('SELECT id,agent_kind,configured FROM agent_activity_integrations ORDER BY id').all() as Array<Record<string, unknown>>
    this.dependencies.database.transaction(() => {
      this.dependencies.database.db.prepare("UPDATE agent_activity_runtime SET capture_enabled=0,rollout_state='rolling-back',updated_at=? WHERE singleton_id=1").run(now)
      this.dependencies.database.db.prepare('UPDATE agent_activity_integrations SET enabled=0,retained_last_success=CASE WHEN last_success_at IS NULL THEN retained_last_success ELSE 1 END,updated_at=?').run(now)
      this.dependencies.database.db.prepare("UPDATE configured_sources SET enabled=0,last_attempt_at=? WHERE source_id='agent-activity'").run(now)
    })

    let setupFailures = 0; let credentialFailures = 0
    for (const row of rows) {
      const integrationId = String(row.id); const automatic = integrationId.startsWith('auto:')
      let setupRemoved = !automatic || !row.configured
      if (automatic && row.configured && this.dependencies.setup) {
        try { setupRemoved = await this.dependencies.setup.remove(String(row.agent_kind) as AgentKind) }
        catch { setupRemoved = false }
      }
      if (!setupRemoved) setupFailures += 1
      try { await this.dependencies.auth.revoke(integrationId); await new RetrySpool({ store: this.dependencies.store, integrationId }).clear() }
      catch { credentialFailures += 1 }
      this.dependencies.database.db.prepare(`UPDATE agent_activity_integrations SET configured=?,enabled=0,last_failure_code=?,updated_at=? WHERE id=?`)
        .run(setupRemoved ? 0 : Number(Boolean(row.configured)), setupRemoved ? null : 'ACTIVITY_ROLLBACK_SETUP_FAILED', now, integrationId)
    }
    this.dependencies.database.db.prepare("UPDATE agent_activity_runtime SET rollout_state='disabled',updated_at=? WHERE singleton_id=1").run(now)
    return { captureEnabled: false, integrationsDisabled: rows.length, setupFailures, credentialFailures, completedAt: now }
  }
}
