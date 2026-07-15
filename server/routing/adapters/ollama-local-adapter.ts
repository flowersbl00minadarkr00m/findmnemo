import type { DestinationDetectionDto, DestinationModelCatalogDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import type { AdapterConnectionContext, AdapterManifest, DestinationAdapter, DestinationExecutionEvent } from '../adapter-contract.js'
import { ROUTING_COMPATIBILITY_MANIFESTS } from '../compatibility-manifests.js'

const ORIGIN = 'http://127.0.0.1:11434'
const VERSION = '1.0.0'
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/

export class OllamaLocalAdapter implements DestinationAdapter {
  readonly manifest: AdapterManifest = { adapterId: 'ollama-local', displayName: 'Ollama', executableLabel: 'ollama-local-api', versionArgs: [], supportedRange: '0.x', testedCapabilities: ['detection', 'catalog', 'validation', 'execution', 'cancellation'], controllability: 'controllable', installationGuidance: 'Install and start Ollama on this computer, then check again.', authenticationGuidance: 'Ollama runs locally and does not need a provider key.', qualification: ROUTING_COMPATIBILITY_MANIFESTS['ollama-local'] }
  private readonly fetcher: typeof fetch
  private readonly clock: () => Date
  constructor(fetcher: typeof fetch = fetch, clock: () => Date = () => new Date()) { this.fetcher = fetcher; this.clock = clock }

  async detect(signal: AbortSignal): Promise<DestinationDetectionDto> {
    const base = { adapterId: 'ollama-local', displayName: 'Ollama', controllability: 'controllable' as const, readiness: 'unchecked' as const, executableLabel: 'local service', supportedRange: '0.x', testedCapabilities: [...this.manifest.testedCapabilities], evidenceAt: this.clock().toISOString() }
    try {
      const response = await this.fetcher(`${ORIGIN}/api/version`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2_500)]), redirect: 'error' })
      const data = await boundedJson(response, 16_384)
      const version = isRecord(data) && typeof data.version === 'string' ? data.version : null
      if (!response.ok || !version) return { ...base, installation: 'detected', compatibility: 'unknown', installedVersion: null, reasonCode: 'OLLAMA_SCHEMA_CHANGED', guidance: 'Ollama responded, but its version could not be verified.' }
      return { ...base, installation: 'detected', compatibility: version.startsWith('0.') ? 'supported' : 'unsupported', installedVersion: version, reasonCode: version.startsWith('0.') ? null : 'VERSION_UNSUPPORTED', guidance: version.startsWith('0.') ? 'Ollama is ready. Refresh installed models.' : 'Install a supported Ollama 0.x release.' }
    } catch { return { ...base, installation: 'not-found', compatibility: 'unknown', installedVersion: null, reasonCode: 'TOOL_NOT_FOUND', guidance: this.manifest.installationGuidance } }
  }
  async checkAuthentication(_context: AdapterConnectionContext, signal: AbortSignal) { const detection = await this.detect(signal); return detection.compatibility === 'supported' ? { state: 'ready' as const, reasonCode: null } : { state: 'required' as const, reasonCode: detection.reasonCode } }
  async listConnectionModels(context: AdapterConnectionContext, signal: AbortSignal): Promise<DestinationModelCatalogDto> {
    const detection = await this.detect(signal)
    if (detection.compatibility !== 'supported' || !detection.installedVersion) throw new Error('OLLAMA_UNAVAILABLE')
    const response = await this.fetcher(`${ORIGIN}/api/tags`, { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]), redirect: 'error' })
    const data = await boundedJson(response, 2 * 1024 * 1024)
    if (!response.ok || !isRecord(data) || !Array.isArray(data.models)) throw new Error('OLLAMA_SCHEMA_CHANGED')
    const models = data.models.map((value) => isRecord(value) && typeof value.name === 'string' && SAFE_MODEL.test(value.name) ? { providerId: 'ollama', modelId: value.name, displayName: value.name, reasoning: false, supportedEfforts: ['off'] } : null)
    if (models.some((model) => model === null)) throw new Error('OLLAMA_SCHEMA_CHANGED')
    const now = this.clock()
    return { adapterId: context.connection.adapterId, adapterVersion: VERSION, installedVersion: detection.installedVersion, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), models: models as DestinationModelCatalogDto['models'] }
  }
  async validateConnectionProfile(profile: RoutingProfileV3, context: AdapterConnectionContext, signal: AbortSignal) { const catalog = await this.listConnectionModels(context, signal); return { valid: catalog.models.some((model) => model.modelId === profile.modelId) && (profile.effort === null || profile.effort === 'off'), reasonCode: null } }
  async *executeConnectionProfile(profile: RoutingProfileV3, task: string, context: AdapterConnectionContext, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent> {
    if (!SAFE_MODEL.test(profile.modelId) || profile.effort !== null && profile.effort !== 'off' || task.length > 200_000) throw new Error('OLLAMA_REQUEST_INVALID')
    const requested = { destinationAdapterId: 'ollama-local', destinationInstanceId: context.connection.id, providerId: 'ollama', modelId: profile.modelId, effort: profile.effort }
    yield { type: 'started', actualRoute: requested }
    try {
      const response = await this.fetcher(`${ORIGIN}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: profile.modelId, stream: false, messages: [{ role: 'user', content: task }] }), signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]), redirect: 'error' })
      const data = await boundedJson(response, 2 * 1024 * 1024)
      if (!response.ok || !isRecord(data) || typeof data.model !== 'string' || !isRecord(data.message) || typeof data.message.content !== 'string') { yield { type: 'failed', code: 'OLLAMA_OUTPUT_MALFORMED' }; return }
      yield { type: 'completed', text: data.message.content, actualRoute: { ...requested, modelId: data.model } }
    } catch (cause) { yield { type: 'failed', code: signal.aborted || cause instanceof DOMException && cause.name === 'AbortError' ? 'OLLAMA_CANCELLED' : 'OLLAMA_UNAVAILABLE' } }
  }
}

async function boundedJson(response: Response, limit: number): Promise<unknown> { const text = await response.text(); if (Buffer.byteLength(text) > limit) throw new Error('OLLAMA_OUTPUT_LIMIT'); return JSON.parse(text) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
