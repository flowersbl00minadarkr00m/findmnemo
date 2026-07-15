import type { DatabaseSync } from 'node:sqlite'
import type { RoutingConnectionCatalogDto, RoutingConnectionDto } from '../../shared/companion-contract.js'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/
const FORBIDDEN_CONFIG_KEY = /(token|secret|password|credential|authorization|oauth|prompt|result|raw|path|executable|environment)/i

export class RoutingConnectionRepository {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) { this.db = db }

  list(): RoutingConnectionDto[] {
    return (this.db.prepare('SELECT * FROM routing_connections ORDER BY adapter_id,id').all() as Array<Record<string, unknown>>).map(connectionFromRow)
  }

  get(id: string): RoutingConnectionDto | null {
    const row = this.db.prepare('SELECT * FROM routing_connections WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? connectionFromRow(row) : null
  }

  save(connection: RoutingConnectionDto): RoutingConnectionDto {
    validateConnection(connection)
    const current = this.get(connection.id)
    this.db.prepare(`INSERT INTO routing_connections(id,adapter_id,display_name,enabled,auth_mode,auth_state,installed_version,supported_range,readiness_checked_at,catalog_refreshed_at,config_json,secret_ref)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET adapter_id=excluded.adapter_id,display_name=excluded.display_name,
      enabled=excluded.enabled,auth_mode=excluded.auth_mode,auth_state=excluded.auth_state,installed_version=excluded.installed_version,
      supported_range=excluded.supported_range,readiness_checked_at=excluded.readiness_checked_at,catalog_refreshed_at=excluded.catalog_refreshed_at,
      config_json=excluded.config_json,secret_ref=excluded.secret_ref`)
      .run(connection.id, connection.adapterId, connection.displayName, connection.enabled ? 1 : 0, connection.authMode, connection.authState,
        connection.installedVersion, connection.supportedRange, connection.readinessCheckedAt, connection.catalogRefreshedAt,
        JSON.stringify(connection.config), connection.secretRef)
    if (current && connectionIdentityChanged(current, connection)) this.invalidateDependents(connection.id)
    return this.get(connection.id)!
  }

  remove(id: string): boolean { return this.db.prepare('DELETE FROM routing_connections WHERE id=?').run(id).changes > 0 }

  invalidate(id: string): void { this.invalidateDependents(id) }

  saveCatalog(catalog: RoutingConnectionCatalogDto): void {
    if (!this.get(catalog.connectionId) || catalog.models.length > 10_000) throw new Error('ROUTING_CONNECTION_INVALID')
    this.db.prepare(`INSERT INTO routing_connection_catalogs(connection_id,adapter_id,adapter_version,installed_version,checked_at,expires_at,source,verification,models_json)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET adapter_id=excluded.adapter_id,adapter_version=excluded.adapter_version,
      installed_version=excluded.installed_version,checked_at=excluded.checked_at,expires_at=excluded.expires_at,source=excluded.source,
      verification=excluded.verification,models_json=excluded.models_json`)
      .run(catalog.connectionId, catalog.adapterId, catalog.adapterVersion, catalog.installedVersion, catalog.checkedAt, catalog.expiresAt, catalog.source, catalog.verification, JSON.stringify(catalog.models))
  }

  readCatalog(connectionId: string): RoutingConnectionCatalogDto | null {
    const row = this.db.prepare('SELECT * FROM routing_connection_catalogs WHERE connection_id=?').get(connectionId) as Record<string, unknown> | undefined
    return row ? {
      connectionId: String(row.connection_id), adapterId: String(row.adapter_id), adapterVersion: String(row.adapter_version), installedVersion: String(row.installed_version),
      checkedAt: String(row.checked_at), expiresAt: String(row.expires_at), source: String(row.source) as RoutingConnectionCatalogDto['source'],
      verification: String(row.verification) as RoutingConnectionCatalogDto['verification'], models: JSON.parse(String(row.models_json)) as RoutingConnectionCatalogDto['models'],
    } : null
  }

  private invalidateDependents(connectionId: string): void {
    this.db.prepare('DELETE FROM routing_connection_catalogs WHERE connection_id=?').run(connectionId)
    const row = this.db.prepare('SELECT policy_json FROM routing_policy_v3 WHERE singleton_id=1').get() as { policy_json?: string } | undefined
    if (!row?.policy_json) return
    const policy = JSON.parse(row.policy_json) as { profiles?: Array<Record<string, unknown>> }
    if (!Array.isArray(policy.profiles)) return
    policy.profiles = policy.profiles.map((profile) => profile.connectionId === connectionId ? {
      ...profile,
      enabled: false,
      effort: null,
      readiness: { state: 'unchecked', checkedAt: null, expiresAt: null, adapterVersion: null, installedVersion: null, reasonCode: 'CONNECTION_CHANGED' },
    } : profile)
    this.db.prepare('UPDATE routing_policy_v3 SET policy_json=? WHERE singleton_id=1').run(JSON.stringify(policy))
  }
}

function validateConnection(value: RoutingConnectionDto): void {
  if (!SAFE_ID.test(value.id) || !value.displayName.trim() || Object.keys(value.config).some((key) => FORBIDDEN_CONFIG_KEY.test(key))) throw new Error('ROUTING_CONNECTION_INVALID')
  if (JSON.stringify(value.config).length > 16_384) throw new Error('ROUTING_CONNECTION_INVALID')
  if (value.enabled && value.authState !== 'ready') throw new Error('ROUTING_CONNECTION_NOT_READY')
  if (value.secretRef !== null && !/^routing-secret:[A-Za-z0-9:._/-]+$/.test(value.secretRef)) throw new Error('ROUTING_CONNECTION_INVALID')
}

function connectionFromRow(row: Record<string, unknown>): RoutingConnectionDto {
  return {
    id: String(row.id), adapterId: String(row.adapter_id) as RoutingConnectionDto['adapterId'], displayName: String(row.display_name), enabled: Boolean(row.enabled),
    authMode: String(row.auth_mode) as RoutingConnectionDto['authMode'], authState: String(row.auth_state) as RoutingConnectionDto['authState'],
    installedVersion: row.installed_version ? String(row.installed_version) : null, supportedRange: row.supported_range ? String(row.supported_range) : null,
    readinessCheckedAt: row.readiness_checked_at ? String(row.readiness_checked_at) : null, catalogRefreshedAt: row.catalog_refreshed_at ? String(row.catalog_refreshed_at) : null,
    config: JSON.parse(String(row.config_json)) as Record<string, unknown>, secretRef: row.secret_ref ? String(row.secret_ref) : null,
  }
}

function connectionIdentityChanged(left: RoutingConnectionDto, right: RoutingConnectionDto): boolean {
  return left.adapterId !== right.adapterId || left.authMode !== right.authMode || left.secretRef !== right.secretRef || JSON.stringify(left.config) !== JSON.stringify(right.config)
}
