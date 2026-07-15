import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { OperationalRoutingPolicy, OperationalRoutingPolicyV3, RouteEvidenceDto, RoutingClassificationSource, RoutingConnectionDto, RoutingDispatchChainDto, RoutingDispatchReceiptDto, RoutingExecutionProfile, RoutingProfileV3, RoutingRequestOverride } from '../../shared/companion-contract.js'
import type { AdapterConnectionContext, DestinationAdapter, DestinationExecutionEvent } from './adapter-contract.js'
import { RoutingConnectionRepository } from './connection-repository.js'
import { ProjectContextResolver } from './project-context-resolver.js'
import { validateOperationalPolicyForCompanion } from './routing-policy.js'
import { RoutingRepository } from './routing-repository.js'

export interface DispatchRequest {
  idempotencyKey: string
  origin: RoutingDispatchReceiptDto['origin']
  capabilityIds: string[]
  classificationSource: RoutingClassificationSource
  classificationAmbiguous: boolean
  override: RoutingRequestOverride
  task: string
  timeoutMs?: number
  retryOfReceiptId?: string
  projectFolderId?: string
  chain?: RoutingDispatchChainDto
}

export interface DispatchResult {
  disposition: 'completed' | 'existing' | 'decision-required' | 'unavailable' | 'failed' | 'cancelled' | 'timed-out'
  receipt?: RoutingDispatchReceiptDto
  output?: string
  reasonCode?: string
}

export interface RoutingPreflightDecision {
  disposition: 'auto-dispatch-eligible' | 'recommend' | 'decision-required' | 'unavailable' | 'self-handled'
  reasonCode: string
  policyVersion: number | null
  profile?: ReturnType<typeof snapshot>
}

export class DispatchService {
  private readonly adapters: Map<string, DestinationAdapter>
  private readonly active = new Map<string, AbortController>()
  private readonly results = new Map<string, { text: string; expiresAt: number }>()
  private readonly retryableRequests = new Map<string, { request: DispatchRequest; expiresAt: number }>()
  private readonly repository: RoutingRepository
  private readonly connections?: RoutingConnectionRepository
  private readonly projectContexts?: ProjectContextResolver
  private readonly clock: () => Date

  constructor(repository: RoutingRepository, adapters: readonly DestinationAdapter[], clock: () => Date = () => new Date(), options: { connections?: RoutingConnectionRepository; projectContexts?: ProjectContextResolver } = {}) {
    this.repository = repository
    this.clock = clock
    this.adapters = new Map(adapters.map((adapter) => [adapter.manifest.adapterId, adapter]))
    this.connections = options.connections
    this.projectContexts = options.projectContexts
    this.repository.recoverInterruptedDispatches(this.clock().toISOString())
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    if (!request.idempotencyKey || !request.task || request.task.length > 200_000) return { disposition: 'failed', reasonCode: 'INVALID_REQUEST' }
    if ((request.chain?.depth ?? 0) >= 1) return { disposition: 'failed', reasonCode: 'recursive-dispatch-blocked' }
    const existing = this.repository.findDispatchByIdempotencyKey(request.idempotencyKey)
    if (existing) return this.existing(existing)
    const policyV3 = this.repository.readPolicyV3()
    if (policyV3 && this.connections && this.projectContexts) return this.dispatchV3(policyV3, request)
    const policy = this.repository.readPolicy()
    if (!policy || !validateOperationalPolicyForCompanion(policy).valid) return { disposition: 'unavailable', reasonCode: 'ROUTING_POLICY_INVALID' }
    const normalizedRequest = { ...request, capabilityIds: normalizeCapabilityIds(policy, request.capabilityIds) }
    const selection = selectProfile(policy.profiles, policy.defaultProfileOrder, policy.capabilityOverrides, normalizedRequest, this.clock().getTime())
    if (!selection.profile) return { disposition: selection.decision ? 'decision-required' : 'unavailable', reasonCode: selection.reasonCode }
    const adapter = this.adapters.get(selection.profile.destinationAdapterId)
    if (!adapter?.execute) return { disposition: 'unavailable', reasonCode: 'ADAPTER_NOT_CONTROLLABLE' }
    const now = this.clock().toISOString()
    const prior = request.retryOfReceiptId ? this.repository.getDispatchReceipt(request.retryOfReceiptId) : null
    if (request.retryOfReceiptId && (!prior || !['failed', 'timed-out', 'cancelled'].includes(prior.state))) return { disposition: 'failed', reasonCode: 'RETRY_NOT_ALLOWED' }
    const created = this.repository.createDispatchReceipt({
      id: randomUUID(), idempotencyKey: request.idempotencyKey, generation: (prior?.generation ?? 0) + 1, priorReceiptId: prior?.id ?? null, origin: request.origin,
      capabilityIds: normalizedRequest.capabilityIds, classificationSource: request.classificationSource, policyVersion: policy.policyVersion,
      requestedProfileSnapshot: snapshot(selection.profile), createdAt: now, requestHash: hash(request.task),
    })
    if (!created.created) return this.existing(created.receipt)
    this.retryableRequests.set(created.receipt.id, {
      request: { ...request, origin: { ...request.origin }, capabilityIds: [...request.capabilityIds], override: structuredClone(request.override) },
      expiresAt: this.clock().getTime() + 5 * 60_000,
    })
    const controller = new AbortController()
    this.active.set(created.receipt.id, controller)
    const timer = setTimeout(() => controller.abort('timeout'), Math.max(100, Math.min(10 * 60_000, request.timeoutMs ?? 120_000)))
    let receipt = created.receipt
    try {
      receipt = this.repository.updateDispatchReceipt(receipt.id, { state: 'accepted', acceptedAt: this.clock().toISOString() })
      receipt = this.repository.updateDispatchReceipt(receipt.id, { state: 'running', startedAt: this.clock().toISOString() })
      let output: string | undefined
      for await (const event of adapter.execute(selection.profile, request.task, controller.signal)) {
        if (event.type === 'failed') throw new Error(event.code)
        receipt = this.repository.updateDispatchReceipt(receipt.id, { actualRoute: event.actualRoute })
        if (!sameRoute(snapshot(selection.profile), event.actualRoute)) throw new Error('ACTUAL_ROUTE_MISMATCH')
        if (event.type === 'completed') output = event.text
      }
      if (output === undefined) throw new Error('DESTINATION_RESULT_MALFORMED')
      if (Buffer.byteLength(output, 'utf8') > 1_000_000) throw new Error('DESTINATION_OUTPUT_LIMIT')
      const finishedAt = this.clock().toISOString()
      receipt = this.repository.updateDispatchReceipt(receipt.id, { state: 'completed', finishedAt, resultHash: hash(output) })
      this.results.set(receipt.id, { text: output, expiresAt: this.clock().getTime() + 5 * 60_000 })
      return { disposition: 'completed', receipt, output }
    } catch (cause) {
      const aborted = controller.signal.aborted
      const timedOut = controller.signal.reason === 'timeout'
      const state = timedOut ? 'timed-out' : aborted ? 'cancelled' : 'failed'
      const failureCode = timedOut ? 'DESTINATION_TIMEOUT' : aborted ? 'DISPATCH_CANCELLED' : boundedCode(cause)
      receipt = this.repository.updateDispatchReceipt(receipt.id, { state, returnState: 'return-unavailable', finishedAt: this.clock().toISOString(), failureCode })
      return { disposition: state, receipt, reasonCode: failureCode }
    } finally { clearTimeout(timer); this.active.delete(receipt.id) }
  }

  private async dispatchV3(policy: OperationalRoutingPolicyV3, request: DispatchRequest): Promise<DispatchResult> {
    const normalizedCapabilityIds = normalizeCapabilityIdsV3(policy, request.capabilityIds)
    const selection = selectProfilesV3(policy, normalizedCapabilityIds, request)
    if (selection.decision) return { disposition: 'decision-required', reasonCode: selection.reasonCode }
    if (!selection.profiles.length) return { disposition: selection.decision ? 'decision-required' : 'unavailable', reasonCode: selection.reasonCode }

    const nowMs = this.clock().getTime()
    const eligible = selection.profiles.map((profile) => this.qualifyV3(profile, nowMs)).filter((value): value is QualifiedV3Profile => value !== null)
    if (!eligible.length) return { disposition: 'unavailable', reasonCode: 'NO_READY_EXECUTABLE_ROUTE' }

    const prior = request.retryOfReceiptId ? this.repository.getDispatchReceipt(request.retryOfReceiptId) : null
    if (request.retryOfReceiptId && (!prior || !['failed', 'timed-out', 'cancelled'].includes(prior.state))) return { disposition: 'failed', reasonCode: 'RETRY_NOT_ALLOWED' }
    const selected = eligible[0]
    const createdAt = this.clock().toISOString()
    const chain = request.chain ?? { id: randomUUID(), depth: 0, parentDispatchId: null }
    const requestedRoute = routeEvidence(selected.profile, selected.connection, 'requested-unverified')
    const created = this.repository.createDispatchReceiptV2({
      id: randomUUID(), idempotencyKey: request.idempotencyKey, generation: (prior?.generation ?? 0) + 1, priorReceiptId: prior?.id ?? null,
      origin: request.origin, capabilityIds: normalizedCapabilityIds, classificationSource: request.classificationSource, policyVersion: policy.policyVersion,
      requestedProfileSnapshot: snapshotV3(selected.profile, selected.connection, selection.assignmentBehavior), requestedRoute, fallbackFromProfileIds: [], chain,
      createdAt, requestHash: hash(request.task),
    })
    if (!created.created) return this.existing(this.repository.getDispatchReceipt(created.receipt.id)!)
    let receipt = this.repository.getDispatchReceipt(created.receipt.id)!
    this.retryableRequests.set(receipt.id, { request: { ...request, origin: { ...request.origin }, capabilityIds: [...request.capabilityIds], override: structuredClone(request.override) }, expiresAt: nowMs + 5 * 60_000 })
    const controller = new AbortController()
    this.active.set(receipt.id, controller)
    const timer = setTimeout(() => controller.abort('timeout'), Math.max(100, Math.min(10 * 60_000, request.timeoutMs ?? 120_000)))
    const fallbackFromProfileIds: string[] = []
    let lastFailure = 'DESTINATION_FAILED'
    try {
      receipt = this.repository.updateDispatchReceipt(receipt.id, { state: 'accepted', acceptedAt: this.clock().toISOString() })
      this.repository.updateDispatchReceiptV2(receipt.id, { outcome: 'accepted' })
      for (const candidate of eligible) {
        if (candidate !== selected) fallbackFromProfileIds.push(eligible[eligible.indexOf(candidate) - 1].profile.id)
        receipt = this.repository.updateDispatchReceipt(receipt.id, { state: 'running', startedAt: receipt.startedAt ?? this.clock().toISOString(), failureCode: null })
        this.repository.updateDispatchReceiptV2(receipt.id, { outcome: 'running', fallbackFromProfileIds, startedAt: receipt.startedAt })
        try {
          const result = await this.executeV3Candidate(candidate, request, chain, controller.signal)
          if (Buffer.byteLength(result.output, 'utf8') > 1_000_000) throw new Error('DESTINATION_OUTPUT_LIMIT')
          const finishedAt = this.clock().toISOString()
          const actualEvidence = destinationEvidence(candidate, result.actualRoute)
          receipt = this.repository.updateDispatchReceipt(receipt.id, { state: 'completed', finishedAt, resultHash: hash(result.output), actualRoute: legacyActualRoute(actualEvidence) })
          this.repository.updateDispatchReceiptV2(receipt.id, { outcome: 'completed', actualRoute: actualEvidence, fallbackFromProfileIds, finishedAt, failureCode: null })
          this.results.set(receipt.id, { text: result.output, expiresAt: this.clock().getTime() + 5 * 60_000 })
          return { disposition: 'completed', receipt, output: result.output }
        } catch (cause) {
          if (controller.signal.aborted) throw cause
          lastFailure = boundedCode(cause)
        }
      }
      throw new Error(lastFailure)
    } catch (cause) {
      const timedOut = controller.signal.reason === 'timeout'
      const cancelled = controller.signal.aborted && !timedOut
      const state = timedOut ? 'timed-out' : cancelled ? 'cancelled' : 'failed'
      const failureCode = timedOut ? 'DESTINATION_TIMEOUT' : cancelled ? 'DISPATCH_CANCELLED' : boundedCode(cause)
      const finishedAt = this.clock().toISOString()
      receipt = this.repository.updateDispatchReceipt(receipt.id, { state, returnState: 'return-unavailable', finishedAt, failureCode })
      this.repository.updateDispatchReceiptV2(receipt.id, { outcome: state, fallbackFromProfileIds, finishedAt, failureCode })
      return { disposition: state, receipt, reasonCode: failureCode }
    } finally { clearTimeout(timer); this.active.delete(receipt.id) }
  }

  private qualifyV3(profile: RoutingProfileV3, nowMs: number): QualifiedV3Profile | null {
    if (profile.kind !== 'executable' || !profile.enabled || !profile.connectionId || profile.readiness.state !== 'ready' || !profile.readiness.expiresAt || Date.parse(profile.readiness.expiresAt) <= nowMs) return null
    const connection = this.connections?.get(profile.connectionId)
    if (!connection?.enabled || connection.authState !== 'ready' || !connection.readinessCheckedAt) return null
    const catalog = this.connections?.readCatalog(connection.id)
    if (!catalog || Date.parse(catalog.expiresAt) <= nowMs || !catalog.models.some((model) => model.modelId === profile.modelId && (profile.effort === null || model.supportedEfforts.includes(profile.effort)))) return null
    const adapter = this.adapters.get(connection.adapterId)
    return adapter?.executeConnectionProfile ? { profile, connection, adapter } : null
  }

  private async executeV3Candidate(candidate: QualifiedV3Profile, request: DispatchRequest, chain: RoutingDispatchChainDto, signal: AbortSignal): Promise<{ output: string; actualRoute: ActualExecutionRoute }> {
    const projectContext = await this.projectContexts!.resolve(request.projectFolderId)
    const context: AdapterConnectionContext = { connection: candidate.connection, projectContext, dispatchChain: { id: chain.id, depth: 1, token: randomBytes(32).toString('base64url') } }
    let output: string | undefined
    let actualRoute: ActualExecutionRoute | undefined
    for await (const event of candidate.adapter.executeConnectionProfile!(candidate.profile, request.task, context, signal)) {
      if (event.type === 'failed') throw new Error(event.code)
      actualRoute = event.actualRoute
      if (event.type === 'completed') output = event.text
    }
    if (output === undefined || !actualRoute) throw new Error('DESTINATION_RESULT_MALFORMED')
    return { output, actualRoute }
  }

  preflight(request: Pick<DispatchRequest, 'capabilityIds' | 'classificationSource' | 'classificationAmbiguous' | 'override'>): RoutingPreflightDecision {
    const policyV3 = this.repository.readPolicyV3()
    if (policyV3 && this.connections) {
      const normalized = normalizeCapabilityIdsV3(policyV3, request.capabilityIds)
      const selection = selectProfilesV3(policyV3, normalized, request)
      const qualified = selection.profiles.map((profile) => this.qualifyV3(profile, this.clock().getTime())).find(Boolean)
      if (qualified) return { disposition: selection.assignmentBehavior === 'send-automatically' || request.override.mode === 'include' ? 'auto-dispatch-eligible' : 'recommend', reasonCode: selection.reasonCode, policyVersion: policyV3.policyVersion, profile: snapshotV3(qualified.profile, qualified.connection, selection.assignmentBehavior) }
      return { disposition: selection.decision ? 'decision-required' : 'unavailable', reasonCode: selection.reasonCode, policyVersion: policyV3.policyVersion }
    }
    const policy = this.repository.readPolicy()
    if (!policy || !validateOperationalPolicyForCompanion(policy).valid) return { disposition: 'unavailable', reasonCode: 'ROUTING_POLICY_INVALID', policyVersion: null }
    if (request.override.mode === 'self') return { disposition: 'self-handled', reasonCode: 'EXPLICIT_SELF_OVERRIDE', policyVersion: policy.policyVersion }
    const normalizedRequest = { ...request, capabilityIds: normalizeCapabilityIds(policy, request.capabilityIds) }
    const selection = selectProfile(policy.profiles, policy.defaultProfileOrder, policy.capabilityOverrides, normalizedRequest, this.clock().getTime())
    if (selection.profile) return { disposition: 'auto-dispatch-eligible', reasonCode: selection.reasonCode, policyVersion: policy.policyVersion, profile: snapshot(selection.profile) }
    if (selection.recommended) return { disposition: 'recommend', reasonCode: selection.reasonCode, policyVersion: policy.policyVersion, profile: snapshot(selection.recommended) }
    return { disposition: selection.decision ? 'decision-required' : 'unavailable', reasonCode: selection.reasonCode, policyVersion: policy.policyVersion }
  }

  cancel(receiptId: string): RoutingDispatchReceiptDto | null {
    this.active.get(receiptId)?.abort('cancelled')
    return this.repository.getDispatchReceipt(receiptId)
  }

  async retry(receiptId: string, idempotencyKey: string = randomUUID()): Promise<DispatchResult> {
    const prior = this.repository.getDispatchReceipt(receiptId)
    if (!prior || !['failed', 'timed-out', 'cancelled'].includes(prior.state)) return { disposition: 'failed', receipt: prior ?? undefined, reasonCode: 'RETRY_NOT_ALLOWED' }
    const cached = this.retryableRequests.get(receiptId)
    if (!cached || cached.expiresAt <= this.clock().getTime()) {
      this.retryableRequests.delete(receiptId)
      return { disposition: 'failed', receipt: prior, reasonCode: 'RESULT_CONTENT_UNAVAILABLE' }
    }
    return this.dispatch({ ...cached.request, idempotencyKey, retryOfReceiptId: receiptId })
  }

  markDelivered(receiptId: string): RoutingDispatchReceiptDto {
    return this.repository.updateDispatchReceipt(receiptId, { returnState: 'delivered' })
  }

  recoverResult(receiptId: string): string | null {
    const result = this.results.get(receiptId)
    if (!result || result.expiresAt <= this.clock().getTime()) { this.results.delete(receiptId); return null }
    return result.text
  }

  private existing(receipt: RoutingDispatchReceiptDto): DispatchResult {
    const output = receipt.state === 'completed' ? this.recoverResult(receipt.id) ?? undefined : undefined
    return { disposition: 'existing', receipt, output, reasonCode: output ? undefined : receipt.state === 'completed' ? 'RESULT_CONTENT_UNAVAILABLE' : undefined }
  }
}

function selectProfile(profiles: RoutingExecutionProfile[], defaultOrder: string[], overrides: Array<{ capabilityId: string; profileOrder: string[] }>, request: Pick<DispatchRequest, 'capabilityIds' | 'classificationAmbiguous' | 'override'>, now: number): { profile?: RoutingExecutionProfile; recommended?: RoutingExecutionProfile; decision: boolean; reasonCode: string } {
  if (request.override.mode === 'self') return { decision: true, reasonCode: 'EXPLICIT_SELF_OVERRIDE' }
  if (request.classificationAmbiguous || request.capabilityIds.length === 0) return { decision: true, reasonCode: 'AMBIGUOUS_CLASSIFICATION' }
  const required = [...new Set(request.capabilityIds)]
  const order = [...overrides.filter((value) => required.includes(value.capabilityId)).flatMap((value) => value.profileOrder), ...defaultOrder].filter((id, index, all) => all.indexOf(id) === index)
  const excluded = request.override.mode === 'exclude' ? new Set(request.override.profileIds) : new Set<string>()
  const exact = order.map((id) => profiles.find((profile) => profile.id === id)).filter((profile): profile is RoutingExecutionProfile => Boolean(profile)).filter((profile) => required.every((capability) => profile.capabilityIds.includes(capability)))
  const includedProfileId = request.override.mode === 'include' ? request.override.profileId : undefined
  const requested = includedProfileId !== undefined ? exact.find((profile) => profile.id === includedProfileId) : exact.find((profile) => profile.behavior === 'auto-exact')
  if (!requested) return { recommended: exact[0], decision: exact.length > 0, reasonCode: exact.length > 0 ? 'RECOMMENDATION_ONLY' : 'NO_EXACT_PROFILE' }
  if (!requested.enabled || excluded.has(requested.id) || requested.readiness.state !== 'ready' || !requested.readiness.expiresAt || Date.parse(requested.readiness.expiresAt) <= now) return { decision: false, reasonCode: 'EXACT_PROFILE_NOT_READY' }
  return { profile: requested, decision: false, reasonCode: 'ELIGIBLE' }
}

function snapshot(profile: RoutingExecutionProfile) { return { profileId: profile.id, destinationAdapterId: profile.destinationAdapterId, destinationInstanceId: profile.destinationInstanceId, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort, behavior: profile.behavior } }
function sameRoute(requested: ReturnType<typeof snapshot>, actual: { destinationAdapterId: string; destinationInstanceId: string; providerId: string | null; modelId: string; effort: string | null }) { return requested.destinationAdapterId === actual.destinationAdapterId && requested.destinationInstanceId === actual.destinationInstanceId && requested.providerId === actual.providerId && requested.modelId === actual.modelId && requested.effort === actual.effort }
function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function boundedCode(cause: unknown) { const code = cause instanceof Error ? cause.message : 'DESTINATION_FAILED'; return /^[A-Z0-9_]{3,64}$/.test(code) ? code : 'DESTINATION_FAILED' }

const CAPABILITY_ALIASES: Readonly<Record<string, string>> = {
  write: 'creation.writing',
  writing: 'creation.writing',
  'text-generation': 'creation.writing',
  'content-writing': 'creation.writing',
  copywriting: 'creation.writing',
  code: 'engineering.coding',
  coding: 'engineering.coding',
  debug: 'engineering.debugging',
  debugging: 'engineering.debugging',
  research: 'research-analysis.web-research',
  'web-research': 'research-analysis.web-research',
  'data-analysis': 'research-analysis.data-analysis',
}

function normalizeCapabilityIds(policy: OperationalRoutingPolicy, requested: readonly string[]): string[] {
  const byNormalizedValue = new Map<string, string>()
  for (const capability of policy.capabilities) {
    byNormalizedValue.set(normalizeCapabilityValue(capability.id), capability.id)
    byNormalizedValue.set(normalizeCapabilityValue(capability.label), capability.id)
  }
  return [...new Set(requested.map((value) => {
    const normalized = normalizeCapabilityValue(value)
    const aliasTarget = CAPABILITY_ALIASES[normalized]
    return byNormalizedValue.get(normalized)
      ?? (aliasTarget && policy.capabilities.some((capability) => capability.id === aliasTarget) ? aliasTarget : value)
  }))]
}

function normalizeCapabilityValue(value: string): string {
  return value.normalize('NFKD').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

type ActualExecutionRoute = Extract<DestinationExecutionEvent, { actualRoute: unknown }>['actualRoute']
interface QualifiedV3Profile { profile: RoutingProfileV3; connection: RoutingConnectionDto; adapter: DestinationAdapter }

function normalizeCapabilityIdsV3(policy: OperationalRoutingPolicyV3, requested: readonly string[]): string[] {
  const byNormalizedValue = new Map<string, string>()
  for (const capability of policy.capabilities) {
    byNormalizedValue.set(normalizeCapabilityValue(capability.id), capability.id)
    byNormalizedValue.set(normalizeCapabilityValue(capability.label), capability.id)
  }
  return [...new Set(requested.map((value) => {
    const normalized = normalizeCapabilityValue(value)
    const aliasTarget = CAPABILITY_ALIASES[normalized]
    return byNormalizedValue.get(normalized) ?? (aliasTarget && policy.capabilities.some((capability) => capability.id === aliasTarget) ? aliasTarget : value)
  }))]
}

function selectProfilesV3(policy: OperationalRoutingPolicyV3, capabilityIds: string[], request: Pick<DispatchRequest, 'classificationAmbiguous' | 'override'>): { profiles: RoutingProfileV3[]; decision: boolean; reasonCode: string; assignmentBehavior: 'ask-before-send' | 'send-automatically' } {
  if (request.override.mode === 'self') return { profiles: [], decision: true, reasonCode: 'EXPLICIT_SELF_OVERRIDE', assignmentBehavior: 'ask-before-send' }
  if (request.classificationAmbiguous || capabilityIds.length === 0) return { profiles: [], decision: true, reasonCode: 'AMBIGUOUS_CLASSIFICATION', assignmentBehavior: 'ask-before-send' }
  const assignment = policy.assignments.find((value) => capabilityIds.includes(value.capabilityId)) ?? policy.assignments.find((value) => value.capabilityId === 'default')
  if (!assignment) return { profiles: [], decision: false, reasonCode: 'NO_ASSIGNMENT', assignmentBehavior: 'ask-before-send' }
  const excluded = request.override.mode === 'exclude' ? new Set(request.override.profileIds) : new Set<string>()
  let profiles = assignment.profileOrder.map((id) => policy.profiles.find((profile) => profile.id === id)).filter((profile): profile is RoutingProfileV3 => Boolean(profile)).filter((profile) => !excluded.has(profile.id))
  if (request.override.mode === 'include') {
    const includedProfileId = request.override.profileId
    profiles = profiles.filter((profile) => profile.id === includedProfileId)
  }
  if (!profiles.length) return { profiles: [], decision: false, reasonCode: 'NO_EXACT_PROFILE', assignmentBehavior: assignment.behavior }
  const decision = assignment.behavior === 'ask-before-send' && request.override.mode !== 'include'
  return { profiles, decision, reasonCode: decision ? 'ASK_BEFORE_SEND' : 'ELIGIBLE', assignmentBehavior: assignment.behavior }
}

function snapshotV3(profile: RoutingProfileV3, connection: RoutingConnectionDto, behavior: 'ask-before-send' | 'send-automatically') {
  return { profileId: profile.id, destinationAdapterId: connection.adapterId, destinationInstanceId: connection.id, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort, behavior: behavior === 'send-automatically' ? 'auto-exact' as const : 'recommend' as const }
}

function routeEvidence(profile: RoutingProfileV3, connection: RoutingConnectionDto, verification: RouteEvidenceDto['verification']): RouteEvidenceDto {
  return { connectionId: connection.id, adapterId: connection.adapterId, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort, verification }
}

function destinationEvidence(candidate: QualifiedV3Profile, actual: ActualExecutionRoute): RouteEvidenceDto {
  const supported = new Set(candidate.adapter.manifest.qualification?.actualRouteEvidence ?? [])
  return {
    connectionId: candidate.connection.id,
    adapterId: candidate.connection.adapterId,
    providerId: supported.has('provider') ? actual.providerId : null,
    modelId: supported.has('model') ? actual.modelId : null,
    effort: supported.has('effort') ? actual.effort : null,
    verification: supported.size ? 'destination-reported' : 'requested-unverified',
  }
}

function legacyActualRoute(evidence: RouteEvidenceDto) {
  return evidence.adapterId && evidence.connectionId && evidence.modelId ? { destinationAdapterId: evidence.adapterId, destinationInstanceId: evidence.connectionId, providerId: evidence.providerId, modelId: evidence.modelId, effort: evidence.effort } : null
}
