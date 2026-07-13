import type { RunningCompanion } from '../../server/companion.js'
import { startCompanion } from '../../server/companion.js'
import type { CompanionHostPort } from './controller.js'

export interface PackagedCompanionHostOptions {
  appVersion: string
  instanceId: string
  distPath: string
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
      })
    }
    return { version: this.options.appVersion, host: this.#running.host, port: this.#running.port }
  }

  async stop(): Promise<void> {
    const running = this.#running
    this.#running = undefined
    if (running) await running.stop()
  }
}
