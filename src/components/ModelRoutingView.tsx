import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ModelRouteKind,
  ModelRouteTarget,
  ModelRoutingPolicy,
  RoutingDecisionRecord,
  RoutingRecommendationResult,
  RoutingCapabilityDefinition,
  StagedModelRoutingPolicyImport,
  Ticket,
} from '../types'
import {
  confirmRoutingRecommendation,
  createModelRouteId,
  findEquivalentBuiltInRoutingCapabilityId,
  getModelRoutingPolicyRevision,
  inferRequiredCapabilities,
  normalizeCapabilityId,
  overridePartialRoute,
  recommendModelRoute,
  validateModelRoutingPolicy,
} from '../lib/model-routing'
import {
  applyStagedModelRoutingPolicy,
  downloadModelRoutingPolicy,
  saveModelRoutingPolicy,
  stageModelRoutingPolicyImport,
} from '../lib/model-routing-storage'
import { recordRoutingDecision } from '../lib/model-routing-evidence'
import type { OperationalRepository } from '../lib/operational-repository'
import type { UsageQueryDto } from '../../shared/companion-contract'
import { GuidedRoutingSetup } from './routing/GuidedRoutingSetup'
import { DispatchHistory } from './routing/DispatchHistory'

export interface ModelRoutingViewProps {
  policy: ModelRoutingPolicy
  loadIssue?: string
  ticket?: Ticket
  onPolicyChange: (policy: ModelRoutingPolicy) => void
  operationalRepository?: OperationalRepository
  onOpenUsage?: (filters: UsageQueryDto) => void
}

const ROUTE_KINDS: Array<{ value: ModelRouteKind; label: string }> = [
  { value: 'hosted', label: 'Hosted model' },
  { value: 'local', label: 'Local runtime' },
  { value: 'agent-surface', label: 'Agent surface' },
  { value: 'custom', label: 'Custom' },
]

const FAMILY_LABELS: Record<RoutingCapabilityDefinition['family'], string> = {
  orchestration: 'Orchestration',
  review: 'Review',
  creation: 'Creation',
  engineering: 'Engineering',
  'research-analysis': 'Research and analysis',
  custom: 'Custom',
}

function clonePolicy(policy: ModelRoutingPolicy): ModelRoutingPolicy {
  return structuredClone(policy)
}

function moveItem(values: string[], index: number, direction: -1 | 1): string[] {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= values.length) return values
  const updated = [...values]
  ;[updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]]
  return updated
}

function describeRoute(route: ModelRouteTarget): string {
  return [route.provider, route.model, route.surface].filter(Boolean).join(' / ')
}

export function AdvancedRoutingPolicy({ policy, loadIssue, ticket, onPolicyChange }: ModelRoutingViewProps) {
  const [draft, setDraft] = useState(() => clonePolicy(policy))
  const [capabilityQuery, setCapabilityQuery] = useState('')
  const [customCapabilityLabel, setCustomCapabilityLabel] = useState('')
  const [customCapabilityMessage, setCustomCapabilityMessage] = useState<string>()
  const [selectedOverrideCapabilityId, setSelectedOverrideCapabilityId] = useState('')
  const [stagedImport, setStagedImport] = useState<StagedModelRoutingPolicyImport>()
  const [statusMessage, setStatusMessage] = useState<string>()
  const [requiredCapabilityIds, setRequiredCapabilityIds] = useState<string[]>([])
  const [inferenceRuleIds, setInferenceRuleIds] = useState<string[]>([])
  const [capabilitiesConfirmed, setCapabilitiesConfirmed] = useState(false)
  const [recommendation, setRecommendation] = useState<RoutingRecommendationResult>()
  const [recommendationFingerprint, setRecommendationFingerprint] = useState<string>()
  const [routingDecision, setRoutingDecision] = useState<RoutingDecisionRecord>()
  const [evidenceMessage, setEvidenceMessage] = useState<string>()
  const [recommendationMessage, setRecommendationMessage] = useState<string>()
  const validationSummaryRef = useRef<HTMLDivElement>(null)
  const recommendationHeadingRef = useRef<HTMLHeadingElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(clonePolicy(policy))
  }, [policy])

  useEffect(() => {
    if (!ticket) {
      setRequiredCapabilityIds([])
      setInferenceRuleIds([])
      setCapabilitiesConfirmed(false)
      setRecommendation(undefined)
      setRecommendationFingerprint(undefined)
      setRoutingDecision(undefined)
      setEvidenceMessage(undefined)
      setRecommendationMessage(undefined)
      return
    }
    const inferred = inferRequiredCapabilities(ticket)
    setRequiredCapabilityIds(inferred.capabilityIds)
    setInferenceRuleIds(inferred.matchedRuleIds)
    setCapabilitiesConfirmed(false)
    setRecommendation(undefined)
    setRecommendationFingerprint(undefined)
    setRoutingDecision(undefined)
    setEvidenceMessage(undefined)
    setRecommendationMessage(inferred.capabilityIds.length > 0
      ? 'Capabilities were inferred locally. Review them before evaluation.'
      : 'No capabilities were inferred. Select at least one before evaluation.')
  }, [ticket])

  const validation = useMemo(() => validateModelRoutingPolicy(draft), [draft])
  const normalizedCapabilityQuery = capabilityQuery.trim().toLowerCase()
  const visibleCapabilityGroups = useMemo(() => {
    const filtered = draft.capabilities.filter((capability) => {
      if (!normalizedCapabilityQuery) return true
      return `${capability.label} ${capability.description} ${capability.id} ${FAMILY_LABELS[capability.family]}`
        .toLowerCase()
        .includes(normalizedCapabilityQuery)
    })
    return Object.entries(FAMILY_LABELS).flatMap(([family, label]) => {
      const capabilities = filtered.filter((capability) => capability.family === family)
      return capabilities.length > 0 ? [{ family, label, capabilities }] : []
    })
  }, [draft.capabilities, normalizedCapabilityQuery])
  const availableOverrideCapabilities = draft.capabilities.filter(
    (capability) => !draft.capabilityOverrides.some((override) => override.capabilityId === capability.id),
  )
  const currentPolicyRevision = getModelRoutingPolicyRevision(policy)
  const currentRecommendationFingerprint = `${currentPolicyRevision}\u0000${requiredCapabilityIds.join('\u0000')}`
  const recommendationIsStale = recommendation !== undefined
    && recommendationFingerprint !== currentRecommendationFingerprint

  function updateRoute(routeId: string, update: (route: ModelRouteTarget) => ModelRouteTarget) {
    setDraft((current) => ({
      ...current,
      routes: current.routes.map((route) => route.id === routeId ? update(route) : route),
    }))
    setStatusMessage(undefined)
  }

  function addRoute() {
    const route: ModelRouteTarget = {
      id: createModelRouteId(),
      displayName: 'New route',
      provider: 'Custom',
      model: 'Unspecified',
      surface: 'Manual',
      kind: 'custom',
      enabled: true,
      availability: { state: 'available', confirmedAt: new Date().toISOString() },
      capabilityIds: [],
    }
    setDraft((current) => ({
      ...current,
      routes: [...current.routes, route],
      defaultRouteOrder: [...current.defaultRouteOrder, route.id],
    }))
    setStatusMessage('Route added. Complete its labels and capabilities, then save the policy.')
  }

  function removeRoute(routeId: string) {
    setDraft((current) => ({
      ...current,
      routes: current.routes.filter((route) => route.id !== routeId),
      defaultRouteOrder: current.defaultRouteOrder.filter((id) => id !== routeId),
      capabilityOverrides: current.capabilityOverrides.map((override) => ({
        ...override,
        routeOrder: override.routeOrder.filter((id) => id !== routeId),
      })),
    }))
    setStatusMessage('Route removed from the draft and all route orders.')
  }

  function toggleRouteCapability(routeId: string, capabilityId: string) {
    updateRoute(routeId, (route) => ({
      ...route,
      capabilityIds: route.capabilityIds.includes(capabilityId)
        ? route.capabilityIds.filter((id) => id !== capabilityId)
        : [...route.capabilityIds, capabilityId],
    }))
  }

  function toggleRequiredCapability(capabilityId: string) {
    setRequiredCapabilityIds((current) => current.includes(capabilityId)
      ? current.filter((id) => id !== capabilityId)
      : [...current, capabilityId])
    setCapabilitiesConfirmed(false)
    setRoutingDecision(undefined)
    setEvidenceMessage(undefined)
    setRecommendationMessage('Required capabilities changed. Confirm and evaluate again.')
  }

  function evaluateRecommendation() {
    if (!ticket || requiredCapabilityIds.length === 0) return
    const result = recommendModelRoute({ policy, requiredCapabilityIds })
    setCapabilitiesConfirmed(true)
    setRecommendation(result)
    setRecommendationFingerprint(currentRecommendationFingerprint)
    setRoutingDecision(undefined)
    setEvidenceMessage(undefined)
    setRecommendationMessage(result.status === 'exact-match'
      ? 'Exact eligible route found. Confirmation records the choice but sends nothing.'
      : result.status === 'no-match'
        ? 'No exact route matches every confirmed capability.'
        : result.status === 'invalid-policy'
          ? 'The saved policy is invalid; repair it before routing.'
          : 'Select and confirm at least one required capability.')
    requestAnimationFrame(() => recommendationHeadingRef.current?.focus())
  }

  function confirmRecommendedRoute() {
    if (!ticket || !recommendation || recommendationIsStale) return
    try {
      const decision = confirmRoutingRecommendation({
        result: recommendation,
        ticketId: ticket.id,
        currentPolicyRevision,
      })
      setRoutingDecision(decision)
      setEvidenceMessage(recordRoutingDecision(decision).message)
      setRecommendationMessage(`Confirmed ${decision.routeId}. No request was sent or rerouted.`)
    } catch (error) {
      setRecommendationMessage(error instanceof Error ? error.message : 'The recommendation could not be confirmed.')
    }
  }

  function overrideRecommendation(routeId: string) {
    if (!ticket || !recommendation || recommendationIsStale) return
    try {
      const decision = overridePartialRoute({
        result: recommendation,
        ticketId: ticket.id,
        routeId,
        explicitlyConfirmed: true,
        currentPolicyRevision,
      })
      setRoutingDecision(decision)
      setEvidenceMessage(recordRoutingDecision(decision).message)
      setRecommendationMessage(`Capability-gap override recorded for ${decision.routeId}. No request was sent.`)
    } catch (error) {
      setRecommendationMessage(error instanceof Error ? error.message : 'The partial route could not be overridden.')
    }
  }

  function addCustomCapability() {
    setCustomCapabilityMessage(undefined)
    let id: string
    try {
      id = normalizeCapabilityId(customCapabilityLabel)
    } catch (error) {
      setCustomCapabilityMessage(error instanceof Error ? error.message : 'Enter a capability label.')
      return
    }

    const collision = draft.capabilities.find((capability) => capability.id === id)
    if (collision) {
      setCustomCapabilityMessage(
        `“${customCapabilityLabel.trim()}” matches ${collision.label} (${collision.id}). Reuse it, or enter a distinctly named capability.`,
      )
      return
    }

    const equivalentBuiltInId = findEquivalentBuiltInRoutingCapabilityId(customCapabilityLabel)
    if (equivalentBuiltInId) {
      const equivalent = draft.capabilities.find((capability) => capability.id === equivalentBuiltInId)
      setCustomCapabilityMessage(
        `“${customCapabilityLabel.trim()}” is equivalent to ${equivalent?.label ?? equivalentBuiltInId} (${equivalentBuiltInId}). Reuse it, or enter a distinctly named capability.`,
      )
      return
    }

    const capability: RoutingCapabilityDefinition = {
      id,
      family: 'custom',
      label: customCapabilityLabel.trim(),
      description: `Custom capability: ${customCapabilityLabel.trim()}.`,
      origin: 'custom',
    }
    setDraft((current) => ({ ...current, capabilities: [...current.capabilities, capability] }))
    setCustomCapabilityLabel('')
    setCustomCapabilityMessage(`Added ${capability.label}. Assign it to one or more routes.`)
  }

  function addCapabilityOverride() {
    if (!selectedOverrideCapabilityId) return
    setDraft((current) => ({
      ...current,
      capabilityOverrides: [
        ...current.capabilityOverrides,
        { capabilityId: selectedOverrideCapabilityId, routeOrder: [...current.defaultRouteOrder] },
      ],
    }))
    setSelectedOverrideCapabilityId('')
  }

  function saveDraft() {
    const nextPolicy = { ...draft, updatedAt: new Date().toISOString() }
    const result = saveModelRoutingPolicy(nextPolicy)
    if (result.status !== 'saved') {
      setStatusMessage(result.status === 'invalid'
        ? 'Policy not saved. Repair the validation issues below.'
        : result.message)
      requestAnimationFrame(() => validationSummaryRef.current?.focus())
      return
    }
    setDraft(nextPolicy)
    onPolicyChange(nextPolicy)
    setStatusMessage('Routing policy saved locally. No provider request was sent.')
  }

  function exportPolicy() {
    const result = downloadModelRoutingPolicy(draft)
    setStatusMessage(result.status === 'ready'
      ? 'Private routing policy exported locally.'
      : result.status === 'invalid'
        ? 'Policy export blocked by validation issues.'
        : result.message)
    if (result.status !== 'ready') requestAnimationFrame(() => validationSummaryRef.current?.focus())
  }

  async function readImportFile(file: File) {
    const staged = stageModelRoutingPolicyImport(await file.text(), policy)
    setStagedImport(staged)
    setStatusMessage(staged.status === 'ready'
      ? 'Import validated. Review the preview before applying it.'
      : 'Import rejected. The active policy was not changed.')
    if (staged.status !== 'ready') requestAnimationFrame(() => validationSummaryRef.current?.focus())
  }

  function applyImport() {
    if (!stagedImport) return
    const result = applyStagedModelRoutingPolicy(stagedImport)
    if (result.status === 'saved' && stagedImport.status === 'ready') {
      onPolicyChange(stagedImport.policy)
      setDraft(clonePolicy(stagedImport.policy))
      setStagedImport(undefined)
      setStatusMessage('Imported routing policy applied locally.')
      return
    }
    if (result.status === 'invalid') {
      setStatusMessage('Import apply failed validation. The active policy was not changed.')
    } else if (result.status !== 'saved') {
      setStatusMessage(result.message)
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="model-routing-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-sync">Local preference policy</p>
          <h2 id="model-routing-heading" className="mt-1 text-xl font-semibold text-chrome-ink">Model Routing</h2>
          <p className="mt-1 max-w-3xl text-sm text-chrome-mut">
            Describe the models and agent surfaces you use, what work they support, and their manual availability.
            FindMnemo recommends a route but never sends or reroutes a request.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={addRoute} className="rounded-sm border border-sync/50 bg-sync/10 px-3 py-2 text-xs font-medium text-sync hover:bg-sync/20">
            Add route
          </button>
          <button type="button" onClick={saveDraft} className="rounded-sm bg-memory px-3 py-2 text-xs font-semibold text-chrome hover:brightness-110">
            Validate and save
          </button>
        </div>
      </div>

      {(loadIssue || statusMessage) && (
        <div className="panel rounded-sm border border-memory/30 px-4 py-3 text-sm text-chrome-ink" role="status" aria-live="polite">
          {loadIssue && <p><strong>Stored policy:</strong> {loadIssue}</p>}
          {statusMessage && <p>{statusMessage}</p>}
        </div>
      )}

      <div
        ref={validationSummaryRef}
        tabIndex={-1}
        className={`rounded-sm border px-4 py-3 ${validation.valid ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5'}`}
        aria-live="polite"
      >
        <p className="text-xs font-semibold text-chrome-ink">
          {validation.valid ? 'Policy draft is valid' : `${validation.issues.length} validation issue(s) block save`}
        </p>
        {!validation.valid && (
          <ul className="mt-2 max-h-36 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-rose-300">
            {validation.issues.map((issue, index) => (
              <li key={`${issue.path}:${issue.code}:${index}`}><span className="font-mono">{issue.path}</span>: {issue.message}</li>
            ))}
          </ul>
        )}
      </div>

      <section className="panel rounded-sm border border-chrome-line p-4" aria-labelledby="recommendation-session-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="recommendation-session-heading" className="text-sm font-semibold text-chrome-ink">Ticket route recommendation</h3>
            <p className="mt-1 text-xs text-chrome-mut">Capability inference and evaluation stay local. Confirmation never executes the ticket.</p>
          </div>
          {ticket && <span className="rounded-sm border border-chrome-line px-2 py-1 text-[10px] font-mono text-chrome-mut">Ticket {ticket.id}</span>}
        </div>

        {!ticket ? (
          <div className="mt-3 rounded-sm border border-chrome-line bg-chrome/40 px-3 py-4 text-sm text-chrome-mut">
            No ticket selected. Open a ticket and choose <strong className="text-chrome-ink">Recommend route</strong>, or continue editing the policy here.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-sm border border-chrome-line bg-chrome/40 p-3">
              <p className="text-xs font-semibold text-chrome-ink">{ticket.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-chrome-mut">{ticket.description || 'No ticket description.'}</p>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-chrome-ink">Required capabilities</p>
                <span className="text-[10px] font-mono text-chrome-mut">
                  {capabilitiesConfirmed ? 'User-confirmed for current result' : 'Inferred or edited; confirmation pending'}
                </span>
              </div>
              {inferenceRuleIds.length > 0 ? (
                <p className="mt-1 break-words text-[10px] font-mono text-chrome-mut">Matched local rules: {inferenceRuleIds.join(', ')}</p>
              ) : (
                <p className="mt-1 text-xs text-memory">No inference rule matched. Select at least one capability explicitly.</p>
              )}
              <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto rounded-sm border border-chrome-line p-2 sm:grid-cols-2 lg:grid-cols-3">
                {policy.capabilities.map((capability) => {
                  const inferred = inferenceRuleIds.some((ruleId) => ruleId.endsWith(capability.id.split('.').at(-1) ?? ''))
                  return (
                    <label key={capability.id} className="flex items-start gap-2 rounded-sm px-2 py-2 text-xs hover:bg-chrome-raised/60">
                      <input type="checkbox" checked={requiredCapabilityIds.includes(capability.id)} onChange={() => toggleRequiredCapability(capability.id)} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="text-chrome-ink">{capability.label}</span>
                        {inferred && <span className="ml-1 rounded-sm border border-memory/40 px-1 py-0.5 text-[9px] text-memory">Inferred</span>}
                        <span className="block text-[10px] text-chrome-mut">{capability.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={evaluateRecommendation}
                disabled={requiredCapabilityIds.length === 0}
                className="mt-3 rounded-sm bg-sync px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm capabilities and evaluate
              </button>
            </div>

            {recommendationMessage && <p className="text-xs text-memory" role="status" aria-live="polite">{recommendationMessage}</p>}

            {recommendation && (
              <div className={`rounded-sm border p-4 ${recommendation.status === 'exact-match' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-memory/40 bg-memory/5'}`}>
                <h4 ref={recommendationHeadingRef} tabIndex={-1} className="text-sm font-semibold text-chrome-ink">
                  {recommendation.status === 'exact-match' && 'Exact route recommendation'}
                  {recommendation.status === 'no-match' && 'No exact route match'}
                  {recommendation.status === 'needs-capabilities' && 'Capabilities required'}
                  {recommendation.status === 'invalid-policy' && 'Invalid routing policy'}
                </h4>
                {recommendationIsStale && (
                  <p className="mt-2 rounded-sm border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    Stale result: the saved policy or required capabilities changed. Evaluate again before confirming or overriding.
                  </p>
                )}

                {recommendation.status === 'exact-match' && recommendation.recommendedRouteId && (() => {
                  const route = policy.routes.find((candidate) => candidate.id === recommendation.recommendedRouteId)
                  return (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-sm border border-emerald-500/30 bg-chrome/40 p-3">
                        <p className="text-sm font-semibold text-chrome-ink">{route?.displayName ?? recommendation.recommendedRouteId}</p>
                        <p className="mt-1 text-xs text-chrome-mut">{route ? describeRoute(route) : recommendation.recommendedRouteId}</p>
                        <p className="mt-2 text-xs text-emerald-300">Available (manually confirmed) · supports every required capability</p>
                      </div>
                      <dl className="grid gap-2 text-xs text-chrome-mut sm:grid-cols-2">
                        <div><dt className="text-chrome-ink">Matched capabilities</dt><dd>{recommendation.requiredCapabilityIds.join(', ')}</dd></div>
                        <div><dt className="text-chrome-ink">Applied overrides</dt><dd>{recommendation.appliedOverrideCapabilityIds.join(', ') || 'Default order only'}</dd></div>
                        <div className="sm:col-span-2"><dt className="text-chrome-ink">Effective order</dt><dd className="break-words font-mono text-[10px]">{recommendation.effectiveRouteOrder.join(' → ') || 'No ordered routes'}</dd></div>
                      </dl>
                      <button type="button" onClick={confirmRecommendedRoute} disabled={recommendationIsStale} className="rounded-sm bg-emerald-500 px-3 py-2 text-xs font-semibold text-chrome disabled:opacity-40">
                        Confirm recommended route (send nothing)
                      </button>
                    </div>
                  )
                })()}

                {recommendation.status === 'no-match' && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-chrome-mut">No available ordered route supports every confirmed capability. Partial routes are shown only for an explicit capability-gap override.</p>
                    {recommendation.partialMatches.length === 0 ? (
                      <p className="rounded-sm border border-chrome-line px-3 py-3 text-xs text-chrome-mut">No available partial routes support any required capability.</p>
                    ) : (
                      <div className="grid gap-2 lg:grid-cols-2">
                        {recommendation.partialMatches.map((match) => {
                          const route = policy.routes.find((candidate) => candidate.id === match.routeId)
                          return (
                            <article key={match.routeId} className="rounded-sm border border-memory/40 bg-chrome/40 p-3">
                              <p className="text-xs font-semibold text-chrome-ink">{route?.displayName ?? match.routeId}</p>
                              <p className="mt-1 text-[10px] text-emerald-300">Supports: {match.supportedCapabilityIds.join(', ')}</p>
                              <p className="mt-1 text-[10px] text-rose-300">Missing: {match.missingCapabilityIds.join(', ')}</p>
                              <button type="button" onClick={() => overrideRecommendation(match.routeId)} disabled={recommendationIsStale} className="mt-3 rounded-sm border border-rose-400/50 px-3 py-2 text-xs font-semibold text-rose-300 disabled:opacity-40">
                                Override capability gap and choose {route?.displayName ?? match.routeId}
                              </button>
                            </article>
                          )
                        })}
                      </div>
                    )}
                    {recommendation.exclusions.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-chrome-ink">Exclusions</p>
                        <ul className="mt-1 space-y-1 text-[10px] text-chrome-mut">
                          {recommendation.exclusions.map((exclusion) => (
                            <li key={exclusion.routeId}><span className="font-mono">{exclusion.routeId}</span>: {exclusion.reasons.join(', ')}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {recommendation.status === 'needs-capabilities' && <p className="mt-2 text-xs text-chrome-mut">Select at least one capability, then evaluate again.</p>}
                {recommendation.status === 'invalid-policy' && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-300">
                    {recommendation.validationIssues?.map((issue, index) => <li key={`${issue.path}:${issue.code}:${index}`}>{issue.path}: {issue.message}</li>)}
                  </ul>
                )}
                {routingDecision && (
                  <div className="mt-4 rounded-sm border border-sync/40 bg-sync/10 px-3 py-3 text-xs text-chrome-ink">
                    <strong>{routingDecision.decisionType === 'exact-confirmation' ? 'Route confirmed' : 'Capability-gap override recorded'}:</strong> {routingDecision.routeId}.
                    <span className="block mt-1 text-chrome-mut">{evidenceMessage ?? 'Evidence recording has not run.'} No request was sent.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-chrome-ink">Routes</h3>
          <span className="text-xs text-chrome-mut">{draft.routes.length} configured</span>
        </div>
        {draft.routes.length === 0 && (
          <div className="panel rounded-sm px-4 py-8 text-center text-sm text-chrome-mut">
            No routes yet. Add any hosted, local, agent-surface, or custom model you use.
          </div>
        )}
        <div className="grid gap-3 xl:grid-cols-2">
          {draft.routes.map((route) => (
            <article key={route.id} className="panel min-w-0 rounded-sm border border-chrome-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-chrome-ink">{route.displayName}</p>
                  <p className="truncate text-[10px] font-mono text-chrome-mut">{route.id}</p>
                </div>
                <button type="button" onClick={() => removeRoute(route.id)} className="text-xs text-rose-300 hover:text-rose-200">
                  Remove route
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-chrome-mut">
                  Display name
                  <input value={route.displayName} onChange={(event) => updateRoute(route.id, (current) => ({ ...current, displayName: event.target.value }))} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none" />
                </label>
                <label className="text-xs text-chrome-mut">
                  Kind
                  <select value={route.kind} onChange={(event) => updateRoute(route.id, (current) => ({ ...current, kind: event.target.value as ModelRouteKind }))} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none">
                    {ROUTE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-chrome-mut">
                  Provider
                  <input value={route.provider} onChange={(event) => updateRoute(route.id, (current) => ({ ...current, provider: event.target.value }))} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none" />
                </label>
                <label className="text-xs text-chrome-mut">
                  Model
                  <input value={route.model} onChange={(event) => updateRoute(route.id, (current) => ({ ...current, model: event.target.value }))} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none" />
                </label>
                <label className="text-xs text-chrome-mut sm:col-span-2">
                  Surface
                  <input value={route.surface} onChange={(event) => updateRoute(route.id, (current) => ({ ...current, surface: event.target.value }))} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none" />
                </label>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-ink">
                  <input
                    type="checkbox"
                    checked={route.enabled}
                    onChange={(event) => updateRoute(route.id, (current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  {route.enabled ? 'Enabled in policy' : 'Disabled in policy'}
                </label>
                <label className="text-xs text-chrome-mut">
                  Manual availability
                  <select
                    value={route.availability.state}
                    onChange={(event) => updateRoute(route.id, (current) => ({
                      ...current,
                      availability: {
                        state: event.target.value as ModelRouteTarget['availability']['state'],
                        confirmedAt: new Date().toISOString(),
                      },
                    }))}
                    className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none"
                  >
                    <option value="available">Available (manually confirmed)</option>
                    <option value="unavailable">Unavailable (manually confirmed)</option>
                  </select>
                </label>
              </div>
              <p className="mt-2 text-[10px] text-chrome-mut">Availability confirmed {new Date(route.availability.confirmedAt).toLocaleString()}</p>

              <fieldset className="mt-4">
                <legend className="text-xs font-semibold text-chrome-ink">Supported capabilities</legend>
                <div className="mt-2 max-h-44 space-y-2 overflow-y-auto rounded-sm border border-chrome-line p-2">
                  {visibleCapabilityGroups.map((group) => (
                    <div key={group.family}>
                      <p className="mb-1 text-[10px] font-mono uppercase tracking-[0.14em] text-chrome-mut">{group.label}</p>
                      {group.capabilities.map((capability) => (
                        <label key={capability.id} className="flex items-start gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-chrome-raised/60">
                          <input type="checkbox" checked={route.capabilityIds.includes(capability.id)} onChange={() => toggleRouteCapability(route.id, capability.id)} className="mt-0.5" />
                          <span><span className="text-chrome-ink">{capability.label}</span><span className="block text-[10px] text-chrome-mut">{capability.description}</span></span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </fieldset>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel min-w-0 rounded-sm border border-chrome-line p-4" aria-labelledby="capability-catalog-heading">
          <h3 id="capability-catalog-heading" className="text-sm font-semibold text-chrome-ink">Capability catalog</h3>
          <p className="mt-1 text-xs text-chrome-mut">Assignments are binary: a route supports the capability or it does not.</p>
          <label className="mt-3 block text-xs text-chrome-mut">
            Search capabilities
            <input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="Coding, review, image generation..." className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none" />
          </label>
          <div className="mt-3 flex gap-2">
            <label className="min-w-0 flex-1 text-xs text-chrome-mut">
              Custom capability
              <input value={customCapabilityLabel} onChange={(event) => setCustomCapabilityLabel(event.target.value)} placeholder="e.g. Contract analysis" className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink focus:border-sync focus:outline-none" />
            </label>
            <button type="button" onClick={addCustomCapability} className="self-end rounded-sm border border-sync/50 px-3 py-2 text-xs text-sync hover:bg-sync/10">Add</button>
          </div>
          {customCapabilityMessage && <p className="mt-2 text-xs text-memory" role="status">{customCapabilityMessage}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {draft.capabilities.map((capability) => (
              <span key={capability.id} title={capability.description} className="rounded-sm border border-chrome-line bg-chrome px-2 py-1 text-[10px] text-chrome-ink">
                {capability.label} <span className="text-chrome-mut">· {FAMILY_LABELS[capability.family]}</span>
              </span>
            ))}
          </div>
        </section>

        <section className="panel min-w-0 rounded-sm border border-chrome-line p-4" aria-labelledby="default-order-heading">
          <h3 id="default-order-heading" className="text-sm font-semibold text-chrome-ink">Default fallback order</h3>
          <p className="mt-1 text-xs text-chrome-mut">Use the buttons with a keyboard or pointer. The first eligible route wins.</p>
          <ol className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {draft.defaultRouteOrder.map((routeId, index) => {
              const route = draft.routes.find((candidate) => candidate.id === routeId)
              return (
                <li key={routeId} className="flex min-w-0 items-center gap-2 rounded-sm border border-chrome-line px-3 py-2">
                  <span className="w-5 shrink-0 text-xs font-mono text-chrome-mut">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-chrome-ink">{route?.displayName ?? routeId}<span className="block truncate text-[10px] text-chrome-mut">{route ? describeRoute(route) : 'Missing route reference'}</span></span>
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, defaultRouteOrder: moveItem(current.defaultRouteOrder, index, -1) }))} disabled={index === 0} aria-label={`Move ${route?.displayName ?? routeId} earlier`} className="rounded-sm border border-chrome-line px-2 py-1 text-xs disabled:opacity-30">Up</button>
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, defaultRouteOrder: moveItem(current.defaultRouteOrder, index, 1) }))} disabled={index === draft.defaultRouteOrder.length - 1} aria-label={`Move ${route?.displayName ?? routeId} later`} className="rounded-sm border border-chrome-line px-2 py-1 text-xs disabled:opacity-30">Down</button>
                </li>
              )
            })}
          </ol>
        </section>
      </div>

      <section className="panel rounded-sm border border-chrome-line p-4" aria-labelledby="override-heading">
        <h3 id="override-heading" className="text-sm font-semibold text-chrome-ink">Capability-specific orders</h3>
        <p className="mt-1 text-xs text-chrome-mut">Applicable lists are merged in the order shown, then the default order is appended.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select aria-label="Capability for specialized order" value={selectedOverrideCapabilityId} onChange={(event) => setSelectedOverrideCapabilityId(event.target.value)} className="min-w-0 flex-1 rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink">
            <option value="">Choose a capability...</option>
            {availableOverrideCapabilities.map((capability) => <option key={capability.id} value={capability.id}>{capability.label}</option>)}
          </select>
          <button type="button" onClick={addCapabilityOverride} disabled={!selectedOverrideCapabilityId} className="rounded-sm border border-sync/50 px-3 py-2 text-xs text-sync disabled:opacity-40">Add specialized order</button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {draft.capabilityOverrides.map((override, overrideIndex) => {
            const capability = draft.capabilities.find((candidate) => candidate.id === override.capabilityId)
            return (
              <article key={override.capabilityId} className="min-w-0 rounded-sm border border-chrome-line bg-chrome/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-chrome-ink">{capability?.label ?? override.capabilityId}</p><p className="truncate text-[10px] font-mono text-chrome-mut">Priority {overrideIndex + 1}</p></div>
                  <button type="button" onClick={() => setDraft((current) => ({ ...current, capabilityOverrides: current.capabilityOverrides.filter((item) => item.capabilityId !== override.capabilityId) }))} className="text-xs text-rose-300">Remove</button>
                </div>
                <ol className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                  {override.routeOrder.map((routeId, routeIndex) => (
                    <li key={routeId} className="flex items-center gap-2 rounded-sm border border-chrome-line px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-chrome-ink">{draft.routes.find((route) => route.id === routeId)?.displayName ?? routeId}</span>
                      <button type="button" onClick={() => setDraft((current) => ({ ...current, capabilityOverrides: current.capabilityOverrides.map((item) => item.capabilityId === override.capabilityId ? { ...item, routeOrder: moveItem(item.routeOrder, routeIndex, -1) } : item) }))} disabled={routeIndex === 0} aria-label="Move route earlier in specialized order" className="rounded-sm border border-chrome-line px-2 py-1 text-[10px] disabled:opacity-30">Up</button>
                      <button type="button" onClick={() => setDraft((current) => ({ ...current, capabilityOverrides: current.capabilityOverrides.map((item) => item.capabilityId === override.capabilityId ? { ...item, routeOrder: moveItem(item.routeOrder, routeIndex, 1) } : item) }))} disabled={routeIndex === override.routeOrder.length - 1} aria-label="Move route later in specialized order" className="rounded-sm border border-chrome-line px-2 py-1 text-[10px] disabled:opacity-30">Down</button>
                    </li>
                  ))}
                </ol>
              </article>
            )
          })}
        </div>
      </section>

      <section className="panel rounded-sm border border-chrome-line p-4" aria-labelledby="portability-heading">
        <h3 id="portability-heading" className="text-sm font-semibold text-chrome-ink">Private policy portability</h3>
        <p className="mt-1 text-xs text-chrome-mut">Exports are private local artifacts. They contain route labels and preferences, never provider credentials or raw work content.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={exportPolicy} className="rounded-sm border border-sync/50 px-3 py-2 text-xs text-sync hover:bg-sync/10">Export policy</button>
          <button type="button" onClick={() => importInputRef.current?.click()} className="rounded-sm border border-memory/50 px-3 py-2 text-xs text-memory hover:bg-memory/10">Choose import file</button>
          <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImportFile(file); event.target.value = '' }} />
        </div>
        {stagedImport?.status === 'invalid' && (
          <div className="mt-3 rounded-sm border border-rose-500/40 p-3 text-xs text-rose-300" role="alert">
            Import rejected; active policy unchanged. {stagedImport.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}
          </div>
        )}
        {stagedImport?.status === 'ready' && (
          <div className="mt-3 rounded-sm border border-memory/40 p-3">
            <p className="text-xs font-semibold text-chrome-ink">Validated import preview</p>
            <dl className="mt-2 grid gap-2 text-xs text-chrome-mut sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-chrome-ink">Routes added</dt><dd>{stagedImport.preview.addedRouteIds.join(', ') || 'None'}</dd></div>
              <div><dt className="text-chrome-ink">Routes removed</dt><dd>{stagedImport.preview.removedRouteIds.join(', ') || 'None'}</dd></div>
              <div><dt className="text-chrome-ink">Capabilities added</dt><dd>{stagedImport.preview.addedCapabilityIds.join(', ') || 'None'}</dd></div>
              <div><dt className="text-chrome-ink">Capabilities removed</dt><dd>{stagedImport.preview.removedCapabilityIds.join(', ') || 'None'}</dd></div>
              <div><dt className="text-chrome-ink">Availability changes</dt><dd>{stagedImport.preview.availabilityChanges.map((change) => `${change.routeId}: ${change.from} → ${change.to}`).join(', ') || 'None'}</dd></div>
              <div><dt className="text-chrome-ink">Order changes</dt><dd>{stagedImport.preview.defaultOrderChanged || stagedImport.preview.capabilityOverrideOrderChanged ? 'Yes' : 'None'}</dd></div>
            </dl>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={applyImport} className="rounded-sm bg-memory px-3 py-2 text-xs font-semibold text-chrome">Apply validated import</button>
              <button type="button" onClick={() => setStagedImport(undefined)} className="rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-mut">Cancel</button>
            </div>
          </div>
        )}
      </section>
    </section>
  )
}

export function ModelRoutingView(props: ModelRoutingViewProps) {
  const [mode, setMode] = useState<'guided' | 'advanced'>(() => props.ticket ? 'advanced' : 'guided')

  return (
    <section className="space-y-5" aria-labelledby="routing-page-heading">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between xl:flex-nowrap">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-sync">Local routing preferences</p>
          <h1 id="routing-page-heading" className="mt-1 text-2xl font-semibold text-chrome-ink">Choose who handles each kind of work</h1>
          <p className="mt-1 max-w-3xl text-sm text-chrome-mut">
            Start with a plain-language setup. Advanced keeps every detailed route, capability, order, import, and export control from Spec 004.
          </p>
        </div>
        <div className="inline-flex w-full shrink-0 rounded-sm border border-chrome-line bg-chrome p-1 sm:w-auto" role="tablist" aria-label="Routing setup mode">
          {(['guided', 'advanced'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={`min-h-10 flex-1 rounded-sm px-4 py-2 text-xs font-semibold capitalize sm:flex-none ${mode === value ? 'bg-sync text-white' : 'text-chrome-mut hover:text-chrome-ink'}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {mode === 'guided' ? (
        <GuidedRoutingSetup
          legacyPolicy={props.policy}
          operationalRepository={props.operationalRepository}
          onOpenUsage={props.onOpenUsage}
        />
      ) : (
        <AdvancedRoutingPolicy {...props} />
      )}
      <DispatchHistory operationalRepository={props.operationalRepository} />
    </section>
  )
}
