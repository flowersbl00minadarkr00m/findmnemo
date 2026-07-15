import type { RunningCompanion } from '../../server/companion.js'
import { startCompanion } from '../../server/companion.js'
import type { CompanionHostPort } from './controller.js'
import type { CompanionPairingSnapshot } from '../../shared/lifecycle-contract.js'
import type { ProjectFolderSelectionPreview } from '../../shared/lifecycle-contract.js'
import { DesktopAgentActivitySetupPort } from '../agent-activity/integration-installer.js'

export interface PackagedCompanionHostOptions {
  appVersion: string
  instanceId: string
  distPath: string
  homeDirectory?: string
  activityReporterCommand?: string
}

export class PackagedCompanionHost implements CompanionHostPort {
  #running?: RunningCompanion

  constructor(readonly options: PackagedCompanionHostOptions) {}

  async start() {
    if (!this.#running) {
      this.#running = await startCompanion({
        companionVersion: this.options.appVersion,
        instanceId: this.options.instanceId,
        distPath: this.options.distPath,
        ...(this.options.homeDirectory && this.options.activityReporterCommand ? { activitySetup: new DesktopAgentActivitySetupPort(this.options.homeDirectory, this.options.activityReporterCommand) } : {}),
      })
    }
    return { version: this.options.appVersion, host: this.#running.host, port: this.#running.port }
  }

  async stop(): Promise<void> {
    const running = this.#running
    this.#running = undefined
    if (running) await running.stop()
  }

  pairingSnapshot(): CompanionPairingSnapshot {
    const snapshot = this.#running?.pairingSnapshot()
    return snapshot
      ? { state: 'ready', ...snapshot, guidance: 'Enter this code in the hosted FindMnemo page. It expires after five minutes and works once.' }
      : { state: 'unavailable', guidance: 'Start FindMnemo on this computer to create a one-time code.' }
  }

  refreshPairingCode(): CompanionPairingSnapshot {
    const snapshot = this.#running?.refreshPairingCode()
    return snapshot
      ? { state: 'ready', ...snapshot, guidance: 'A new one-time code is ready. The previous code no longer works.' }
      : { state: 'unavailable', guidance: 'Start FindMnemo on this computer before requesting a new code.' }
  }

  async previewProjectFolders(paths: readonly string[]): Promise<ProjectFolderSelectionPreview> {
    if (!this.#running) return { state: 'unavailable', items: [], confirmationRequired: false, errorCode: 'COMPANION_NOT_RUNNING' }
    return this.#running.projectFolderService.preview(paths)
  }

  commitProjectFolders(previewId: string, warningsConfirmed: boolean) {
    if (!this.#running) return { committed: false, folderIds: [], errorCode: 'COMPANION_NOT_RUNNING' }
    return this.#running.projectFolderService.commit(previewId, warningsConfirmed)
  }
}
