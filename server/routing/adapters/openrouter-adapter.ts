import type { DestinationDetectionDto, DestinationModelCatalogDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import type { SecretStore } from '../../auth/secret-store.js'
import type { AdapterConnectionContext, AdapterManifest, DestinationAdapter, DestinationExecutionEvent } from '../adapter-contract.js'
import { ROUTING_COMPATIBILITY_MANIFESTS } from '../compatibility-manifests.js'
import { OPENROUTER_SECRET_KEY } from '../openrouter-oauth-service.js'

const API = 'https://openrouter.ai/api/v1'
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const SAFE_EFFORT = new Set(['low', 'medium', 'high'])

export class OpenRouterAdapter implements DestinationAdapter {
  readonly manifest: AdapterManifest = { adapterId: 'openrouter', displayName: 'OpenRouter', executableLabel: 'OpenRouter HTTPS API', versionArgs: [], supportedRange: '1.x', testedCapabilities: ['authentication', 'catalog', 'validation', 'execution', 'cancellation'], controllability: 'controllable', installationGuidance: 'Connect an OpenRouter account from FindMnemo.', authenticationGuidance: 'Connect or reconnect OpenRouter.', qualification: ROUTING_COMPATIBILITY_MANIFESTS.openrouter }
  private readonly store: SecretStore
  private readonly fetcher: typeof fetch
  private readonly clock: () => Date
  constructor(store: SecretStore, fetcher: typeof fetch = fetch, clock: () => Date = () => new Date()) { this.store = store; this.fetcher = fetcher; this.clock = clock }
  async detect(_signal: AbortSignal): Promise<DestinationDetectionDto> { return { adapterId: 'openrouter', displayName: 'OpenRouter', installation: 'detected', compatibility: 'supported', controllability: 'controllable', readiness: 'unchecked', executableLabel: 'HTTPS API', installedVersion: '1.0.0', supportedRange: '1.x', testedCapabilities: [...this.manifest.testedCapabilities], evidenceAt: this.clock().toISOString(), reasonCode: null, guidance: this.manifest.authenticationGuidance } }
  async checkAuthentication(_context: AdapterConnectionContext, signal: AbortSignal) { const key = await this.store.get(OPENROUTER_SECRET_KEY); if (!key) return { state: 'required' as const, reasonCode: 'OPENROUTER_CONNECT_REQUIRED' }; try { const response = await this.fetcher(`${API}/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error' }); return response.ok ? { state: 'ready' as const, reasonCode: null } : { state: 'invalid' as const, reasonCode: response.status === 401 ? 'OPENROUTER_KEY_INVALID' : 'OPENROUTER_KEY_CHECK_FAILED' } } catch { return { state: 'invalid' as const, reasonCode: 'OPENROUTER_KEY_CHECK_FAILED' } } }
  async listConnectionModels(context: AdapterConnectionContext, signal: AbortSignal): Promise<DestinationModelCatalogDto> { const key = await this.requiredKey(); const response = await this.fetcher(`${API}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: 'error' }); const data = await boundedJson(response, 5 * 1024 * 1024); if (!response.ok || !isRecord(data) || !Array.isArray(data.data)) throw new Error('OPENROUTER_CATALOG_FAILED'); const models = data.data.map(normalizeModel); if (models.some((model) => model === null)) throw new Error('OPENROUTER_CATALOG_SCHEMA_CHANGED'); const now = this.clock(); return { adapterId: context.connection.adapterId, adapterVersion: '1.0.0', installedVersion: '1.0.0', checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(), models: models as DestinationModelCatalogDto['models'] } }
  async validateConnectionProfile(profile: RoutingProfileV3, context: AdapterConnectionContext, signal: AbortSignal) { const catalog = await this.listConnectionModels(context, signal); const model = catalog.models.find((candidate) => candidate.modelId === profile.modelId); return { valid: Boolean(model && (profile.effort === null || model.supportedEfforts.includes(profile.effort))), reasonCode: model ? 'EFFORT_UNSUPPORTED' : 'MODEL_NOT_FOUND' } }
  async *executeConnectionProfile(profile: RoutingProfileV3, task: string, context: AdapterConnectionContext, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent> {
    if (!SAFE_MODEL.test(profile.modelId) || profile.effort !== null && !SAFE_EFFORT.has(profile.effort) || task.length > 200_000) throw new Error('OPENROUTER_REQUEST_INVALID')
    const key = await this.requiredKey()
    const requested = { destinationAdapterId: 'openrouter', destinationInstanceId: context.connection.id, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort }
    yield { type: 'started', actualRoute: requested }
    try {
      const body: Record<string, unknown> = { model: profile.modelId, messages: [{ role: 'user', content: task }], stream: false }
      if (profile.effort) body.reasoning = { effort: profile.effort }
      const response = await this.fetcher(`${API}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]), redirect: 'error' })
      const data = await boundedJson(response, 2 * 1024 * 1024)
      if (!response.ok) { yield { type: 'failed', code: mapError(response.status) }; return }
      if (!isRecord(data) || typeof data.model !== 'string' || !Array.isArray(data.choices) || !isRecord(data.choices[0]) || !isRecord(data.choices[0].message) || typeof data.choices[0].message.content !== 'string') { yield { type: 'failed', code: 'OPENROUTER_OUTPUT_MALFORMED' }; return }
      yield { type: 'completed', text: data.choices[0].message.content, actualRoute: { ...requested, modelId: data.model } }
    } catch (cause) { yield { type: 'failed', code: signal.aborted || cause instanceof DOMException && cause.name === 'AbortError' ? 'OPENROUTER_CANCELLED' : 'OPENROUTER_UNAVAILABLE' } }
  }
  private async requiredKey(): Promise<string> { const key = await this.store.get(OPENROUTER_SECRET_KEY); if (!key) throw new Error('OPENROUTER_CONNECT_REQUIRED'); return key }
}
function normalizeModel(value: unknown) { if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !SAFE_MODEL.test(value.id)) return null; const parameters = Array.isArray(value.supported_parameters) ? value.supported_parameters.filter((item): item is string => typeof item === 'string') : []; const reasoning = parameters.includes('reasoning'); return { providerId: value.id.split('/')[0], modelId: value.id, displayName: value.name, reasoning, supportedEfforts: reasoning ? ['low', 'medium', 'high'] : [] } }
async function boundedJson(response: Response, limit: number) { const text = await response.text(); if (Buffer.byteLength(text) > limit) throw new Error('OPENROUTER_OUTPUT_LIMIT'); return JSON.parse(text) as unknown }
function mapError(status: number): string { return status === 401 ? 'OPENROUTER_KEY_INVALID' : status === 402 ? 'OPENROUTER_CREDITS_REQUIRED' : status === 429 ? 'OPENROUTER_RATE_LIMITED' : status === 404 ? 'OPENROUTER_MODEL_UNAVAILABLE' : 'OPENROUTER_REQUEST_FAILED' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
