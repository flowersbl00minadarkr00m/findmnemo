import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATABASE_SCHEMA_VERSION, openFindMnemoDatabase } from '../../server/db/database.js'
import { InstallEventCoordinator } from './install-events.js'
import { ExistingStateAdoptionService, type ListenerInspectorPort } from './migration-service.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
async function root() { const parent = await mkdtemp(join(tmpdir(), 'findmnemo-adopt-')); roots.push(parent); const value = join(parent, 'FindMnemo'); await mkdir(value); return value }
const listener = (state: 'none' | 'compatible' | 'unknown' = 'none'): ListenerInspectorPort => ({ inspect: vi.fn().mockResolvedValue(state) })

describe('ExistingStateAdoptionService', () => {
  it('adopts the canonical existing database in place and is idempotent', async () => {
    const dataRoot = await root(); const path = join(dataRoot, 'findmnemo.db')
    const database = await openFindMnemoDatabase({ path }); database.close()
    await mkdir(join(dataRoot, 'secrets')); await writeFile(join(dataRoot, 'secrets', 'gmail-refresh-token.dpapi'), 'encrypted-fixture')
    const service = new ExistingStateAdoptionService(dataRoot, listener(), () => new Date('2026-07-12T00:00:00.000Z'))
    await expect(service.inspect()).resolves.toMatchObject({ state: 'ready', databasePresent: true, schemaVersion: DATABASE_SCHEMA_VERSION, credentialPresent: true })
    await expect(service.adopt()).resolves.toMatchObject({ state: 'adopted', retainedLocation: '%LOCALAPPDATA%\\FindMnemo' })
    await expect(service.adopt()).resolves.toMatchObject({ state: 'already-adopted' })
  })

  it.each([['compatible', 'requires-stop', 'ADOPTION_COMPATIBLE_COMPANION_RUNNING'], ['unknown', 'blocked', 'ADOPTION_PORT_OWNER_UNKNOWN']] as const)('does not terminate %s listener ownership', async (listenerState, state, errorCode) => {
    const dataRoot = await root(); const database = await openFindMnemoDatabase({ path: join(dataRoot, 'findmnemo.db') }); database.close()
    await expect(new ExistingStateAdoptionService(dataRoot, listener(listenerState)).adopt()).resolves.toMatchObject({ state, errorCode })
  })

  it('blocks newer and corrupt databases without mutation', async () => {
    const newerRoot = await root(); const newerPath = join(newerRoot, 'findmnemo.db'); const newer = await openFindMnemoDatabase({ path: newerPath }); newer.db.prepare("UPDATE app_meta SET value='99' WHERE key='schema_version'").run(); newer.close()
    await expect(new ExistingStateAdoptionService(newerRoot, listener()).adopt()).resolves.toMatchObject({ state: 'blocked', errorCode: 'ADOPTION_DATABASE_NEWER' })
    const corruptRoot = await root(); await writeFile(join(corruptRoot, 'findmnemo.db'), 'not sqlite')
    await expect(new ExistingStateAdoptionService(corruptRoot, listener()).adopt()).resolves.toMatchObject({ state: 'blocked', errorCode: 'ADOPTION_DATABASE_CORRUPT' })
  })

  it('backs up and migrates an older database before recording adoption', async () => {
    const dataRoot = await root(); const path = join(dataRoot, 'findmnemo.db'); const db = new DatabaseSync(path); db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO app_meta VALUES('schema_version','0')"); db.close()
    const service = new ExistingStateAdoptionService(dataRoot, listener())
    await expect(service.adopt()).resolves.toMatchObject({ state: 'adopted', schemaVersion: DATABASE_SCHEMA_VERSION })
    await expect(writeFile(`${path}.pre-adoption.bak`, 'must already exist', { flag: 'wx' })).rejects.toMatchObject({ code: 'EEXIST' })
  })

  it('repairs application seams without deleting or moving operational data', async () => {
    const dataRoot = await root(); const database = await openFindMnemoDatabase({ path: join(dataRoot, 'findmnemo.db') }); database.close()
    const adoption = new ExistingStateAdoptionService(dataRoot, listener()); await adoption.adopt()
    const repair = { repairApplicationFiles: vi.fn(), repairLifecycleRegistration: vi.fn() }
    await expect(new InstallEventCoordinator(adoption, repair).repairPreservingData()).resolves.toMatchObject({ state: 'already-adopted', databasePresent: true })
    expect(repair.repairApplicationFiles).toHaveBeenCalledOnce(); expect(repair.repairLifecycleRegistration).toHaveBeenCalledOnce()
  })

  it('migrates the activity feature flag without losing enabled configuration and recovers interrupted snapshots safely', async () => {
    const dataRoot = await root(); const path = join(dataRoot, 'findmnemo.db')
    const current = await openFindMnemoDatabase({ path })
    current.db.prepare(`INSERT INTO agent_activity_integrations(id,agent_kind,adapter_version,installed_version,enabled,configured,support_level,freshness_profile,freshness_window_seconds,secret_ref,created_at,updated_at)
      VALUES('auto:codex-cli','codex-cli','1.0.0','0.144.3',1,1,'automatic-partial','hook-observed',900,'owned-ref','2026-07-14T00:00:00.000Z','2026-07-14T00:00:00.000Z')`).run()
    current.db.prepare(`INSERT INTO agent_activity_snapshots(request_id,integration_id,mode,requested_at,state)
      VALUES('interrupted','auto:codex-cli','current-session','2026-07-14T00:00:00.000Z','requested')`).run()
    current.db.exec('DROP TABLE agent_activity_runtime; DROP INDEX IF EXISTS agent_assignment_events_retention_idx')
    current.db.prepare("UPDATE app_meta SET value='11' WHERE key='schema_version'").run(); current.close()

    const migrated = await openFindMnemoDatabase({ path })
    expect(migrated.db.prepare('SELECT capture_enabled,rollout_state FROM agent_activity_runtime WHERE singleton_id=1').get()).toEqual({ capture_enabled: 1, rollout_state: 'enabled' })
    expect(migrated.db.prepare("SELECT enabled,configured,secret_ref FROM agent_activity_integrations WHERE id='auto:codex-cli'").get()).toEqual({ enabled: 1, configured: 1, secret_ref: 'owned-ref' })
    expect(migrated.db.prepare("SELECT state,failure_code FROM agent_activity_snapshots WHERE request_id='interrupted'").get()).toEqual({ state: 'failed', failure_code: 'SNAPSHOT_INTERRUPTED' })
    migrated.close()
  })
})
