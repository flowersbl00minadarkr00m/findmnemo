import { useEffect, useMemo, useState } from 'react'
import type {
  DestinationDiscoveryDto,
  DestinationModelCatalogDto,
  OperationalPolicyMigrationPreview,
  OperationalRoutingPolicy,
  RoutingExecutionProfile,
} from '../../../shared/companion-contract'
import type { ModelRoutingPolicy } from '../../types'
import type { OperationalRepository } from '../../lib/operational-repository'
import {
  migrateModelRoutingPolicyV1ToV2,
  validateOperationalRoutingPolicy,
} from '../../lib/model-routing'
import { RoutingPreview } from './RoutingPreview'

interface Props {
  legacyPolicy: ModelRoutingPolicy
  operationalRepository?: OperationalRepository
}

type ToolChoice = 'pi-rpc' | 'manual'

const EMPTY_READINESS: RoutingExecutionProfile['readiness'] = {
  state: 'unchecked',
  checkedAt: null,
  expiresAt: null,
  adapterVersion: null,
  installedVersion: null,
  reasonCode: null,
}

function safeId(label: string): string {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'profile'
  return `profile:${stem}:${crypto.randomUUID().slice(0, 8)}`
}

function describeError(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : ''
  if (code === 'ROUTING_POLICY_CONFLICT') return 'The policy changed in another window or chat. Reloaded the current version; review your choices and save again.'
  return cause instanceof Error ? cause.message : 'The companion could not complete that routing operation.'
}

export function GuidedRoutingSetup({ legacyPolicy, operationalRepository }: Props) {
  const [policy, setPolicy] = useState<OperationalRoutingPolicy | null>()
  const [discovery, setDiscovery] = useState<DestinationDiscoveryDto>()
  const [catalog, setCatalog] = useState<DestinationModelCatalogDto>()
  const [migration, setMigration] = useState<OperationalPolicyMigrationPreview>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const [tool, setTool] = useState<ToolChoice>('pi-rpc')
  const [displayName, setDisplayName] = useState('Writing with Pi')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [effort, setEffort] = useState('')
  const [capabilityIds, setCapabilityIds] = useState<string[]>(['creation.writing'])
  const [enabled, setEnabled] = useState(false)
  const [behavior, setBehavior] = useState<'recommend' | 'auto-exact'>('recommend')
  const [savedProfileId, setSavedProfileId] = useState<string>()

  const operational = Boolean(
    operationalRepository?.getRoutingPolicy
    && operationalRepository.updateRoutingPolicy
    && operationalRepository.discoverRoutingDestinations,
  )

  useEffect(() => {
    if (!operationalRepository?.getRoutingPolicy) return
    let active = true
    void operationalRepository.getRoutingPolicy()
      .then((next) => { if (active) setPolicy(next) })
      .catch((cause) => { if (active) { setPolicy(null); setMessage(describeError(cause)) } })
    void operationalRepository.getPiModelCatalog?.()
      .then((next) => { if (active) setCatalog(next) })
      .catch(() => undefined)
    return () => { active = false }
  }, [operationalRepository])

  const capabilities = policy?.capabilities ?? legacyPolicy.capabilities
  const models = useMemo(() => catalog?.models.filter((model) => !providerId || model.providerId === providerId) ?? [], [catalog, providerId])
  const providers = useMemo(() => [...new Set(catalog?.models.map((model) => model.providerId) ?? [])].sort(), [catalog])
  const selectedModel = catalog?.models.find((model) => model.providerId === providerId && model.modelId === modelId)
  const selectedProfile = policy?.profiles.find((profile) => profile.id === savedProfileId)
  const piDetection = discovery?.destinations.find((destination) => destination.adapterId === 'pi-rpc')
  const legacyHasConfiguration = legacyPolicy.routes.length > 0

  async function reloadPolicy() {
    if (!operationalRepository?.getRoutingPolicy) return null
    const current = await operationalRepository.getRoutingPolicy()
    setPolicy(current)
    return current
  }

  async function checkTools() {
    if (!operationalRepository?.discoverRoutingDestinations) return
    setBusy(true)
    setMessage(undefined)
    try {
      const nextDiscovery = await operationalRepository.discoverRoutingDestinations()
      setDiscovery(nextDiscovery)
      if (nextDiscovery.destinations.some((destination) => destination.adapterId === 'pi-rpc' && destination.installation === 'detected' && destination.compatibility === 'supported')) {
        const nextCatalog = await operationalRepository.refreshPiModelCatalog?.()
        if (nextCatalog) {
          setCatalog(nextCatalog)
          const first = nextCatalog.models[0]
          if (first) { setProviderId((value) => value || first.providerId); setModelId((value) => value || first.modelId) }
        }
      }
      setMessage('Tool check finished. Detection did not enable a profile or change routing behavior.')
    } catch (cause) {
      setMessage(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  function buildProfile(existing?: RoutingExecutionProfile): RoutingExecutionProfile {
    return {
      id: existing?.id ?? safeId(displayName),
      displayName: displayName.trim(),
      destinationAdapterId: tool,
      destinationInstanceId: tool === 'pi-rpc' ? 'pi:default' : `manual:${existing?.id ?? 'custom'}`,
      providerId: providerId.trim() || null,
      modelId: modelId.trim() || (tool === 'manual' ? 'manual' : ''),
      effort: tool === 'pi-rpc' && effort ? effort : null,
      capabilityIds,
      enabled,
      behavior: tool === 'manual' ? 'recommend' : behavior,
      fallbackOrder: existing?.fallbackOrder ?? policy?.profiles.length ?? 0,
      readiness: existing && existing.destinationAdapterId === tool && existing.providerId === (providerId.trim() || null) && existing.modelId === modelId.trim() && existing.effort === (effort || null)
        ? existing.readiness
        : EMPTY_READINESS,
    }
  }

  const draftProfile = buildProfile(selectedProfile)
  const canSave = operational && displayName.trim().length > 0 && capabilityIds.length > 0
    && (tool === 'manual' ? modelId.trim().length > 0 : Boolean(providerId && modelId && selectedModel))

  async function saveProfile() {
    if (!operationalRepository?.updateRoutingPolicy || !canSave) return
    setBusy(true)
    setMessage(undefined)
    try {
      const current = policy
      const profile = buildProfile(selectedProfile)
      const base: OperationalRoutingPolicy = current ?? {
        schemaVersion: '2.0.0',
        policyProfile: 'findmnemo.model-routing.v2',
        policyVersion: 0,
        updatedAt: new Date().toISOString(),
        capabilities: legacyPolicy.capabilities.map((capability) => ({ ...capability })),
        profiles: [],
        defaultProfileOrder: [],
        capabilityOverrides: [],
      }
      const exists = base.profiles.some((candidate) => candidate.id === profile.id)
      const profiles = exists ? base.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate) : [...base.profiles, profile]
      const order = exists ? [...base.defaultProfileOrder] : [...base.defaultProfileOrder, profile.id]
      const normalizedProfiles = profiles.map((candidate) => ({ ...candidate, fallbackOrder: order.indexOf(candidate.id) }))
      const next: OperationalRoutingPolicy = { ...base, updatedAt: new Date().toISOString(), profiles: normalizedProfiles, defaultProfileOrder: order }
      const validation = validateOperationalRoutingPolicy(next)
      if (!validation.valid) {
        setMessage(validation.issues.map((issue) => issue.message).join(' '))
        return
      }
      const saved = await operationalRepository.updateRoutingPolicy(next, current?.policyVersion ?? null)
      setPolicy(saved)
      setSavedProfileId(profile.id)
      setMessage(profile.enabled
        ? 'Profile saved and enabled by your explicit choice. Check the exact connection before automatic delegation.'
        : 'Profile saved but left off. It cannot be recommended or dispatched until you enable it.')
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ROUTING_POLICY_CONFLICT') await reloadPolicy()
      setMessage(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function validateConnection() {
    if (!savedProfileId || !policy || !operationalRepository?.validateRoutingProfile) return
    setBusy(true)
    try {
      const result = await operationalRepository.validateRoutingProfile(savedProfileId, policy.policyVersion)
      setPolicy(result.policy)
      setMessage(result.readiness.state === 'ready'
        ? 'Exact provider, model, effort, authentication visibility, and Pi protocol are ready for the displayed period.'
        : `Connection is ${result.readiness.state}. ${result.readiness.reasonCode ?? 'Review the tool guidance and try again.'}`)
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ROUTING_POLICY_CONFLICT') await reloadPolicy()
      setMessage(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function previewMigration() {
    if (!operationalRepository?.previewRoutingMigration) return
    setBusy(true)
    try {
      const localPreview = migrateModelRoutingPolicyV1ToV2(legacyPolicy, 0)
      setMigration(await operationalRepository.previewRoutingMigration(localPreview))
      setMessage('Migration preview created. Every imported profile remains recommendation-only and unchecked.')
    } catch (cause) { setMessage(describeError(cause)) } finally { setBusy(false) }
  }

  async function confirmMigration() {
    if (!migration || !operationalRepository?.commitRoutingMigration) return
    setBusy(true)
    try {
      const migrated = await operationalRepository.commitRoutingMigration(migration, crypto.randomUUID())
      setPolicy(migrated)
      setMigration(undefined)
      setMessage('Legacy policy migrated. No profile was made automatic or marked ready.')
    } catch (cause) { setMessage(describeError(cause)) } finally { setBusy(false) }
  }

  async function moveProfile(profileId: string, direction: -1 | 1) {
    if (!policy || !operationalRepository?.updateRoutingPolicy) return
    const index = policy.defaultProfileOrder.indexOf(profileId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= policy.defaultProfileOrder.length) return
    const order = [...policy.defaultProfileOrder]
    ;[order[index], order[target]] = [order[target], order[index]]
    const next = {
      ...policy,
      updatedAt: new Date().toISOString(),
      defaultProfileOrder: order,
      profiles: policy.profiles.map((profile) => ({ ...profile, fallbackOrder: order.indexOf(profile.id) })),
    }
    setBusy(true)
    try {
      setPolicy(await operationalRepository.updateRoutingPolicy(next, policy.policyVersion))
      setMessage('Backup order saved. The first enabled exact ready profile wins; otherwise FindMnemo asks in chat.')
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ROUTING_POLICY_CONFLICT') await reloadPolicy()
      setMessage(describeError(cause))
    } finally { setBusy(false) }
  }

  function chooseExistingProfile(profile: RoutingExecutionProfile) {
    setSavedProfileId(profile.id)
    setDisplayName(profile.displayName)
    setTool(profile.destinationAdapterId === 'pi-rpc' ? 'pi-rpc' : 'manual')
    setProviderId(profile.providerId ?? '')
    setModelId(profile.modelId)
    setEffort(profile.effort ?? '')
    setCapabilityIds(profile.capabilityIds)
    setEnabled(profile.enabled)
    setBehavior(profile.behavior)
  }

  if (!operational) {
    return (
      <section className="panel rounded-sm border border-memory/40 p-5" role="status">
        <h2 className="text-lg font-semibold text-chrome-ink">Connect the private companion to set up live routing</h2>
        <p className="mt-2 text-sm text-chrome-mut">Browser storage is not treated as proof that routing is live. This workspace can show the advanced local preference editor, but it cannot discover tools, validate a model, migrate a policy, or dispatch work.</p>
      </section>
    )
  }

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
      <div className="min-w-0 space-y-5">
        <section className="panel rounded-sm border border-chrome-line p-4 sm:p-5" aria-labelledby="routing-step-one">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="hud-label">Step 1</p><h2 id="routing-step-one" className="mt-1 text-lg font-semibold text-chrome-ink">Choose a tool</h2><p className="mt-1 text-sm text-chrome-mut">Checking only reads safe version and capability metadata. It never installs, signs in, or enables anything.</p></div>
            <button type="button" onClick={() => void checkTools()} disabled={busy} className="min-h-11 rounded-sm border border-sync/50 px-4 py-2 text-xs font-semibold text-sync disabled:opacity-40">{busy ? 'Checking...' : 'Check tools'}</button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" aria-label="Pi" onClick={() => setTool('pi-rpc')} aria-pressed={tool === 'pi-rpc'} className={`min-h-28 rounded-sm border p-4 text-left ${tool === 'pi-rpc' ? 'border-sync bg-sync/10' : 'border-chrome-line bg-chrome/40'}`}>
              <span className="block text-sm font-semibold text-chrome-ink">Pi</span>
              <span className="mt-1 block text-xs text-chrome-mut">Can execute an exact provider, model, and effort through local RPC.</span>
              <span className="mt-2 block text-[10px] font-mono uppercase text-memory">{piDetection ? `${piDetection.installation} / ${piDetection.compatibility}` : 'Not checked'}</span>
            </button>
            <button type="button" aria-label="Another tool (manual)" onClick={() => { setTool('manual'); setBehavior('recommend') }} aria-pressed={tool === 'manual'} className={`min-h-28 rounded-sm border p-4 text-left ${tool === 'manual' ? 'border-sync bg-sync/10' : 'border-chrome-line bg-chrome/40'}`}>
              <span className="block text-sm font-semibold text-chrome-ink">Another tool (manual)</span>
              <span className="mt-1 block text-xs text-chrome-mut">Save a recommendation for Codex, Claude Code, Gemini CLI, Hermes, or another surface without claiming FindMnemo can execute it.</span>
              <span className="mt-2 block text-[10px] font-mono uppercase text-chrome-mut">Recommendation only</span>
            </button>
          </div>
          {piDetection && <p className="mt-3 text-xs text-chrome-mut">Pi {piDetection.installedVersion ?? 'version unknown'} · supported {piDetection.supportedRange}. {piDetection.guidance}</p>}
        </section>

        <section className="panel rounded-sm border border-chrome-line p-4 sm:p-5" aria-labelledby="routing-step-two">
          <p className="hud-label">Step 2</p><h2 id="routing-step-two" className="mt-1 text-lg font-semibold text-chrome-ink">Choose the work and exact model</h2>
          {policy && policy.profiles.length > 0 && (
            <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Saved profiles">
              {policy.profiles.map((profile) => <button key={profile.id} type="button" onClick={() => chooseExistingProfile(profile)} className="shrink-0 rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-mut hover:text-chrome-ink">Edit {profile.displayName}</button>)}
            </div>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-chrome-mut sm:col-span-2">Profile name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 min-h-11 w-full rounded-sm border border-chrome-line bg-chrome px-3 text-sm text-chrome-ink" /></label>
            {tool === 'pi-rpc' ? (
              <>
                <label className="text-xs text-chrome-mut">Provider<select value={providerId} onChange={(event) => { setProviderId(event.target.value); setModelId(''); setEffort('') }} className="mt-1 min-h-11 w-full rounded-sm border border-chrome-line bg-chrome px-3 text-sm text-chrome-ink"><option value="">Choose provider...</option>{providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
                <label className="text-xs text-chrome-mut">Model<select value={modelId} onChange={(event) => { setModelId(event.target.value); setEffort('') }} className="mt-1 min-h-11 w-full rounded-sm border border-chrome-line bg-chrome px-3 text-sm text-chrome-ink"><option value="">Choose model...</option>{models.map((model) => <option key={`${model.providerId}:${model.modelId}`} value={model.modelId}>{model.displayName}</option>)}</select></label>
                <label className="text-xs text-chrome-mut">Effort<select value={effort} onChange={(event) => setEffort(event.target.value)} className="mt-1 min-h-11 w-full rounded-sm border border-chrome-line bg-chrome px-3 text-sm text-chrome-ink"><option value="">Default effort</option>{selectedModel?.supportedEfforts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              </>
            ) : (
              <>
                <label className="text-xs text-chrome-mut">Provider or tool<input value={providerId} onChange={(event) => setProviderId(event.target.value)} placeholder="e.g. Claude Code" className="mt-1 min-h-11 w-full rounded-sm border border-chrome-line bg-chrome px-3 text-sm text-chrome-ink" /></label>
                <label className="text-xs text-chrome-mut">Model label<input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="e.g. Sonnet" className="mt-1 min-h-11 w-full rounded-sm border border-chrome-line bg-chrome px-3 text-sm text-chrome-ink" /></label>
              </>
            )}
          </div>
          <fieldset className="mt-5"><legend className="text-xs font-semibold text-chrome-ink">What kind of work?</legend><div className="mt-2 flex flex-wrap gap-2">{capabilities.map((capability) => <label key={capability.id} className={`cursor-pointer rounded-full border px-3 py-2 text-xs ${capabilityIds.includes(capability.id) ? 'border-sync bg-sync/10 text-chrome-ink' : 'border-chrome-line text-chrome-mut'}`}><input type="checkbox" className="sr-only" checked={capabilityIds.includes(capability.id)} onChange={() => setCapabilityIds((current) => current.includes(capability.id) ? current.filter((id) => id !== capability.id) : [...current, capability.id])} />{capability.label}</label>)}</div></fieldset>
        </section>

        <section className="panel rounded-sm border border-chrome-line p-4 sm:p-5" aria-labelledby="routing-step-three">
          <p className="hud-label">Step 3</p><h2 id="routing-step-three" className="mt-1 text-lg font-semibold text-chrome-ink">Choose how much control to give it</h2>
          <div className="mt-4 space-y-3">
            <label className="flex items-start gap-3 rounded-sm border border-chrome-line p-3"><input type="checkbox" aria-label="Enable this profile" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-1" /><span><span className="block text-sm font-semibold text-chrome-ink">Enable this profile</span><span className="block text-xs text-chrome-mut">Saving alone does not enable it. Check this explicitly when you want FindMnemo to consider it.</span></span></label>
            <label className="block text-xs text-chrome-mut">When the work matches<select value={tool === 'manual' ? 'recommend' : behavior} disabled={tool === 'manual'} onChange={(event) => setBehavior(event.target.value as 'recommend' | 'auto-exact')} className="mt-1 min-h-11 w-full rounded-sm border border-chrome-line bg-chrome px-3 text-sm text-chrome-ink"><option value="recommend">Recommend it and ask me</option><option value="auto-exact">Delegate only on a clear exact match</option></select></label>
            {behavior === 'auto-exact' && tool === 'pi-rpc' && <p className="rounded-sm border border-memory/40 bg-memory/5 p-3 text-xs text-memory">Automatic delegation is a separate explicit choice. It still fails closed unless this exact profile has fresh ready evidence and the originating chat integration is active.</p>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={!canSave || busy} onClick={() => void saveProfile()} className="min-h-11 rounded-sm bg-sync px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Save profile</button>
            <button type="button" disabled={!savedProfileId || tool !== 'pi-rpc' || busy} onClick={() => void validateConnection()} className="min-h-11 rounded-sm border border-emerald-500/50 px-4 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-40">Check exact connection</button>
          </div>
          {policy && policy.defaultProfileOrder.length > 1 && (
            <div className="mt-5 border-t border-chrome-line pt-4">
              <h3 className="text-xs font-semibold text-chrome-ink">Backup order</h3>
              <p className="mt-1 text-xs text-chrome-mut">Use the buttons with a keyboard or pointer. The first eligible profile wins.</p>
              <ol className="mt-3 space-y-2">
                {policy.defaultProfileOrder.map((profileId, index) => {
                  const profile = policy.profiles.find((candidate) => candidate.id === profileId)
                  return <li key={profileId} className="flex min-w-0 items-center gap-2 rounded-sm border border-chrome-line px-3 py-2"><span className="w-5 shrink-0 text-xs font-mono text-chrome-mut">{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs text-chrome-ink">{profile?.displayName ?? profileId}</span><button type="button" aria-label={`Move ${profile?.displayName ?? profileId} earlier`} disabled={busy || index === 0} onClick={() => void moveProfile(profileId, -1)} className="rounded-sm border border-chrome-line px-2 py-1 text-[10px] disabled:opacity-30">Up</button><button type="button" aria-label={`Move ${profile?.displayName ?? profileId} later`} disabled={busy || index === policy.defaultProfileOrder.length - 1} onClick={() => void moveProfile(profileId, 1)} className="rounded-sm border border-chrome-line px-2 py-1 text-[10px] disabled:opacity-30">Down</button></li>
                })}
              </ol>
            </div>
          )}
        </section>

        {!policy && legacyHasConfiguration && (
          <section className="panel rounded-sm border border-memory/40 p-4" aria-labelledby="migration-heading">
            <h2 id="migration-heading" className="text-sm font-semibold text-chrome-ink">Existing advanced preferences found</h2>
            <p className="mt-1 text-xs text-chrome-mut">Review a one-time copy into the operational policy. Migration never marks a connection ready or enables automatic delegation.</p>
            {!migration ? <button type="button" onClick={() => void previewMigration()} disabled={busy} className="mt-3 rounded-sm border border-memory/50 px-3 py-2 text-xs text-memory">Preview migration</button> : <div className="mt-3 rounded-sm border border-chrome-line p-3"><p className="text-xs text-chrome-ink">{migration.policy.profiles.length} profile(s), all recommendation-only and unchecked.</p><button type="button" onClick={() => void confirmMigration()} disabled={busy} className="mt-3 rounded-sm bg-memory px-3 py-2 text-xs font-semibold text-chrome">Confirm migration</button></div>}
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
        <RoutingPreview profile={selectedProfile ?? draftProfile} capabilityLabel={capabilities.find((capability) => capability.id === capabilityIds[0])?.label ?? 'selected work'} configured={Boolean(savedProfileId)} />
        <section className="rounded-sm border border-chrome-line bg-chrome/40 p-4" aria-live="polite">
          <h3 className="text-sm font-semibold text-chrome-ink">Setup status</h3>
          {policy === undefined ? <p className="mt-2 text-xs text-chrome-mut">Loading companion policy...</p> : <p className="mt-2 text-xs text-chrome-mut">Operational policy {policy ? `version ${policy.policyVersion}` : 'has not been created'}.</p>}
          {message && <p className="mt-2 break-words text-xs text-memory" role="status">{message}</p>}
          <p className="mt-3 text-[10px] leading-5 text-chrome-mut">Only normalized tool, model, readiness, and receipt metadata crosses into this browser. Provider credentials, prompts, results, raw CLI output, and private executable paths stay outside browser code.</p>
        </section>
      </aside>
    </div>
  )
}
