import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { COMPANION_PROTOCOL_VERSION, type CompanionIdentityDto } from '../../shared/companion-contract.js'
import type { AdoptionSnapshot } from '../../shared/lifecycle-contract.js'
import { DATABASE_SCHEMA_VERSION, openFindMnemoDatabase } from '../../server/db/database.js'

export type ListenerAdoptionState = 'none' | 'compatible' | 'unknown'
export interface ListenerInspectorPort { inspect(): Promise<ListenerAdoptionState> }
interface AdoptionReceipt { schema: 'findmnemo.adoption.v1'; completedAt: string; databasePresent: boolean; schemaVersion?: number; credentialPresent: boolean }

export class ExistingStateAdoptionService {
  readonly #databasePath: string
  readonly #receiptPath: string
  constructor(readonly dataRoot: string, readonly listener: ListenerInspectorPort, readonly clock: () => Date = () => new Date()) {
    if (normalize(dataRoot).split(/[\\/]/).at(-1)?.toLowerCase() !== 'findmnemo') throw coded('ADOPTION_PATH_UNSAFE', 'Adoption root must be the FindMnemo data directory.')
    this.#databasePath = join(dataRoot, 'findmnemo.db')
    this.#receiptPath = join(dataRoot, 'adoption.json')
  }

  async inspect(ignoreOwnedListener = false): Promise<AdoptionSnapshot> {
    const listener = ignoreOwnedListener ? 'none' : await this.listener.inspect()
    const credentialPresent = await exists(join(this.dataRoot, 'secrets', 'gmail-refresh-token.dpapi'))
    const lifecycleSettingsPresent = await exists(join(this.dataRoot, 'lifecycle.json'))
    const databasePresent = await exists(this.#databasePath)
    const base = { databasePresent, credentialPresent, lifecycleSettingsPresent, listener, backupRequired: false, retainedLocation: '%LOCALAPPDATA%\\FindMnemo' as const }
    if (await this.#readReceipt()) return { ...base, state: 'already-adopted' }
    if (!databasePresent) return { ...base, state: listener === 'unknown' ? 'blocked' : 'fresh', errorCode: listener === 'unknown' ? 'ADOPTION_PORT_OWNER_UNKNOWN' : undefined }
    const database = inspectDatabase(this.#databasePath)
    if (!database.ok) return { ...base, state: 'blocked', schemaVersion: database.schemaVersion, errorCode: database.errorCode }
    if (listener === 'unknown') return { ...base, state: 'blocked', schemaVersion: database.schemaVersion, errorCode: 'ADOPTION_PORT_OWNER_UNKNOWN' }
    if (listener === 'compatible') return { ...base, state: 'requires-stop', schemaVersion: database.schemaVersion, backupRequired: database.schemaVersion < DATABASE_SCHEMA_VERSION, errorCode: 'ADOPTION_COMPATIBLE_COMPANION_RUNNING' }
    return { ...base, state: 'ready', schemaVersion: database.schemaVersion, backupRequired: database.schemaVersion < DATABASE_SCHEMA_VERSION }
  }

  async adopt(): Promise<AdoptionSnapshot> {
    const current = await this.inspect()
    if (current.state === 'already-adopted') return current
    if (!['ready', 'fresh'].includes(current.state)) return current
    if (current.databasePresent && current.backupRequired) {
      await copyFile(this.#databasePath, `${this.#databasePath}.pre-adoption.bak`)
      const database = await openFindMnemoDatabase({ path: this.#databasePath, backupBeforeMigration: false })
      database.close()
    }
    const receipt: AdoptionReceipt = {
      schema: 'findmnemo.adoption.v1', completedAt: this.clock().toISOString(), databasePresent: current.databasePresent,
      schemaVersion: current.databasePresent ? DATABASE_SCHEMA_VERSION : undefined, credentialPresent: current.credentialPresent,
    }
    await mkdir(this.dataRoot, { recursive: true })
    const temporary = `${this.#receiptPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.#receiptPath)
    return { ...current, state: 'adopted', schemaVersion: receipt.schemaVersion, backupRequired: false }
  }

  async #readReceipt(): Promise<AdoptionReceipt | undefined> {
    try {
      const value = JSON.parse(await readFile(this.#receiptPath, 'utf8')) as Partial<AdoptionReceipt>
      return value.schema === 'findmnemo.adoption.v1' && typeof value.completedAt === 'string' && typeof value.databasePresent === 'boolean' && typeof value.credentialPresent === 'boolean' ? value as AdoptionReceipt : undefined
    } catch (cause) { if (isMissing(cause)) return undefined; throw cause }
  }
}

export class LoopbackCompanionInspector implements ListenerInspectorPort {
  constructor(readonly request: typeof fetch = fetch) {}
  async inspect(): Promise<ListenerAdoptionState> {
    try {
      const response = await this.request('http://127.0.0.1:3210/api/v1/identity', { signal: AbortSignal.timeout(1_500), headers: { origin: 'http://127.0.0.1:3210', 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION } })
      if (!response.ok) return 'unknown'
      const envelope = await response.json() as { data?: CompanionIdentityDto }
      return envelope.data?.protocolVersion === COMPANION_PROTOCOL_VERSION ? 'compatible' : 'unknown'
    } catch (cause) {
      return isConnectionRefused(cause) ? 'none' : 'unknown'
    }
  }
}

function inspectDatabase(path: string): { ok: true; schemaVersion: number } | { ok: false; schemaVersion?: number; errorCode: string } {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(path, { readOnly: true })
    const integrity = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
    if (!Object.values(integrity).includes('ok')) return { ok: false, errorCode: 'ADOPTION_DATABASE_CORRUPT' }
    const hasMeta = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'").get()
    const row = hasMeta ? database.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get() as { value?: string } | undefined : undefined
    const schemaVersion = Number(row?.value ?? 0)
    if (!Number.isInteger(schemaVersion) || schemaVersion < 0) return { ok: false, errorCode: 'ADOPTION_DATABASE_CORRUPT' }
    if (schemaVersion > DATABASE_SCHEMA_VERSION) return { ok: false, schemaVersion, errorCode: 'ADOPTION_DATABASE_NEWER' }
    return { ok: true, schemaVersion }
  } catch { return { ok: false, errorCode: 'ADOPTION_DATABASE_CORRUPT' } }
  finally { database?.close() }
}

async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch (cause) { if (isMissing(cause)) return false; throw cause } }
function isMissing(cause: unknown): boolean { return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT' }
function isConnectionRefused(cause: unknown): boolean { return cause instanceof TypeError && typeof cause.cause === 'object' && cause.cause !== null && 'code' in cause.cause && cause.cause.code === 'ECONNREFUSED' }
function coded(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }
