import { createHash, randomUUID } from 'node:crypto'
import type { OperationalRoutingPolicy, RoutingClassificationSource, RoutingDispatchReceiptDto, RoutingExecutionProfile, RoutingRequestOverride } from '../../shared/companion-contract.js'
import type { DestinationAdapter } from './adapter-contract.js'
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
  private readonly clock: () => Date

  constructor(repository: RoutingRepository, adapters: readonly DestinationAdapter[], clock: () => Date = () => new Date()) {
    this.repository = repository
    this.clock = clock
    this.adapters = new Map(adapters.map((adapter) => [adapter.manifest.adapterId, adapter]))
    this.repository.recoverInterruptedDispatches(this.clock().toISOString())
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    if (!request.idempotencyKey || !request.task || request.task.length > 200_000) return { disposition: 'failed', reasonCode: 'INVALID_REQUEST' }
    const existing = this.repository.findDispatchByIdempotencyKey(request.idempotencyKey)
    if (existing) return this.existing(existing)
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

  preflight(request: Pick<DispatchRequest, 'capabilityIds' | 'classificationSource' | 'classificationAmbiguous' | 'override'>): RoutingPreflightDecision {
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
