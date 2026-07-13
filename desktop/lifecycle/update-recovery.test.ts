import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UpdateRecoveryStore } from './update-recovery.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
async function store() { const root = await mkdtemp(join(tmpdir(), 'findmnemo-recovery-')); roots.push(root); return new UpdateRecoveryStore(join(root, 'recovery.json'), () => new Date('2026-07-12T00:00:00.000Z')) }

describe('UpdateRecoveryStore', () => {
  it('records activation before restart and accepts the target only after health', async () => {
    const value = await store(); await value.prepare({ previousVersion: '0.1.0', targetVersion: '0.2.0', databaseSchemaVersion: 3, previousRuntimeMaxSchemaVersion: 3 })
    await expect(value.reconcileAfterHealth('0.2.0')).resolves.toMatchObject({ state: 'healthy' })
  })
  it('requires visible recovery when restart remains on the old runtime', async () => {
    const value = await store(); await value.prepare({ previousVersion: '0.1.0', targetVersion: '0.2.0', databaseSchemaVersion: 3, previousRuntimeMaxSchemaVersion: 3 })
    await expect(value.reconcileAfterHealth('0.1.0')).resolves.toMatchObject({ state: 'recovery-required' })
  })
  it('refuses rollback without a cached signed installer or across an unsupported schema', async () => {
    const value = await store(); const missing = await value.prepare({ previousVersion: '0.1.0', targetVersion: '0.2.0', databaseSchemaVersion: 3, previousRuntimeMaxSchemaVersion: 3 })
    expect(value.rollbackState(missing)).toBe('installer-unavailable')
    expect(value.rollbackState({ ...missing, previousInstallerPath: 'signed.exe', databaseSchemaVersion: 4 })).toBe('schema-unsupported')
    expect(value.rollbackState({ ...missing, previousInstallerPath: 'signed.exe' })).toBe('available')
  })
})
