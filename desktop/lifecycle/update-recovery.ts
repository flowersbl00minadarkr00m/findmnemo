import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface UpdateRecoveryRecord {
  schema: 'findmnemo.update-recovery.v1'
  state: 'activation-pending' | 'healthy' | 'recovery-required'
  previousVersion: string
  targetVersion: string
  databaseSchemaVersion: number
  previousRuntimeMaxSchemaVersion: number
  previousInstallerPath?: string
  updatedAt: string
}

export class UpdateRecoveryStore {
  constructor(readonly path: string, readonly clock: () => Date = () => new Date()) {}
  async prepare(input: Omit<UpdateRecoveryRecord, 'schema' | 'state' | 'updatedAt'>): Promise<UpdateRecoveryRecord> {
    return this.#save({ schema: 'findmnemo.update-recovery.v1', state: 'activation-pending', ...input, updatedAt: this.clock().toISOString() })
  }
  async reconcileAfterHealth(currentVersion: string): Promise<UpdateRecoveryRecord | undefined> {
    const record = await this.read()
    if (!record || record.state !== 'activation-pending') return record
    return this.#save({ ...record, state: currentVersion === record.targetVersion ? 'healthy' : 'recovery-required', updatedAt: this.clock().toISOString() })
  }
  async read(): Promise<UpdateRecoveryRecord | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as UpdateRecoveryRecord
      return value.schema === 'findmnemo.update-recovery.v1' && ['activation-pending', 'healthy', 'recovery-required'].includes(value.state) && typeof value.previousVersion === 'string' && typeof value.targetVersion === 'string' && Number.isInteger(value.databaseSchemaVersion) && Number.isInteger(value.previousRuntimeMaxSchemaVersion) ? value : undefined
    } catch (cause) { if (isMissing(cause)) return undefined; throw cause }
  }
  rollbackState(record: UpdateRecoveryRecord): 'available' | 'installer-unavailable' | 'schema-unsupported' {
    if (!record.previousInstallerPath) return 'installer-unavailable'
    return record.databaseSchemaVersion <= record.previousRuntimeMaxSchemaVersion ? 'available' : 'schema-unsupported'
  }
  async #save(record: UpdateRecoveryRecord): Promise<UpdateRecoveryRecord> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.path)
    return record
  }
}
function isMissing(cause: unknown): boolean { return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT' }
