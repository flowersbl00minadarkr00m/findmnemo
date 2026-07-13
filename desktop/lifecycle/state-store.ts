import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface PersistedLifecycleSettings {
  schema: 'findmnemo.lifecycle.v1'
  instanceId: string
  startupEnabled: boolean
  disclosureVersion?: string
  disclosureAcceptedAt?: string
}

export class LifecycleStateStore {
  constructor(readonly path: string) {}

  async load(): Promise<PersistedLifecycleSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>
      if (parsed.schema !== 'findmnemo.lifecycle.v1' || typeof parsed.instanceId !== 'string' || typeof parsed.startupEnabled !== 'boolean') {
        throw Object.assign(new Error('Lifecycle settings are invalid.'), { code: 'LIFECYCLE_SETTINGS_INVALID' })
      }
      return {
        schema: 'findmnemo.lifecycle.v1',
        instanceId: parsed.instanceId,
        startupEnabled: parsed.startupEnabled,
        disclosureVersion: typeof parsed.disclosureVersion === 'string' ? parsed.disclosureVersion : undefined,
        disclosureAcceptedAt: typeof parsed.disclosureAcceptedAt === 'string' ? parsed.disclosureAcceptedAt : undefined,
      }
    } catch (cause) {
      if (isMissing(cause)) return this.create()
      throw cause
    }
  }

  async create(): Promise<PersistedLifecycleSettings> {
    const settings: PersistedLifecycleSettings = { schema: 'findmnemo.lifecycle.v1', instanceId: randomUUID(), startupEnabled: false }
    await this.save(settings)
    return settings
  }

  async save(settings: PersistedLifecycleSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.path)
  }
}

export class PersistedLifecyclePreferences {
  #settings: PersistedLifecycleSettings

  constructor(
    readonly store: LifecycleStateStore,
    initial: PersistedLifecycleSettings,
    readonly applyStartAtLogin: (enabled: boolean) => Promise<boolean>,
  ) { this.#settings = initial }

  async acceptDisclosure(version: string, acceptedAt: string, startAtLogin: boolean) {
    const startupEnabled = await this.applyStartAtLogin(startAtLogin)
    this.#settings = { ...this.#settings, disclosureVersion: version, disclosureAcceptedAt: acceptedAt, startupEnabled }
    await this.store.save(this.#settings)
    return { startupEnabled }
  }

  async setStartAtLogin(enabled: boolean, consentedAt: string) {
    const startupEnabled = await this.applyStartAtLogin(enabled)
    this.#settings = { ...this.#settings, startupEnabled, disclosureAcceptedAt: this.#settings.disclosureAcceptedAt ?? consentedAt }
    await this.store.save(this.#settings)
    return { startupEnabled }
  }
}

function isMissing(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT'
}
