import type { DestinationModelDto, RoutingConnectionCatalogDto, RoutingConnectionDto } from '../../shared/companion-contract.js'
import type { DestinationAdapter } from './adapter-contract.js'
import { RoutingConnectionRepository } from './connection-repository.js'

export class RoutingCatalogService {
  private readonly repository: RoutingConnectionRepository
  private readonly clock: () => Date
  constructor(repository: RoutingConnectionRepository, clock: () => Date = () => new Date()) { this.repository = repository; this.clock = clock }

  async refresh(connection: RoutingConnectionDto, adapter: DestinationAdapter, signal: AbortSignal): Promise<RoutingConnectionCatalogDto> {
    const raw = adapter.listConnectionModels ? await adapter.listConnectionModels({ connection }, signal) : adapter.listModels ? await adapter.listModels(signal) : undefined
    const source = adapter.manifest.qualification?.catalogMode === 'tested-manifest' ? 'tested-manifest' : adapter.manifest.qualification?.catalogMode === 'installed-local' ? 'local-runtime' : adapter.manifest.qualification?.catalogMode === 'live-http' ? 'provider-api' : 'cli'
    const catalog = normalizeCatalog(raw, connection, source, this.clock)
    this.repository.saveCatalog(catalog)
    return catalog
  }
}

function normalizeCatalog(raw: unknown, connection: RoutingConnectionDto, source: RoutingConnectionCatalogDto['source'], clock: () => Date): RoutingConnectionCatalogDto {
  if (!isRecord(raw) || !Array.isArray(raw.models) || typeof raw.adapterVersion !== 'string' || typeof raw.installedVersion !== 'string') throw new Error('ROUTING_CATALOG_MALFORMED')
  const models = raw.models.map(normalizeModel)
  if (models.some((model) => model === null)) throw new Error('ROUTING_CATALOG_MALFORMED')
  const checkedAt = typeof raw.checkedAt === 'string' && Number.isFinite(Date.parse(raw.checkedAt)) ? raw.checkedAt : clock().toISOString()
  const expiresAt = typeof raw.expiresAt === 'string' && Date.parse(raw.expiresAt) > Date.parse(checkedAt) ? raw.expiresAt : new Date(Date.parse(checkedAt) + 15 * 60_000).toISOString()
  return { connectionId: connection.id, adapterId: connection.adapterId, adapterVersion: raw.adapterVersion, installedVersion: raw.installedVersion, checkedAt, expiresAt, source, verification: source === 'tested-manifest' ? 'manifest' : 'observed', models: models as DestinationModelDto[] }
}
function normalizeModel(value: unknown): DestinationModelDto | null {
  if (!isRecord(value) || typeof value.modelId !== 'string' || typeof value.displayName !== 'string' || typeof value.reasoning !== 'boolean' || !Array.isArray(value.supportedEfforts) || !value.supportedEfforts.every((effort) => typeof effort === 'string')) return null
  if (typeof value.providerId !== 'string') return null
  return { providerId: value.providerId, modelId: value.modelId, displayName: value.displayName, reasoning: value.reasoning, supportedEfforts: value.supportedEfforts }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
