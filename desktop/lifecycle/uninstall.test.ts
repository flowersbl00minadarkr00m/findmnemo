import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UninstallService } from './uninstall.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
async function setup(now = new Date('2026-07-12T00:00:00.000Z')) {
  const localAppData = await mkdtemp(join(tmpdir(), 'findmnemo-uninstall-')); roots.push(localAppData)
  const dataRoot = join(localAppData, 'FindMnemo'); await mkdir(join(dataRoot, 'updates'), { recursive: true }); await writeFile(join(dataRoot, 'findmnemo.db'), 'fixture'); await writeFile(join(dataRoot, 'updates', 'pending'), 'fixture')
  let credential = true
  const credentials = { hasCredential: vi.fn(async () => credential), deleteCredential: vi.fn(async () => { credential = false }) }
  const lifecycle = { stopCompanion: vi.fn(), removeLifecycleIntegrations: vi.fn() }
  return { service: new UninstallService(localAppData, credentials, () => now), lifecycle, dataRoot, credentials }
}

describe('UninstallService', () => {
  it('uses preserve fallback for direct Windows uninstall with no plan', async () => {
    const { service, lifecycle, dataRoot, credentials } = await setup()
    await expect(service.execute(undefined, lifecycle)).resolves.toMatchObject({ completed: true, planApplied: 'preserve-fallback', dataDeleted: false })
    await expect(readFile(join(dataRoot, 'findmnemo.db'), 'utf8')).resolves.toBe('fixture')
    expect(credentials.deleteCredential).not.toHaveBeenCalled(); expect(lifecycle.removeLifecycleIntegrations).toHaveBeenCalledOnce()
  })

  it('requires a distinct second confirmation before full deletion', async () => {
    const { service } = await setup()
    await expect(service.prepare('delete-all-data')).resolves.toMatchObject({ planId: '', secondConfirmationRequired: true })
  })

  it('removes only credentials while retaining operational data', async () => {
    const { service, lifecycle, dataRoot } = await setup(); const plan = await service.prepare('remove-credentials')
    await expect(service.execute(plan.planId, lifecycle)).resolves.toMatchObject({ completed: true, planApplied: 'remove-credentials', credentialsRemoved: true, dataDeleted: false })
    await expect(readFile(join(dataRoot, 'findmnemo.db'), 'utf8')).resolves.toBe('fixture')
  })

  it('deletes only the verified FindMnemo root after confirmed full deletion', async () => {
    const { service, lifecycle, dataRoot } = await setup(); const plan = await service.prepare('delete-all-data', true)
    await expect(service.execute(plan.planId, lifecycle)).resolves.toMatchObject({ completed: true, planApplied: 'delete-all-data', dataDeleted: true })
    await expect(readFile(join(dataRoot, 'findmnemo.db'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('falls back to preserve for tampered, expired, or replayed plans', async () => {
    const { service, lifecycle, dataRoot } = await setup(); const plan = await service.prepare('delete-all-data', true)
    const path = join(dataRoot, 'uninstall-plan.json'); const tampered = JSON.parse(await readFile(path, 'utf8')); tampered.choice = 'preserve-data'; await writeFile(path, JSON.stringify(tampered))
    await expect(service.execute(plan.planId, lifecycle)).resolves.toMatchObject({ planApplied: 'preserve-fallback', dataDeleted: false })
    const valid = await service.prepare('preserve-data'); await service.execute(valid.planId, lifecycle)
    await expect(service.execute(valid.planId, lifecycle)).resolves.toMatchObject({ planApplied: 'preserve-fallback' })
  })
})
