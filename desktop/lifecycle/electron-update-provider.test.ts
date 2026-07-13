import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectronUpdateProvider, parseManifest, type ElectronUpdaterPort } from './electron-update-provider.js'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function manifest(override: Record<string, unknown> = {}) {
  return { schemaVersion: 1, channel: 'stable', version: '0.2.0', architecture: 'x64', minimumProtocol: '1.0.0', artifactUrl: 'https://updates.example/0.2.0.exe', sha256: 'a'.repeat(64), signatureVerified: true, permissionChanges: [], releaseNotes: 'Safe update', ...override }
}

function updater(path = 'C:\\cache\\update.exe'): ElectronUpdaterPort {
  return {
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } }),
    downloadUpdate: vi.fn().mockResolvedValue([path]), quitAndInstall: vi.fn(), on: vi.fn(), off: vi.fn(),
  } as unknown as ElectronUpdaterPort
}

describe('ElectronUpdateProvider', () => {
  it('binds a closed HTTPS feed and maps matching updater evidence', async () => {
    const port = updater()
    const provider = new ElectronUpdateProvider(port, { feedUrl: 'https://updates.example/windows', fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => manifest() }) as unknown as typeof fetch })
    await expect(provider.check(new AbortController().signal)).resolves.toMatchObject({ version: '0.2.0', signatureVerified: true })
    expect(port.setFeedURL).toHaveBeenCalledWith({ provider: 'generic', url: 'https://updates.example/windows/', channel: 'latest' })
    expect(port.autoDownload).toBe(false); expect(port.autoInstallOnAppQuit).toBe(false); expect(port.allowDowngrade).toBe(false)
  })

  it('rejects changed sidecar schema and metadata disagreement', async () => {
    expect(() => parseManifest(manifest({ schemaVersion: 2 }), 'stable')).toThrowError(expect.objectContaining({ code: 'UPDATE_MANIFEST_INVALID' }))
    const port = updater(); vi.mocked(port.checkForUpdates).mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '0.3.0' } } as never)
    const provider = new ElectronUpdateProvider(port, { feedUrl: 'https://updates.example/', fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => manifest() }) as unknown as typeof fetch })
    await expect(provider.check(new AbortController().signal)).rejects.toMatchObject({ code: 'UPDATE_MANIFEST_MISMATCH' })
  })

  it('downloads the checked installer and delegates activation explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-electron-update-')); roots.push(root)
    const path = join(root, 'update.exe'); const bytes = Buffer.from('fixture'); await writeFile(path, bytes)
    const port = updater(path)
    const provider = new ElectronUpdateProvider(port, { feedUrl: 'https://updates.example/', fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => manifest({ sha256: createHash('sha256').update(bytes).digest('hex') }) }) as unknown as typeof fetch })
    const release = await provider.check(new AbortController().signal)
    await expect(provider.download(release!, vi.fn(), new AbortController().signal)).resolves.toBe(path)
    await provider.activate(path)
    expect(port.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
