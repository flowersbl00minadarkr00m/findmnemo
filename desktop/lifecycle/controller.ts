import type { LifecycleCommandResult, LifecycleState } from '../../shared/lifecycle-contract.js'
import type { UpdateSnapshot } from './update-service.js'

export interface CompanionHostPort {
  start(): Promise<{ version: string; host: '127.0.0.1'; port: number }>
  stop(): Promise<void>
}

export interface LifecycleControllerOptions {
  appVersion: string
  protocolVersion: string
  instanceId: string
  startupEnabled?: boolean
  startupConsentedAt?: string
  disclosureVersion?: string
  disclosureAcceptedAt?: string
  preferences?: LifecyclePreferencePort
  clock?: () => Date
}

export interface LifecyclePreferencePort {
  acceptDisclosure(version: string, acceptedAt: string, startAtLogin: boolean): Promise<{ startupEnabled: boolean }>
  setStartAtLogin(enabled: boolean, consentedAt: string): Promise<{ startupEnabled: boolean }>
}

export class LifecycleController {
  readonly #host: CompanionHostPort
  readonly #clock: () => Date
  readonly #preferences?: LifecyclePreferencePort
  #state: LifecycleState
  #operation?: Promise<LifecycleCommandResult>
  #listeners = new Set<(state: LifecycleState) => void>()

  constructor(host: CompanionHostPort, options: LifecycleControllerOptions) {
    this.#host = host
    this.#clock = options.clock ?? (() => new Date())
    this.#preferences = options.preferences
    const disclosureVersion = options.disclosureVersion ?? '1.0.0'
    this.#state = {
      phase: options.disclosureAcceptedAt ? 'stopped' : 'first-run',
      appVersion: options.appVersion,
      protocolVersion: options.protocolVersion,
      instanceId: options.instanceId,
      companion: { state: 'stopped' },
      startup: { enabled: options.startupEnabled ?? false, consentedAt: options.startupConsentedAt },
      disclosure: { version: disclosureVersion, acceptedAt: options.disclosureAcceptedAt },
      update: { state: 'idle' },
      recoveryActions: ['retry', 'open-local', 'quit'],
    }
  }

  snapshot(): LifecycleState {
    return structuredClone(this.#state)
  }

  subscribe(listener: (state: LifecycleState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start(): Promise<LifecycleCommandResult> {
    if (!this.#state.disclosure.acceptedAt) {
      return Promise.resolve({ ok: false, state: this.snapshot(), errorCode: 'DISCLOSURE_REQUIRED' })
    }
    if (this.#state.phase === 'healthy') return Promise.resolve({ ok: true, state: this.snapshot() })
    return this.#serialize(async () => {
      this.#update({ phase: 'starting', companion: { state: 'starting' }, recoveryActions: ['quit'] })
      try {
        const evidence = await this.#host.start()
        const now = this.#clock().toISOString()
        this.#update({
          phase: 'healthy',
          companion: { state: 'healthy', ...evidence },
          lastHealthCheckAt: now,
          lastHealthyAt: now,
          recoveryActions: ['restart', 'open-local', 'quit'],
        })
        return { ok: true, state: this.snapshot() }
      } catch (cause) {
        const code = readErrorCode(cause)
        this.#update({
          phase: code === 'UNSUPPORTED_PROTOCOL_VERSION' ? 'unsupported' : 'failed',
          companion: { state: code === 'UNSUPPORTED_PROTOCOL_VERSION' ? 'unsupported' : 'failed', errorCode: code },
          lastHealthCheckAt: this.#clock().toISOString(),
          recoveryActions: ['retry', 'open-local', 'quit'],
        })
        return { ok: false, state: this.snapshot(), errorCode: code }
      }
    })
  }

  stop(): Promise<LifecycleCommandResult> {
    if (this.#state.phase === 'stopped') return Promise.resolve({ ok: true, state: this.snapshot() })
    return this.#serialize(async () => {
      this.#update({ phase: 'stopping', companion: { ...this.#state.companion, state: 'stopping' }, recoveryActions: ['quit'] })
      try {
        await this.#host.stop()
        this.#update({ phase: 'stopped', companion: { state: 'stopped' }, recoveryActions: ['retry', 'quit'] })
        return { ok: true, state: this.snapshot() }
      } catch (cause) {
        const code = readErrorCode(cause)
        this.#update({ phase: 'failed', companion: { state: 'failed', errorCode: code }, recoveryActions: ['retry', 'quit'] })
        return { ok: false, state: this.snapshot(), errorCode: code }
      }
    })
  }

  async restart(): Promise<LifecycleCommandResult> {
    const stopped = await this.stop()
    if (!stopped.ok) return stopped
    return this.start()
  }

  async acceptDisclosure(startAtLogin: boolean): Promise<LifecycleCommandResult> {
    if (this.#state.disclosure.acceptedAt) return { ok: true, state: this.snapshot() }
    const acceptedAt = this.#clock().toISOString()
    const effective = this.#preferences
      ? await this.#preferences.acceptDisclosure(this.#state.disclosure.version, acceptedAt, startAtLogin)
      : { startupEnabled: startAtLogin }
    this.#update({
      phase: 'stopped',
      disclosure: { ...this.#state.disclosure, acceptedAt },
      startup: { enabled: effective.startupEnabled, consentedAt: acceptedAt },
    })
    return { ok: true, state: this.snapshot() }
  }

  async setStartAtLogin(enabled: boolean): Promise<LifecycleCommandResult> {
    if (!this.#state.disclosure.acceptedAt) return { ok: false, state: this.snapshot(), errorCode: 'DISCLOSURE_REQUIRED' }
    const consentedAt = this.#clock().toISOString()
    const effective = this.#preferences
      ? await this.#preferences.setStartAtLogin(enabled, consentedAt)
      : { startupEnabled: enabled }
    this.#update({ startup: { enabled: effective.startupEnabled, consentedAt } })
    return { ok: effective.startupEnabled === enabled, state: this.snapshot(), errorCode: effective.startupEnabled === enabled ? undefined : 'STARTUP_STATE_MISMATCH' }
  }

  applyUpdateSnapshot(update: UpdateSnapshot): LifecycleState {
    const updatePhase = update.state === 'available' ? 'update-available'
      : update.state === 'downloading' ? 'update-downloading'
        : update.state === 'ready' ? 'update-ready'
          : update.state === 'activating' ? 'updating'
            : undefined
    const wasUpdatePhase = ['update-available', 'update-downloading', 'update-ready', 'updating'].includes(this.#state.phase)
    this.#update({
      update,
      phase: updatePhase ?? (wasUpdatePhase && this.#state.companion.state === 'healthy' ? 'healthy' : this.#state.phase),
    })
    return this.snapshot()
  }

  #serialize(operation: () => Promise<LifecycleCommandResult>): Promise<LifecycleCommandResult> {
    if (this.#operation) return this.#operation
    this.#operation = operation().finally(() => { this.#operation = undefined })
    return this.#operation
  }

  #update(patch: Partial<LifecycleState>): void {
    this.#state = { ...this.#state, ...patch }
    const snapshot = this.snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}

function readErrorCode(cause: unknown): string {
  if (typeof cause === 'object' && cause && 'code' in cause && typeof cause.code === 'string') return cause.code
  return 'INTERNAL_ERROR'
}
