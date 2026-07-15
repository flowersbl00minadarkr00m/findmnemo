import type { OperationalRoutingPolicyV3, RoutingConnectionCatalogDto, RoutingConnectionDto, RoutingConnectionSummaryDto, RoutingProfileV3 } from '../../shared/companion-contract.js'
import type { DestinationAdapter } from './adapter-contract.js'
import { RoutingCatalogService } from './catalog-service.js'
import { ROUTING_COMPATIBILITY_MANIFESTS } from './compatibility-manifests.js'
import { RoutingConnectionRepository } from './connection-repository.js'
import { DiscoveryService } from './discovery-service.js'
import { RoutingRepository } from './routing-repository.js'

export class RoutingConnectionService {
  private readonly adapters: Map<string, DestinationAdapter>
  private readonly connections: RoutingConnectionRepository
  private readonly catalogs: RoutingCatalogService
  private readonly routing: RoutingRepository
  private readonly clock: () => Date

  constructor(adapters: readonly DestinationAdapter[], connections: RoutingConnectionRepository, routing: RoutingRepository, clock: () => Date = () => new Date()) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.manifest.adapterId, adapter]))
    this.connections = connections
    this.catalogs = new RoutingCatalogService(connections, clock)
    this.routing = routing
    this.clock = clock
  }

  list(): RoutingConnectionSummaryDto[] { return this.connections.list().map(safeConnection) }
  catalog(connectionId: string): RoutingConnectionCatalogDto | null { return this.connections.readCatalog(connectionId) }
  policy(): OperationalRoutingPolicyV3 | null { return this.routing.readPolicyV3() }
  savePolicy(policy: OperationalRoutingPolicyV3, expectedPolicyVersion: number | null): OperationalRoutingPolicyV3 {
    const result = this.routing.compareAndSetPolicyV3(policy, expectedPolicyVersion, this.connections.list())
    if (result.status === 'conflict') throw new Error('ROUTING_POLICY_CONFLICT')
    return result.policy
  }

  async discover(signal?: AbortSignal): Promise<RoutingConnectionSummaryDto[]> {
    const adapters = [...this.adapters.values()].filter((adapter) => ROUTING_COMPATIBILITY_MANIFESTS[adapter.manifest.adapterId])
    const result = await new DiscoveryService(adapters, this.clock).discover(signal)
    for (const detection of result.destinations) {
      const manifest = ROUTING_COMPATIBILITY_MANIFESTS[detection.adapterId]
      if (!manifest) continue
      const existing = this.connections.list().find((connection) => connection.adapterId === manifest.adapterId)
      this.connections.save({ id: existing?.id ?? `connection:${manifest.adapterId}:default`, adapterId: manifest.adapterId, displayName: detection.displayName, enabled: false, authMode: manifest.authMode, authState: detection.compatibility === 'unsupported' ? 'unsupported' : 'unchecked', installedVersion: detection.installedVersion, supportedRange: manifest.supportedVersions, readinessCheckedAt: detection.evidenceAt, catalogRefreshedAt: existing?.catalogRefreshedAt ?? null, config: existing?.config ?? {}, secretRef: existing?.secretRef ?? null })
    }
    return this.list()
  }

  async refresh(connectionId: string, signal: AbortSignal): Promise<{ connection: RoutingConnectionSummaryDto; catalog: RoutingConnectionCatalogDto }> {
    const connection = this.connections.get(connectionId)
    if (!connection) throw new Error('ROUTING_CONNECTION_NOT_FOUND')
    const adapter = this.adapters.get(connection.adapterId)
    if (!adapter) throw new Error('ROUTING_DESTINATION_UNAVAILABLE')
    const detection = await adapter.detect(signal)
    if (detection.installation !== 'detected' || detection.compatibility !== 'supported') throw new Error(detection.reasonCode ?? 'ROUTING_DESTINATION_UNAVAILABLE')
    const auth = adapter.checkAuthentication ? await adapter.checkAuthentication({ connection }, signal) : { state: 'unchecked' as const, reasonCode: null }
    if (auth.state === 'invalid' || auth.state === 'required' || auth.state === 'unsupported') {
      this.connections.save({ ...connection, enabled: false, authState: auth.state, installedVersion: detection.installedVersion, readinessCheckedAt: this.clock().toISOString() })
      throw new Error(auth.reasonCode ?? 'ROUTING_AUTH_REQUIRED')
    }
    const catalog = await this.catalogs.refresh(connection, adapter, signal)
    const updated = this.connections.save({ ...connection, enabled: false, authState: 'ready', installedVersion: detection.installedVersion, readinessCheckedAt: this.clock().toISOString(), catalogRefreshedAt: catalog.checkedAt })
    return { connection: safeConnection(updated), catalog }
  }

  setEnabled(connectionId: string, enabled: boolean): RoutingConnectionSummaryDto {
    const connection = this.connections.get(connectionId)
    if (!connection) throw new Error('ROUTING_CONNECTION_NOT_FOUND')
    if (enabled) {
      const catalog = this.connections.readCatalog(connectionId)
      if (connection.authState !== 'ready' || !catalog || Date.parse(catalog.expiresAt) <= this.clock().getTime()) throw new Error('ROUTING_CONNECTION_NOT_READY')
    }
    return safeConnection(this.connections.save({ ...connection, enabled }))
  }

  disconnectAdapter(adapterId: RoutingConnectionDto['adapterId']): void {
    for (const connection of this.connections.list().filter((candidate) => candidate.adapterId === adapterId)) {
      this.connections.save({ ...connection, enabled: false, authState: 'required', readinessCheckedAt: this.clock().toISOString(), catalogRefreshedAt: null })
      this.connections.invalidate(connection.id)
    }
  }

  validateProfile(profileId: string): RoutingProfileV3 {
    const policy = this.routing.readPolicyV3()
    const profile = policy?.profiles.find((candidate) => candidate.id === profileId)
    if (!policy || !profile || profile.kind !== 'executable' || !profile.connectionId) throw new Error('ROUTING_PROFILE_NOT_FOUND')
    const connection = this.connections.get(profile.connectionId)
    const catalog = this.connections.readCatalog(profile.connectionId)
    const model = catalog?.models.find((candidate) => candidate.providerId === profile.providerId && candidate.modelId === profile.modelId)
    const ready = Boolean(connection?.enabled && connection.authState === 'ready' && catalog && Date.parse(catalog.expiresAt) > this.clock().getTime() && model && (profile.effort === null || model.supportedEfforts.includes(profile.effort)))
    const checkedAt = this.clock().toISOString()
    const next: RoutingProfileV3 = { ...profile, enabled: ready && profile.enabled, readiness: { state: ready ? 'ready' : 'unavailable', checkedAt, expiresAt: ready ? catalog!.expiresAt : null, adapterVersion: catalog?.adapterVersion ?? null, installedVersion: connection?.installedVersion ?? null, reasonCode: ready ? null : 'CONNECTION_OR_MODEL_NOT_READY' } }
    const result = this.routing.compareAndSetPolicyV3({ ...policy, updatedAt: checkedAt, profiles: policy.profiles.map((candidate) => candidate.id === profileId ? next : candidate) }, policy.policyVersion, this.connections.list())
    if (result.status !== 'saved') throw new Error('ROUTING_POLICY_CONFLICT')
    return result.policy.profiles.find((candidate) => candidate.id === profileId)!
  }
}

function safeConnection(connection: RoutingConnectionDto): RoutingConnectionSummaryDto {
  const { config: _config, secretRef: _secretRef, ...safe } = connection
  return safe
}
