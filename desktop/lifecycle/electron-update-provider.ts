import { CancellationToken } from 'builder-util-runtime'
import type { ProgressInfo, UpdateCheckResult } from 'electron-updater'
import type { UpdateProviderPort, UpdateRelease } from './update-service.js'

export interface ElectronUpdaterPort {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowDowngrade: boolean
  setFeedURL(options: { provider: 'generic'; url: string; channel: string }): void
  checkForUpdates(): Promise<UpdateCheckResult | null>
  downloadUpdate(cancellationToken?: CancellationToken): Promise<string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: 'download-progress', listener: (progress: ProgressInfo) => void): unknown
  off(event: 'download-progress', listener: (progress: ProgressInfo) => void): unknown
}

interface UpdateManifest extends UpdateRelease {
  schemaVersion: 1
  channel: 'stable' | 'preview'
}

export class ElectronUpdateProvider implements UpdateProviderPort {
  readonly #manifestUrl: string
  #checkedVersion?: string

  constructor(
    readonly updater: ElectronUpdaterPort,
    readonly options: { feedUrl: string; channel?: 'stable' | 'preview'; fetch?: typeof fetch },
  ) {
    const feed = new URL(ensureTrailingSlash(options.feedUrl))
    if (feed.protocol !== 'https:') throw coded('UPDATE_MANIFEST_INVALID', 'The update feed must use HTTPS.')
    const channel = options.channel ?? 'stable'
    this.#manifestUrl = new URL(`findmnemo-${channel}.json`, feed).href
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false
    updater.setFeedURL({ provider: 'generic', url: feed.href, channel: channel === 'stable' ? 'latest' : 'preview' })
  }

  async check(signal: AbortSignal): Promise<UpdateRelease | undefined> {
    const fetcher = this.options.fetch ?? fetch
    const [manifestResponse, updaterResult] = await Promise.all([
      fetcher(this.#manifestUrl, { signal, headers: { accept: 'application/json' } }),
      this.updater.checkForUpdates(),
    ])
    if (!manifestResponse.ok) throw coded('UPDATE_FEED_UNAVAILABLE', `Update feed returned ${manifestResponse.status}.`)
    const manifest = parseManifest(await manifestResponse.json(), this.options.channel ?? 'stable')
    if (!updaterResult?.isUpdateAvailable) return undefined
    if (updaterResult.updateInfo.version !== manifest.version) throw coded('UPDATE_MANIFEST_MISMATCH', 'Updater metadata and release evidence disagree.')
    this.#checkedVersion = manifest.version
    return manifest
  }

  async download(release: UpdateRelease, onProgress: (progress: number) => void, signal: AbortSignal): Promise<string> {
    if (release.version !== this.#checkedVersion) throw coded('UPDATE_MANIFEST_MISMATCH', 'The requested release was not checked in this session.')
    const cancellation = new CancellationToken()
    const abort = () => cancellation.cancel()
    const progress = (value: ProgressInfo) => onProgress(value.percent)
    signal.addEventListener('abort', abort, { once: true })
    this.updater.on('download-progress', progress)
    try {
      if (signal.aborted) cancellation.cancel()
      const paths = await this.updater.downloadUpdate(cancellation)
      const installer = paths.find((path) => path.toLowerCase().endsWith('.exe')) ?? paths[0]
      if (!installer) throw coded('UPDATE_DOWNLOAD_FAILED', 'The updater returned no downloaded artifact.')
      return installer
    } finally {
      signal.removeEventListener('abort', abort)
      this.updater.off('download-progress', progress)
    }
  }

  async activate(): Promise<void> {
    this.updater.quitAndInstall(false, true)
  }
}

export function parseManifest(value: unknown, expectedChannel: 'stable' | 'preview'): UpdateManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.channel !== expectedChannel) throw coded('UPDATE_MANIFEST_INVALID', 'Update manifest schema or channel is invalid.')
  if (typeof value.version !== 'string' || value.architecture !== 'x64' || typeof value.minimumProtocol !== 'string' || typeof value.artifactUrl !== 'string' || typeof value.sha256 !== 'string' || typeof value.signatureVerified !== 'boolean' || !Array.isArray(value.permissionChanges) || !value.permissionChanges.every((item) => typeof item === 'string') || typeof value.releaseNotes !== 'string') {
    throw coded('UPDATE_MANIFEST_INVALID', 'Update manifest fields are invalid.')
  }
  return value as unknown as UpdateManifest
}

function ensureTrailingSlash(value: string): string { return value.endsWith('/') ? value : `${value}/` }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function coded(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }
