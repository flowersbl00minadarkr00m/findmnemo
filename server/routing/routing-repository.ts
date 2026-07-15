import type { DatabaseSync } from 'node:sqlite'
import type { ActualRouteSnapshot, DestinationModelCatalogDto, OperationalPolicyMigrationPreview, OperationalPolicyV3MigrationPreview, OperationalRoutingPolicy, OperationalRoutingPolicyV3, ProfileReadinessResultDto, RequestedProfileSnapshot, RouteEvidenceDto, RoutingClassificationSource, RoutingConnectionDto, RoutingDispatchChainDto, RoutingDispatchReceiptDto, RoutingDispatchReceiptV2Dto, RoutingDispatchState, RoutingExecutionProfile, RoutingReturnState } from '../../shared/companion-contract.js'
import { assertPrivateBoundary } from '../db/operational-repository.js'
import { validateOperationalPolicyForCompanion } from './routing-policy.js'
import { validateRoutingPolicyV3 } from './routing-policy-v3.js'

export type RoutingPolicyWriteResult =
  | { status: 'saved'; policy: OperationalRoutingPolicy }
  | { status: 'conflict'; current: OperationalRoutingPolicy | null }

export type RoutingPolicyV3WriteResult =
  | { status: 'saved'; policy: OperationalRoutingPolicyV3 }
  | { status: 'conflict'; current: OperationalRoutingPolicyV3 | null }

export interface CreateDispatchReceiptInput {
  id: string; idempotencyKey: string; generation: number; priorReceiptId: string | null
  origin: RoutingDispatchReceiptDto['origin']; capabilityIds: string[]; classificationSource: RoutingClassificationSource
  policyVersion: number; requestedProfileSnapshot: RequestedProfileSnapshot; createdAt: string; requestHash: string
}

export interface CreateDispatchReceiptV2Input extends CreateDispatchReceiptInput {
  requestedRoute: RouteEvidenceDto
  fallbackFromProfileIds: string[]
  chain: RoutingDispatchChainDto
}

export class RoutingRepository {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) { this.db = db }

  readPolicy(): OperationalRoutingPolicy | null {
    const envelope = this.db.prepare('SELECT * FROM routing_policy WHERE singleton_id=1').get() as Record<string, unknown> | undefined
    if (!envelope) return null
    const profiles = this.db.prepare('SELECT * FROM routing_profiles ORDER BY fallback_order,profile_id').all() as Array<Record<string, unknown>>
    return {
      schemaVersion: '2.0.0',
      policyProfile: 'findmnemo.model-routing.v2',
      policyVersion: Number(envelope.policy_version),
      updatedAt: String(envelope.updated_at),
      capabilities: JSON.parse(String(envelope.capabilities_json)) as OperationalRoutingPolicy['capabilities'],
      profiles: profiles.map(readProfile),
      defaultProfileOrder: JSON.parse(String(envelope.default_order_json)) as string[],
      capabilityOverrides: JSON.parse(String(envelope.overrides_json)) as OperationalRoutingPolicy['capabilityOverrides'],
    }
  }

  readPolicyV3(): OperationalRoutingPolicyV3 | null {
    const row = this.db.prepare('SELECT policy_json FROM routing_policy_v3 WHERE singleton_id=1').get() as { policy_json?: string } | undefined
    return row?.policy_json ? JSON.parse(row.policy_json) as OperationalRoutingPolicyV3 : null
  }

  compareAndSetPolicyV3(input: OperationalRoutingPolicyV3, expectedPolicyVersion: number | null, connections: readonly RoutingConnectionDto[]): RoutingPolicyV3WriteResult {
    const validation = validateRoutingPolicyV3(input, connections)
    if (!validation.valid || !validation.policy) throw new Error('ROUTING_POLICY_INVALID')
    assertPrivateBoundary(input)
    return this.transaction(() => {
      const current = this.readPolicyV3()
      if ((current?.policyVersion ?? null) !== expectedPolicyVersion) return { status: 'conflict', current }
      const policy = { ...validation.policy!, policyVersion: (current?.policyVersion ?? 0) + 1 }
      this.db.prepare(`INSERT INTO routing_policy_v3(singleton_id,policy_version,updated_at,policy_json) VALUES(1,?,?,?)
        ON CONFLICT(singleton_id) DO UPDATE SET policy_version=excluded.policy_version,updated_at=excluded.updated_at,policy_json=excluded.policy_json`)
        .run(policy.policyVersion, policy.updatedAt, JSON.stringify(policy))
      return { status: 'saved', policy }
    })
  }

  previewMigrationV3(preview: OperationalPolicyV3MigrationPreview, connections: readonly RoutingConnectionDto[]): OperationalPolicyV3MigrationPreview {
    const current = this.readPolicyV3()
    const policy = { ...preview.policy, policyVersion: (current?.policyVersion ?? 0) + 1 }
    if (!preview.sourcePolicyRevision || !validateRoutingPolicyV3(policy, connections).valid) throw new Error('ROUTING_MIGRATION_INVALID')
    return { ...preview, policy }
  }

  commitMigrationV3(preview: OperationalPolicyV3MigrationPreview, connections: readonly RoutingConnectionDto[], createdAt: string): OperationalRoutingPolicyV3 {
    const normalized = this.previewMigrationV3(preview, connections)
    const migrationId = `v3:${preview.sourcePolicyRevision}`
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT result_json FROM routing_policy_migrations WHERE source_policy_revision=?').get(migrationId) as { result_json?: string } | undefined
      if (prior?.result_json) return JSON.parse(prior.result_json) as OperationalRoutingPolicyV3
      const current = this.readPolicyV3()
      if (current) throw new Error('ROUTING_POLICY_EXISTS')
      this.db.prepare('INSERT INTO routing_policy_v3(singleton_id,policy_version,updated_at,policy_json) VALUES(1,?,?,?)').run(normalized.policy.policyVersion, normalized.policy.updatedAt, JSON.stringify(normalized.policy))
      this.db.prepare('INSERT INTO routing_policy_migrations(source_policy_revision,policy_version,result_json,created_at) VALUES(?,?,?,?)').run(migrationId, normalized.policy.policyVersion, JSON.stringify(normalized.policy), createdAt)
      return normalized.policy
    })
  }

  compareAndSetPolicy(input: OperationalRoutingPolicy, expectedPolicyVersion: number | null): RoutingPolicyWriteResult {
    const validation = validateOperationalPolicyForCompanion(input)
    if (!validation.valid || !validation.policy) throw new Error('ROUTING_POLICY_INVALID')
    const validatedPolicy = validation.policy
    assertPrivateBoundary(input)
    return this.transaction(() => {
      const current = this.readPolicy()
      if ((current?.policyVersion ?? null) !== expectedPolicyVersion) return { status: 'conflict', current }
      const policy: OperationalRoutingPolicy = {
        ...validatedPolicy,
        policyVersion: (current?.policyVersion ?? 0) + 1,
      }
      this.persist(policy)
      return { status: 'saved', policy }
    })
  }

  previewMigration(preview: OperationalPolicyMigrationPreview): OperationalPolicyMigrationPreview {
    if (!preview.sourcePolicyRevision || !validateOperationalPolicyForCompanion(preview.policy).valid) throw new Error('ROUTING_MIGRATION_INVALID')
    assertPrivateBoundary(preview)
    const current = this.readPolicy()
    return { ...preview, policy: { ...preview.policy, policyVersion: (current?.policyVersion ?? 0) + 1 } }
  }

  commitMigration(preview: OperationalPolicyMigrationPreview, createdAt: string): OperationalRoutingPolicy {
    const normalized = this.previewMigration(preview)
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT result_json FROM routing_policy_migrations WHERE source_policy_revision=?').get(preview.sourcePolicyRevision) as { result_json?: string } | undefined
      if (prior?.result_json) return JSON.parse(prior.result_json) as OperationalRoutingPolicy
      const current = this.readPolicy()
      if (current) throw new Error('ROUTING_POLICY_EXISTS')
      this.persist(normalized.policy)
      this.db.prepare('INSERT INTO routing_policy_migrations(source_policy_revision,policy_version,result_json,created_at) VALUES(?,?,?,?)')
        .run(preview.sourcePolicyRevision, normalized.policy.policyVersion, JSON.stringify(normalized.policy), createdAt)
      return normalized.policy
    })
  }

  exportV1Compatible(): Record<string, unknown> | null {
    const policy = this.readPolicy()
    if (!policy) return null
    return {
      schemaVersion: '1.0.0', policyProfile: 'findmnemo.model-routing.v1',
      producer: { productName: 'FindMnemo', productId: 'findmnemo' }, catalogVersion: '1.0.0', updatedAt: policy.updatedAt,
      routes: policy.profiles.map((profile) => ({ id: profile.id, displayName: profile.displayName, provider: profile.providerId ?? '', model: profile.modelId, surface: profile.destinationAdapterId, kind: 'custom', enabled: profile.enabled, availability: { state: profile.readiness.state === 'ready' ? 'available' : 'unavailable', confirmedAt: profile.readiness.checkedAt ?? policy.updatedAt }, capabilityIds: profile.capabilityIds })),
      capabilities: policy.capabilities, defaultRouteOrder: policy.defaultProfileOrder,
      capabilityOverrides: policy.capabilityOverrides.map((override) => ({ capabilityId: override.capabilityId, routeOrder: override.profileOrder })),
    }
  }

  saveCatalog(catalog: DestinationModelCatalogDto): void {
    assertPrivateBoundary(catalog)
    this.db.prepare(`INSERT INTO routing_model_catalogs(adapter_id,adapter_version,installed_version,checked_at,expires_at,models_json)
      VALUES(?,?,?,?,?,?) ON CONFLICT(adapter_id) DO UPDATE SET adapter_version=excluded.adapter_version,installed_version=excluded.installed_version,checked_at=excluded.checked_at,expires_at=excluded.expires_at,models_json=excluded.models_json`)
      .run(catalog.adapterId, catalog.adapterVersion, catalog.installedVersion, catalog.checkedAt, catalog.expiresAt, JSON.stringify(catalog.models))
  }

  readCatalog(adapterId: string): DestinationModelCatalogDto | null {
    const row = this.db.prepare('SELECT * FROM routing_model_catalogs WHERE adapter_id=?').get(adapterId) as Record<string, unknown> | undefined
    return row ? { adapterId: String(row.adapter_id), adapterVersion: String(row.adapter_version), installedVersion: String(row.installed_version), checkedAt: String(row.checked_at), expiresAt: String(row.expires_at), models: JSON.parse(String(row.models_json)) as DestinationModelCatalogDto['models'] } : null
  }

  applyReadiness(profileId: string, readiness: ProfileReadinessResultDto, expectedPolicyVersion: number): RoutingPolicyWriteResult {
    const current = this.readPolicy()
    if (!current || current.policyVersion !== expectedPolicyVersion) return { status: 'conflict', current }
    if (!current.profiles.some((profile) => profile.id === profileId)) throw new Error('ROUTING_PROFILE_NOT_FOUND')
    const next: OperationalRoutingPolicy = {
      ...current,
      updatedAt: readiness.checkedAt,
      profiles: current.profiles.map((profile) => profile.id === profileId ? { ...profile, readiness: { state: readiness.state, checkedAt: readiness.checkedAt, expiresAt: readiness.expiresAt, adapterVersion: readiness.adapterVersion, installedVersion: readiness.installedVersion, reasonCode: readiness.reasonCode } } : profile),
    }
    return this.compareAndSetPolicy(next, expectedPolicyVersion)
  }

  createDispatchReceipt(input: CreateDispatchReceiptInput): { created: boolean; receipt: RoutingDispatchReceiptDto } {
    assertPrivateBoundary(input)
    return this.transaction(() => {
      const existing = this.findDispatchByIdempotencyKey(input.idempotencyKey)
      if (existing) return { created: false, receipt: existing }
      this.db.prepare(`INSERT INTO routing_dispatch_receipts(id,idempotency_key,generation,prior_receipt_id,origin_adapter_id,correlation_id,conversation_ref_hash,capability_ids_json,classification_source,policy_version,requested_profile_json,state,return_state,created_at,accepted_at,request_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'requested','pending',?,NULL,?)`)
        .run(input.id, input.idempotencyKey, input.generation, input.priorReceiptId, input.origin.adapterId, input.origin.correlationId, input.origin.conversationRefHash, JSON.stringify(input.capabilityIds), input.classificationSource, input.policyVersion, JSON.stringify(input.requestedProfileSnapshot), input.createdAt, input.requestHash)
      const receipt = this.getDispatchReceipt(input.id)
      if (!receipt) throw new Error('ROUTING_RECEIPT_WRITE_FAILED')
      return { created: true, receipt }
    })
  }

  createDispatchReceiptV2(input: CreateDispatchReceiptV2Input): { created: boolean; receipt: RoutingDispatchReceiptV2Dto } {
    assertPrivateBoundary(input)
    if (input.chain.depth < 0 || input.chain.depth > 1 || !input.chain.id || input.requestedRoute.verification !== 'requested-unverified') throw new Error('ROUTING_RECEIPT_INVALID')
    const base = this.createDispatchReceipt(input)
    if (base.created) {
      this.db.prepare(`UPDATE routing_dispatch_receipts SET requested_route_json=?,fallback_profile_ids_json=?,chain_id=?,chain_depth=?,parent_dispatch_id=? WHERE id=?`)
        .run(JSON.stringify(input.requestedRoute), JSON.stringify(input.fallbackFromProfileIds), input.chain.id, input.chain.depth, input.chain.parentDispatchId, input.id)
    }
    const receipt = this.getDispatchReceiptV2(base.receipt.id)
    if (!receipt) throw new Error('ROUTING_RECEIPT_WRITE_FAILED')
    return { created: base.created, receipt }
  }

  getDispatchReceiptV2(id: string): RoutingDispatchReceiptV2Dto | null {
    const row = this.db.prepare('SELECT * FROM routing_dispatch_receipts WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? readReceiptV2(row) : null
  }

  updateDispatchReceiptV2(id: string, update: { outcome?: RoutingDispatchState; actualRoute?: RouteEvidenceDto | null; fallbackFromProfileIds?: string[]; startedAt?: string | null; finishedAt?: string | null; failureCode?: string | null }): RoutingDispatchReceiptV2Dto {
    assertPrivateBoundary(update)
    const current = this.getDispatchReceiptV2(id)
    if (!current) throw new Error('ROUTING_RECEIPT_NOT_FOUND')
    const next = {
      ...current,
      ...update,
      timing: { ...current.timing, startedAt: update.startedAt === undefined ? current.timing.startedAt : update.startedAt, finishedAt: update.finishedAt === undefined ? current.timing.finishedAt : update.finishedAt },
    }
    this.db.prepare(`UPDATE routing_dispatch_receipts SET state=?,actual_route_evidence_json=?,fallback_profile_ids_json=?,started_at=?,finished_at=?,failure_code=? WHERE id=?`)
      .run(next.outcome, next.actualRoute === null ? null : JSON.stringify(next.actualRoute), JSON.stringify(next.fallbackFromProfileIds), next.timing.startedAt, next.timing.finishedAt, next.failureCode, id)
    return this.getDispatchReceiptV2(id) as RoutingDispatchReceiptV2Dto
  }

  getDispatchReceipt(id: string): RoutingDispatchReceiptDto | null {
    const row = this.db.prepare('SELECT * FROM routing_dispatch_receipts WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? readReceipt(row) : null
  }

  findDispatchByIdempotencyKey(idempotencyKey: string): RoutingDispatchReceiptDto | null {
    const row = this.db.prepare('SELECT * FROM routing_dispatch_receipts WHERE idempotency_key=?').get(idempotencyKey) as Record<string, unknown> | undefined
    return row ? readReceipt(row) : null
  }

  listDispatchReceipts(limit = 50): RoutingDispatchReceiptDto[] {
    const rows = this.db.prepare('SELECT * FROM routing_dispatch_receipts ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(100, limit))) as Array<Record<string, unknown>>
    return rows.map(readReceipt)
  }

  updateDispatchReceipt(id: string, update: { state?: RoutingDispatchState; returnState?: RoutingReturnState; actualRoute?: ActualRouteSnapshot | null; acceptedAt?: string | null; startedAt?: string | null; finishedAt?: string | null; failureCode?: string | null; resultHash?: string | null }): RoutingDispatchReceiptDto {
    assertPrivateBoundary(update)
    const current = this.getDispatchReceipt(id)
    if (!current) throw new Error('ROUTING_RECEIPT_NOT_FOUND')
    const next = { ...current, ...update }
    this.db.prepare(`UPDATE routing_dispatch_receipts SET state=?,return_state=?,actual_route_json=?,accepted_at=?,started_at=?,finished_at=?,failure_code=?,result_hash=? WHERE id=?`)
      .run(next.state, next.returnState, next.actualRoute === null ? null : JSON.stringify(next.actualRoute), next.acceptedAt, next.startedAt, next.finishedAt, next.failureCode, next.resultHash, id)
    return this.getDispatchReceipt(id) as RoutingDispatchReceiptDto
  }

  recoverInterruptedDispatches(finishedAt: string): number {
    return Number(this.db.prepare("UPDATE routing_dispatch_receipts SET state='failed',return_state='return-unavailable',finished_at=?,failure_code='COMPANION_RESTARTED' WHERE state IN ('requested','accepted','running')").run(finishedAt).changes)
  }

  private persist(policy: OperationalRoutingPolicy): void {
    this.db.prepare(`INSERT INTO routing_policy(singleton_id,schema_version,policy_profile,policy_version,updated_at,capabilities_json,default_order_json,overrides_json)
      VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(singleton_id) DO UPDATE SET schema_version=excluded.schema_version,policy_profile=excluded.policy_profile,policy_version=excluded.policy_version,updated_at=excluded.updated_at,capabilities_json=excluded.capabilities_json,default_order_json=excluded.default_order_json,overrides_json=excluded.overrides_json`)
      .run(policy.schemaVersion, policy.policyProfile, policy.policyVersion, policy.updatedAt, JSON.stringify(policy.capabilities), JSON.stringify(policy.defaultProfileOrder), JSON.stringify(policy.capabilityOverrides))
    this.db.prepare('DELETE FROM routing_profiles').run()
    const insert = this.db.prepare(`INSERT INTO routing_profiles(profile_id,policy_version,display_name,destination_adapter_id,destination_instance_id,provider_id,model_id,effort,capability_ids_json,enabled,behavior,fallback_order,readiness_state,readiness_checked_at,readiness_expires_at,adapter_version,installed_version,readiness_reason_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    for (const profile of policy.profiles) insert.run(profile.id, policy.policyVersion, profile.displayName, profile.destinationAdapterId, profile.destinationInstanceId, profile.providerId, profile.modelId, profile.effort, JSON.stringify(profile.capabilityIds), profile.enabled ? 1 : 0, profile.behavior, profile.fallbackOrder, profile.readiness.state, profile.readiness.checkedAt, profile.readiness.expiresAt, profile.readiness.adapterVersion, profile.readiness.installedVersion, profile.readiness.reasonCode)
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result } catch (cause) { this.db.exec('ROLLBACK'); throw cause }
  }
}

function readProfile(row: Record<string, unknown>): RoutingExecutionProfile {
  return {
    id: String(row.profile_id), displayName: String(row.display_name), destinationAdapterId: String(row.destination_adapter_id), destinationInstanceId: String(row.destination_instance_id),
    providerId: row.provider_id === null ? null : String(row.provider_id), modelId: String(row.model_id), effort: row.effort === null ? null : String(row.effort),
    capabilityIds: JSON.parse(String(row.capability_ids_json)) as string[], enabled: Number(row.enabled) === 1, behavior: String(row.behavior) as RoutingExecutionProfile['behavior'], fallbackOrder: Number(row.fallback_order),
    readiness: { state: String(row.readiness_state) as RoutingExecutionProfile['readiness']['state'], checkedAt: row.readiness_checked_at === null ? null : String(row.readiness_checked_at), expiresAt: row.readiness_expires_at === null ? null : String(row.readiness_expires_at), adapterVersion: row.adapter_version === null ? null : String(row.adapter_version), installedVersion: row.installed_version === null ? null : String(row.installed_version), reasonCode: row.readiness_reason_code === null ? null : String(row.readiness_reason_code) },
  }
}

function readReceipt(row: Record<string, unknown>): RoutingDispatchReceiptDto {
  return {
    id: String(row.id), idempotencyKey: String(row.idempotency_key), generation: Number(row.generation), priorReceiptId: row.prior_receipt_id === null ? null : String(row.prior_receipt_id),
    origin: { adapterId: String(row.origin_adapter_id), correlationId: String(row.correlation_id), conversationRefHash: row.conversation_ref_hash === null ? null : String(row.conversation_ref_hash) },
    capabilityIds: JSON.parse(String(row.capability_ids_json)) as string[], classificationSource: String(row.classification_source) as RoutingClassificationSource,
    policyVersion: Number(row.policy_version), requestedProfileSnapshot: JSON.parse(String(row.requested_profile_json)) as RequestedProfileSnapshot,
    actualRoute: row.actual_route_json === null ? null : JSON.parse(String(row.actual_route_json)) as ActualRouteSnapshot,
    state: String(row.state) as RoutingDispatchState, returnState: String(row.return_state) as RoutingReturnState,
    createdAt: String(row.created_at), acceptedAt: row.accepted_at === null ? null : String(row.accepted_at), startedAt: row.started_at === null ? null : String(row.started_at), finishedAt: row.finished_at === null ? null : String(row.finished_at),
    failureCode: row.failure_code === null ? null : String(row.failure_code), requestHash: String(row.request_hash), resultHash: row.result_hash === null ? null : String(row.result_hash),
  }
}

function readReceiptV2(row: Record<string, unknown>): RoutingDispatchReceiptV2Dto | null {
  if (row.requested_route_json === null || row.requested_route_json === undefined || row.chain_id === null || row.chain_id === undefined) return null
  return {
    id: String(row.id),
    policyVersion: Number(row.policy_version),
    requestedRoute: JSON.parse(String(row.requested_route_json)) as RouteEvidenceDto,
    actualRoute: row.actual_route_evidence_json === null ? null : JSON.parse(String(row.actual_route_evidence_json)) as RouteEvidenceDto,
    fallbackFromProfileIds: JSON.parse(String(row.fallback_profile_ids_json)) as string[],
    outcome: String(row.state) as RoutingDispatchState,
    timing: { acceptedAt: row.accepted_at === null ? null : String(row.accepted_at), startedAt: row.started_at === null ? null : String(row.started_at), finishedAt: row.finished_at === null ? null : String(row.finished_at) },
    failureCode: row.failure_code === null ? null : String(row.failure_code),
    chain: { id: String(row.chain_id), depth: Number(row.chain_depth), parentDispatchId: row.parent_dispatch_id === null ? null : String(row.parent_dispatch_id) },
  }
}
