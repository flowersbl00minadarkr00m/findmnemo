import type { DestinationModelCatalogDto, DestinationModelDto, ProfileReadinessResultDto, RoutingExecutionProfile } from '../../../shared/companion-contract.js'
import type { AdapterManifest, DestinationAdapter, DestinationExecutionEvent, RoutingProcessRunner } from '../adapter-contract.js'
import { SpawnedPiRpcSessionFactory, type PiRpcSessionFactory } from '../pi-rpc-client.js'
import { CommandDetector } from './command-detector.js'
import { ROUTING_COMPATIBILITY_MANIFESTS } from '../compatibility-manifests.js'

export const PI_ADAPTER_VERSION = '1.0.0'
export const PI_SUPPORTED_RANGE = '0.x'
export const PI_EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

function piManifest(): AdapterManifest {
  return {
    adapterId: 'pi-rpc', displayName: 'Pi', executableLabel: process.platform === 'win32' ? 'pi.cmd' : 'pi', versionArgs: ['--version'], supportedRange: PI_SUPPORTED_RANGE,
    testedCapabilities: ['detection', 'catalog', 'validation', 'execution', 'cancellation'], controllability: 'controllable',
    installationGuidance: 'Install Pi from its official package, then run Check again. FindMnemo will not install it for you.',
    authenticationGuidance: 'Pi was found. Sign in or configure providers inside Pi before validating a profile.',
    qualification: ROUTING_COMPATIBILITY_MANIFESTS['pi-rpc'],
  }
}

export class PiRoutingAdapter implements DestinationAdapter {
  readonly manifest = piManifest()
  private readonly detector: CommandDetector

  private readonly sessions: PiRpcSessionFactory
  private readonly clock: () => Date

  constructor(runner: RoutingProcessRunner, sessions: PiRpcSessionFactory = new SpawnedPiRpcSessionFactory(), clock: () => Date = () => new Date()) {
    this.sessions = sessions
    this.clock = clock
    this.detector = new CommandDetector(this.manifest, runner, clock)
  }

  detect(signal: AbortSignal) { return this.detector.detect(signal) }

  async listModels(signal: AbortSignal): Promise<DestinationModelCatalogDto> {
    const detection = await this.detect(signal)
    if (detection.installation !== 'detected' || detection.compatibility !== 'supported' || !detection.installedVersion) throw new Error(detection.reasonCode ?? 'PI_UNAVAILABLE')
    const session = await this.sessions.open(signal)
    try {
      const response = await session.request({ type: 'get_available_models' })
      const data = record(response.data)
      if (!response.success || !data || !Array.isArray(data.models)) throw new Error('PI_RPC_PROTOCOL_CHANGED')
      const models = data.models.map(normalizeModel).filter((model): model is DestinationModelDto => model !== undefined)
      if (models.length === 0) throw new Error('PI_AUTH_REQUIRED')
      const checkedAt = this.clock()
      return { adapterId: this.manifest.adapterId, adapterVersion: PI_ADAPTER_VERSION, installedVersion: detection.installedVersion, checkedAt: checkedAt.toISOString(), expiresAt: new Date(checkedAt.getTime() + 15 * 60_000).toISOString(), models }
    } finally { await session.close() }
  }

  async validate(profile: RoutingExecutionProfile, signal: AbortSignal): Promise<ProfileReadinessResultDto> {
    const checkedAt = this.clock()
    const base = { profileId: profile.id, checkedAt: checkedAt.toISOString(), adapterVersion: PI_ADAPTER_VERSION }
    try {
      if (profile.destinationAdapterId !== this.manifest.adapterId) return { ...base, state: 'unsupported', expiresAt: null, installedVersion: null, reasonCode: 'ADAPTER_MISMATCH' }
      const catalog = await this.listModels(signal)
      const model = catalog.models.find((candidate) => candidate.providerId === profile.providerId && candidate.modelId === profile.modelId)
      if (!model) return { ...base, state: 'unavailable', expiresAt: null, installedVersion: catalog.installedVersion, reasonCode: 'MODEL_NOT_FOUND' }
      if (profile.effort !== null && !model.supportedEfforts.includes(profile.effort)) return { ...base, state: 'unsupported', expiresAt: null, installedVersion: catalog.installedVersion, reasonCode: 'EFFORT_UNSUPPORTED' }
      return { ...base, state: 'ready', expiresAt: catalog.expiresAt, installedVersion: catalog.installedVersion, reasonCode: null }
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'PI_VALIDATION_FAILED'
      const state = code === 'PI_AUTH_REQUIRED' ? 'auth-required' : code.includes('UNSUPPORTED') || code.includes('PROTOCOL') ? 'unsupported' : 'unavailable'
      return { ...base, state, expiresAt: null, installedVersion: null, reasonCode: code }
    }
  }

  async *execute(profile: RoutingExecutionProfile, task: string, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent> {
    if (profile.destinationAdapterId !== this.manifest.adapterId || !profile.providerId) throw new Error('PI_PROFILE_INVALID')
    const session = await this.sessions.open(signal)
    try {
      const selected = await session.request({ type: 'set_model', provider: profile.providerId, modelId: profile.modelId }, 10_000)
      if (!selected.success) throw new Error('PI_MODEL_SELECTION_FAILED')
      if (profile.effort !== null) {
        const effort = await session.request({ type: 'set_thinking_level', level: profile.effort }, 5_000)
        if (!effort.success) throw new Error('PI_EFFORT_SELECTION_FAILED')
      }
      const stateResponse = await session.request({ type: 'get_state' }, 5_000)
      const state = record(stateResponse.data)
      const model = record(state?.model)
      const actualRoute = {
        destinationAdapterId: this.manifest.adapterId,
        destinationInstanceId: profile.destinationInstanceId,
        providerId: typeof model?.provider === 'string' ? model.provider : null,
        modelId: typeof model?.id === 'string' ? model.id : '',
        effort: typeof state?.thinkingLevel === 'string' ? state.thinkingLevel : null,
      }
      yield { type: 'started', actualRoute }
      if (actualRoute.providerId !== profile.providerId || actualRoute.modelId !== profile.modelId || actualRoute.effort !== profile.effort) throw new Error('ACTUAL_ROUTE_MISMATCH')
      const completion = waitForAgentEnd(session, signal, 10 * 60_000)
      const accepted = await session.request({ type: 'prompt', message: task }, 10_000)
      if (!accepted.success) throw new Error('PI_PROMPT_REJECTED')
      const event = await completion
      const result = assistantResult(event)
      if (result.failed) throw new Error('PI_EXECUTION_FAILED')
      if (result.text === null) throw new Error('PI_RESULT_MALFORMED')
      const text = result.text
      yield { type: 'completed', text, actualRoute }
    } finally { await session.close() }
  }
}

export function createPiDetectionAdapter(runner: RoutingProcessRunner, clock?: () => Date): PiRoutingAdapter {
  return new PiRoutingAdapter(runner, new SpawnedPiRpcSessionFactory(), clock)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function normalizeModel(value: unknown): DestinationModelDto | undefined {
  const model = record(value)
  if (!model || typeof model.provider !== 'string' || typeof model.id !== 'string' || typeof model.name !== 'string' || typeof model.reasoning !== 'boolean') return undefined
  const map = record(model.thinkingLevelMap)
  const supportedEfforts = model.reasoning
    ? PI_EFFORTS.filter((effort) => effort !== 'xhigh' || map?.xhigh !== undefined && map.xhigh !== null)
    : ['off']
  return { providerId: model.provider, modelId: model.id, displayName: model.name, reasoning: model.reasoning, supportedEfforts: [...supportedEfforts] }
}

function waitForAgentEnd(session: import('../pi-rpc-client.js').PiRpcSession, signal: AbortSignal, timeoutMs: number): Promise<import('../pi-rpc-client.js').PiRpcResponse> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); void session.request({ type: 'abort' }, 1_000).catch(() => undefined); reject(new Error('PI_EXECUTION_ABORTED')) }
    const unsubscribe = session.onEvent((event) => { if (event.type === 'agent_end') { cleanup(); resolve(event) } })
    const timer = setTimeout(() => { cleanup(); void session.request({ type: 'abort' }, 1_000).catch(() => undefined); reject(new Error('PI_EXECUTION_TIMEOUT')) }, timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function assistantResult(event: import('../pi-rpc-client.js').PiRpcResponse): { text: string | null; failed: boolean } {
  const eventRecord = event as unknown as Record<string, unknown>
  const messages = Array.isArray(eventRecord.messages) ? eventRecord.messages as unknown[] : []
  for (const value of [...messages].reverse()) {
    const message = record(value)
    if (message?.role !== 'assistant') continue
    if (message.stopReason === 'error' || typeof message.errorMessage === 'string') return { text: null, failed: true }
    if (!Array.isArray(message.content)) continue
    const text = message.content.flatMap((part) => { const item = record(part); return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : [] }).join('')
    if (text) return { text, failed: false }
  }
  return { text: null, failed: false }
}
