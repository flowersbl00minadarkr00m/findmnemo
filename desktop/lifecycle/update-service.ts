import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export interface UpdateRelease {
  version: string
  architecture: 'x64'
  minimumProtocol: string
  artifactUrl: string
  sha256: string
  signatureVerified: boolean
  permissionChanges: readonly string[]
  releaseNotes: string
}

export interface UpdateProviderPort {
  check(signal: AbortSignal): Promise<UpdateRelease | undefined>
  download(release: UpdateRelease, onProgress: (progress: number) => void, signal: AbortSignal): Promise<string>
  activate(path: string): Promise<void>
}

export interface UpdateSnapshot {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'activating' | 'failed'
  targetVersion?: string
  progress?: number
  errorCode?: string
  permissionChanges?: readonly string[]
  releaseNotes?: string
}

export class UpdateCoordinator {
  #snapshot: UpdateSnapshot = { state: 'idle' }
  #release?: UpdateRelease
  #downloadPath?: string
  #downloadAbort?: AbortController
  #listeners = new Set<(snapshot: UpdateSnapshot) => void>()
  constructor(readonly provider: UpdateProviderPort, readonly options: { currentVersion: string; protocolVersion: string; timeoutMs?: number }) {}

  snapshot(): UpdateSnapshot { return structuredClone(this.#snapshot) }
  subscribe(listener: (snapshot: UpdateSnapshot) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }

  async check(): Promise<UpdateSnapshot> {
    this.#set({ state: 'checking' })
    const controller = AbortSignal.timeout(this.options.timeoutMs ?? 15_000)
    try {
      const release = await this.provider.check(controller)
      if (!release || compareVersions(release.version, this.options.currentVersion) <= 0) return this.#set({ state: 'idle' })
      validateRelease(release, this.options)
      this.#release = release
      return this.#set({ state: 'available', targetVersion: release.version, permissionChanges: release.permissionChanges, releaseNotes: release.releaseNotes })
    } catch (cause) {
      return this.#set({ state: 'failed', errorCode: readCode(cause, 'UPDATE_CHECK_FAILED') })
    }
  }

  async download(): Promise<UpdateSnapshot> {
    if (!this.#release || this.#snapshot.state !== 'available') return this.#set({ ...this.#snapshot, state: 'failed', errorCode: 'UPDATE_NOT_AVAILABLE' })
    this.#set({ ...this.#snapshot, state: 'downloading', progress: 0 })
    this.#downloadAbort = new AbortController()
    const timeout = setTimeout(() => this.#downloadAbort?.abort(), this.options.timeoutMs ?? 5 * 60_000)
    try {
      const path = await this.provider.download(this.#release, (progress) => { this.#set({ ...this.#snapshot, progress: Math.max(0, Math.min(100, progress)) }) }, this.#downloadAbort.signal)
      const digest = createHash('sha256').update(await readFile(path)).digest('hex')
      if (digest !== this.#release.sha256) throw Object.assign(new Error('Downloaded update hash does not match.'), { code: 'UPDATE_HASH_MISMATCH' })
      if (!this.#release.signatureVerified) throw Object.assign(new Error('Update signature is not verified.'), { code: 'UPDATE_SIGNATURE_INVALID' })
      this.#downloadPath = path
      return this.#set({ ...this.#snapshot, state: 'ready', progress: 100 })
    } catch (cause) {
      const code = this.#downloadAbort.signal.aborted ? 'UPDATE_DOWNLOAD_CANCELLED' : readCode(cause, 'UPDATE_DOWNLOAD_FAILED')
      return this.#set({ ...this.#snapshot, state: code === 'UPDATE_DOWNLOAD_CANCELLED' ? 'available' : 'failed', errorCode: code })
    } finally {
      clearTimeout(timeout)
      this.#downloadAbort = undefined
    }
  }

  cancelDownload(): UpdateSnapshot {
    this.#downloadAbort?.abort()
    return this.snapshot()
  }

  async activate(quiesce: () => Promise<void>, backup: () => Promise<void>): Promise<UpdateSnapshot> {
    if (!this.#downloadPath || this.#snapshot.state !== 'ready') return this.#set({ ...this.#snapshot, state: 'failed', errorCode: 'UPDATE_NOT_READY' })
    this.#set({ ...this.#snapshot, state: 'activating' })
    try {
      await quiesce()
      await backup()
      await this.provider.activate(this.#downloadPath)
      return this.snapshot()
    } catch (cause) {
      return this.#set({ ...this.#snapshot, state: 'failed', errorCode: readCode(cause, 'UPDATE_ACTIVATION_FAILED') })
    }
  }

  #set(snapshot: UpdateSnapshot): UpdateSnapshot {
    this.#snapshot = snapshot
    const value = this.snapshot()
    for (const listener of this.#listeners) listener(value)
    return value
  }
}

export function validateRelease(release: UpdateRelease, current: { currentVersion: string; protocolVersion: string }): void {
  if (release.architecture !== 'x64') throw Object.assign(new Error('Update architecture is unsupported.'), { code: 'UPDATE_ARCHITECTURE_UNSUPPORTED' })
  if (compareVersions(current.protocolVersion, release.minimumProtocol) < 0) throw Object.assign(new Error('Update requires a newer protocol.'), { code: 'UPDATE_PROTOCOL_UNSUPPORTED' })
  if (!/^[a-f0-9]{64}$/i.test(release.sha256)) throw Object.assign(new Error('Update hash is malformed.'), { code: 'UPDATE_MANIFEST_INVALID' })
  if (!release.artifactUrl.startsWith('https://')) throw Object.assign(new Error('Update URL must use HTTPS.'), { code: 'UPDATE_MANIFEST_INVALID' })
  if (compareVersions(release.version, current.currentVersion) <= 0) throw Object.assign(new Error('Update is not newer.'), { code: 'UPDATE_DOWNGRADE_REJECTED' })
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) { const delta = (a[index] ?? 0) - (b[index] ?? 0); if (delta) return delta }
  return 0
}

function readCode(cause: unknown, fallback: string): string {
  return typeof cause === 'object' && cause && 'code' in cause && typeof cause.code === 'string' ? cause.code : fallback
}
