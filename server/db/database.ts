import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PlatformPathError, resolvePlatformPaths, type ResolvePlatformPathsInput } from '../platform/platform-paths.js'

export const DATABASE_SCHEMA_VERSION = 5

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL, origin TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE TABLE IF NOT EXISTS ticket_source_links (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, external_id TEXT NOT NULL, provenance_ref TEXT NOT NULL,
  UNIQUE(source_id, external_id)
);
CREATE TABLE IF NOT EXISTS email_threads (
  account_id TEXT NOT NULL, thread_id TEXT NOT NULL, latest_message_id TEXT NOT NULL,
  sender TEXT NOT NULL, subject TEXT NOT NULL, received_at TEXT NOT NULL,
  snippet TEXT NOT NULL CHECK(length(snippet) <= 240), reason_codes_json TEXT NOT NULL,
  triage_state TEXT NOT NULL, record_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, thread_id)
);
CREATE TABLE IF NOT EXISTS email_ticket_links (
  account_id TEXT NOT NULL, thread_id TEXT NOT NULL, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  provenance_ref TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(account_id, thread_id),
  FOREIGN KEY(account_id, thread_id) REFERENCES email_threads(account_id, thread_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS configured_sources (
  source_id TEXT PRIMARY KEY, adapter_kind TEXT NOT NULL, adapter_version TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), policy TEXT NOT NULL,
  location_label TEXT, config_json TEXT NOT NULL DEFAULT '{}',
  last_attempt_at TEXT, last_success_at TEXT
);
CREATE TABLE IF NOT EXISTS source_records (
  source_id TEXT NOT NULL, external_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  state TEXT NOT NULL, observed_at TEXT NOT NULL, provenance_ref TEXT NOT NULL,
  eligible_for_ticket INTEGER NOT NULL CHECK(eligible_for_ticket IN (0,1)), exclusion_reason TEXT,
  PRIMARY KEY(source_id, external_id)
);
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL,
  requested_source_ids_json TEXT NOT NULL, counts_json TEXT NOT NULL DEFAULT '{}', initiating_surface TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reconciliation_sources (
  run_id TEXT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, state TEXT NOT NULL, counts_json TEXT NOT NULL DEFAULT '{}', error_code TEXT,
  PRIMARY KEY(run_id, source_id)
);
CREATE TABLE IF NOT EXISTS reconciliation_items (
  run_id TEXT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, external_id TEXT NOT NULL, classification TEXT NOT NULL,
  ticket_id TEXT, reason_code TEXT, error_code TEXT,
  PRIMARY KEY(run_id, source_id, external_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, action TEXT NOT NULL, reason_code TEXT,
  object_refs_json TEXT NOT NULL, result TEXT NOT NULL
);
INSERT OR REPLACE INTO app_meta(key, value) VALUES ('schema_version', '1');
`

const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS idempotency_results (
  idempotency_key TEXT PRIMARY KEY, action TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
UPDATE app_meta SET value='2' WHERE key='schema_version';
`

const MIGRATION_003 = `
CREATE TABLE IF NOT EXISTS gmail_checks (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL,
  coverage_start TEXT NOT NULL, coverage_end TEXT NOT NULL, counts_json TEXT NOT NULL,
  failed_thread_ids_json TEXT NOT NULL DEFAULT '[]', history_id TEXT, error_code TEXT
);
UPDATE app_meta SET value='3' WHERE key='schema_version';
`

const MIGRATION_004 = `
CREATE TABLE IF NOT EXISTS routing_policy (
  singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
  schema_version TEXT NOT NULL, policy_profile TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK(policy_version >= 0), updated_at TEXT NOT NULL,
  capabilities_json TEXT NOT NULL, default_order_json TEXT NOT NULL, overrides_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS routing_profiles (
  profile_id TEXT PRIMARY KEY, policy_version INTEGER NOT NULL,
  display_name TEXT NOT NULL, destination_adapter_id TEXT NOT NULL, destination_instance_id TEXT NOT NULL,
  provider_id TEXT, model_id TEXT NOT NULL, effort TEXT,
  capability_ids_json TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  behavior TEXT NOT NULL, fallback_order INTEGER NOT NULL,
  readiness_state TEXT NOT NULL, readiness_checked_at TEXT, readiness_expires_at TEXT,
  adapter_version TEXT, installed_version TEXT, readiness_reason_code TEXT
);
CREATE TABLE IF NOT EXISTS routing_policy_migrations (
  source_policy_revision TEXT PRIMARY KEY, policy_version INTEGER NOT NULL,
  result_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS routing_dispatch_receipts (
  id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL DEFAULT 1,
  prior_receipt_id TEXT, origin_adapter_id TEXT NOT NULL, correlation_id TEXT NOT NULL,
  conversation_ref_hash TEXT, capability_ids_json TEXT NOT NULL, classification_source TEXT NOT NULL,
  policy_version INTEGER NOT NULL, requested_profile_json TEXT NOT NULL, actual_route_json TEXT,
  state TEXT NOT NULL, return_state TEXT NOT NULL, created_at TEXT NOT NULL,
  accepted_at TEXT, started_at TEXT, finished_at TEXT, failure_code TEXT,
  request_hash TEXT NOT NULL, result_hash TEXT,
  FOREIGN KEY(prior_receipt_id) REFERENCES routing_dispatch_receipts(id)
);
UPDATE app_meta SET value='4' WHERE key='schema_version';
`

const MIGRATION_005 = `
CREATE TABLE IF NOT EXISTS routing_model_catalogs (
  adapter_id TEXT PRIMARY KEY, adapter_version TEXT NOT NULL, installed_version TEXT NOT NULL,
  checked_at TEXT NOT NULL, expires_at TEXT NOT NULL, models_json TEXT NOT NULL
);
UPDATE app_meta SET value='5' WHERE key='schema_version';
`

export interface OpenDatabaseOptions {
  path?: string
  localAppData?: string
  platformPaths?: ResolvePlatformPathsInput
  backupBeforeMigration?: boolean
}

export interface FindMnemoDatabase {
  db: DatabaseSync
  path: string
  close: () => void
  transaction: <T>(work: () => T) => T
}

export function defaultDatabasePath(localAppData = process.env.LOCALAPPDATA): string {
  return resolvePlatformPaths({ platform: 'win32', env: { LOCALAPPDATA: localAppData } }).databasePath
}

export async function openFindMnemoDatabase(options: OpenDatabaseOptions = {}): Promise<FindMnemoDatabase> {
  if (options.path !== undefined && !isAbsolute(options.path)) {
    throw new PlatformPathError('DATA_ROOT_UNAVAILABLE', 'The explicit database path must be absolute.')
  }
  const path = options.path ?? (options.localAppData
    ? defaultDatabasePath(options.localAppData)
    : resolvePlatformPaths(options.platformPaths).databasePath)
  await mkdir(dirname(path), { recursive: true })
  const existed = existsSync(path)
  if (existed && options.backupBeforeMigration !== false) await copyFile(path, `${path}.pre-migration.bak`)

  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    if (existed) {
      const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
      if (!Object.values(integrity).includes('ok')) throw new Error('Database integrity check failed; migrations were not applied.')
    }
    const currentVersion = readSchemaVersion(db)
    if (currentVersion > DATABASE_SCHEMA_VERSION) throw new Error(`Database schema ${currentVersion} is newer than supported schema ${DATABASE_SCHEMA_VERSION}.`)
    if (currentVersion < 1) runTransaction(db, () => db.exec(MIGRATION_001))
    if (currentVersion < 2) runTransaction(db, () => db.exec(MIGRATION_002))
    if (currentVersion < 3) runTransaction(db, () => db.exec(MIGRATION_003))
    if (currentVersion < 4) runTransaction(db, () => db.exec(MIGRATION_004))
    if (currentVersion < 5) runTransaction(db, () => db.exec(MIGRATION_005))
    recoverInterruptedRuns(db)
  } catch (cause) {
    db.close()
    throw cause
  }

  return {
    db,
    path,
    close: () => db.close(),
    transaction: <T>(work: () => T) => runTransaction(db, work),
  }
}

function readSchemaVersion(db: DatabaseSync): number {
  const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'").get()
  if (!hasMeta) return 0
  const row = db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get() as { value?: string } | undefined
  return Number(row?.value ?? 0)
}

function recoverInterruptedRuns(db: DatabaseSync): void {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reconciliation_runs'").get()) return
  db.prepare("UPDATE reconciliation_runs SET state='failed', finished_at=COALESCE(finished_at, datetime('now')) WHERE state IN ('queued','running')").run()
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_checks'").get()) {
    db.prepare("UPDATE gmail_checks SET state='failed',error_code='SOURCE_CHECK_FAILED',finished_at=COALESCE(finished_at,datetime('now')) WHERE state='running'").run()
  }
}

function runTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (cause) {
    db.exec('ROLLBACK')
    throw cause
  }
}

export function ensureDatabaseDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}
