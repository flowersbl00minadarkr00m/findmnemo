import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateCoordinator, type UpdateProviderPort, type UpdateRelease } from './update-service.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function setup(overrides: Partial<UpdateRelease> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-update-')); roots.push(root)
  const path = join(root, 'update.exe'); const bytes = Buffer.from('signed fixture'); await writeFile(path, bytes)
  const release: UpdateRelease = { version: '0.2.0', architecture: 'x64', minimumProtocol: '1.0.0', artifactUrl: 'https://updates.example/0.2.0.exe', sha256: createHash('sha256').update(bytes).digest('hex'), signatureVerified: true, permissionChanges: [], releaseNotes: 'Security update', ...overrides }
  const provider: UpdateProviderPort = { check: vi.fn().mockResolvedValue(release), download: vi.fn().mockImplementation(async (_release, progress) => { progress(50); return path }), activate: vi.fn().mockResolvedValue(undefined) }
  return { coordinator: new UpdateCoordinator(provider, { currentVersion: '0.1.0', protocolVersion: '1.0.0' }), provider }
}

describe('UpdateCoordinator', () => {
  it('checks, downloads, verifies, and activates only after explicit call', async () => {
    const { coordinator, provider } = await setup({ permissionChanges: ['New local source permission'] })
    expect(await coordinator.check()).toMatchObject({ state: 'available', targetVersion: '0.2.0', permissionChanges: ['New local source permission'] })
    expect(provider.activate).not.toHaveBeenCalled()
    expect(await coordinator.download()).toMatchObject({ state: 'ready', progress: 100 })
    const quiesce = vi.fn(); const backup = vi.fn()
    expect(await coordinator.activate(quiesce, backup)).toMatchObject({ state: 'activating' })
    expect(quiesce).toHaveBeenCalledBefore(backup)
    expect(provider.activate).toHaveBeenCalledOnce()
  })

  it.each([
    [{ architecture: 'arm64' as never }, 'UPDATE_ARCHITECTURE_UNSUPPORTED'],
    [{ artifactUrl: 'http://unsafe.example/update.exe' }, 'UPDATE_MANIFEST_INVALID'],
    [{ signatureVerified: false }, 'UPDATE_SIGNATURE_INVALID'],
    [{ sha256: '0'.repeat(64) }, 'UPDATE_HASH_MISMATCH'],
  ])('fails closed for unsafe release evidence', async (overrides, code) => {
    const { coordinator, provider } = await setup(overrides)
    const checked = await coordinator.check()
    if (checked.state === 'available') await coordinator.download()
    expect(coordinator.snapshot()).toMatchObject({ state: 'failed', errorCode: code })
    expect(provider.activate).not.toHaveBeenCalled()
  })
})
