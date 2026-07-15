import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OperationalRoutingPolicyV3, ProjectFolderSummaryDto, RoutingConnectionCatalogDto, RoutingConnectionSummaryDto, RoutingProfileV3, UsageQueryDto, UsageRouteObservationDto, WorkTypeAssignmentDto } from '../../../shared/companion-contract'
import type { ModelRoutingPolicy } from '../../types'
import type { OperationalRepository } from '../../lib/operational-repository'

interface Props { legacyPolicy: ModelRoutingPolicy; operationalRepository: OperationalRepository; onOpenUsage?: (filters: UsageQueryDto) => void }

const EMPTY_READINESS: RoutingProfileV3['readiness'] = { state: 'unchecked', checkedAt: null, expiresAt: null, adapterVersion: null, installedVersion: null, reasonCode: null }

function emptyPolicy(legacyPolicy: ModelRoutingPolicy): OperationalRoutingPolicyV3 {
  const capabilities = legacyPolicy.capabilities.map((capability) => ({ ...capability }))
  return {
    schemaVersion: '3.0.0', policyProfile: 'findmnemo.model-routing.v3', policyVersion: 0, updatedAt: new Date().toISOString(), capabilities, profiles: [],
    assignments: [{ capabilityId: 'default', profileOrder: [], behavior: 'ask-before-send' }, ...capabilities.map((capability) => ({ capabilityId: capability.id, profileOrder: [], behavior: 'ask-before-send' as const }))],
  }
}

function explainConnection(connection: RoutingConnectionSummaryDto): string {
  if (connection.authState === 'required') return 'Sign-in is required in the tool that owns this connection.'
  if (connection.authState === 'invalid') return 'The saved authorization is no longer valid.'
  if (connection.authState === 'unsupported') return 'This installed version is not supported.'
  if (connection.authState === 'ready' && connection.enabled) return 'Ready to receive work.'
  if (connection.authState === 'ready') return 'Checked successfully. Turn it on when you are ready to use it.'
  return 'Not checked yet.'
}

function usagePeriod(): UsageQueryDto {
  const end = new Date()
  const start = new Date(end)
  start.setUTCMonth(start.getUTCMonth() - 12)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), clientId: null, providerId: null, modelId: null, profileId: null, mappingState: null }
}

const OBSERVATION_LABELS: Record<UsageRouteObservationDto['observation'], string> = {
  'most-used-route': 'Most-used route',
  'no-observed-usage': 'No observed usage',
  'high-estimated-cost-concentration': 'High estimated-cost concentration',
  'configured-but-unmapped': 'Configured but unmapped',
  'usage-evidence-incomplete': 'Usage evidence is incomplete',
}

export function ExecutableRoutingSetup({ legacyPolicy, operationalRepository, onOpenUsage }: Props) {
  const [connections, setConnections] = useState<RoutingConnectionSummaryDto[]>([])
  const [catalogs, setCatalogs] = useState<Record<string, RoutingConnectionCatalogDto>>({})
  const [folders, setFolders] = useState<ProjectFolderSummaryDto[]>([])
  const [policy, setPolicy] = useState<OperationalRoutingPolicyV3 | null>(null)
  const [busyId, setBusyId] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [connectionId, setConnectionId] = useState('')
  const [modelId, setModelId] = useState('')
  const [effort, setEffort] = useState('')
  const [profileName, setProfileName] = useState('')
  const [usageObservations, setUsageObservations] = useState<UsageRouteObservationDto[]>([])

  const workingPolicy = policy ?? emptyPolicy(legacyPolicy)
  const selectedConnection = connections.find((connection) => connection.id === connectionId)
  const selectedCatalog = connectionId ? catalogs[connectionId] : undefined
  const selectedModel = selectedCatalog?.models.find((model) => model.modelId === modelId)
  const executableProfiles = workingPolicy.profiles.filter((profile) => profile.kind === 'executable')
  const legacyProfiles = workingPolicy.profiles.filter((profile) => profile.kind === 'legacy-manual')

  const reload = useCallback(async () => {
    const [nextConnections, nextPolicy, nextFolders] = await Promise.all([
      operationalRepository.listRoutingConnections?.() ?? [],
      operationalRepository.getRoutingPolicyV3?.() ?? null,
      operationalRepository.listProjectFolders?.() ?? [],
    ])
    setConnections(nextConnections); setPolicy(nextPolicy); setFolders(nextFolders)
    const loadedCatalogs = await Promise.all(nextConnections.map(async (connection) => {
      try { return [connection.id, await operationalRepository.getRoutingConnectionCatalog?.(connection.id)] as const } catch { return [connection.id, undefined] as const }
    }))
    setCatalogs(Object.fromEntries(loadedCatalogs.filter((entry): entry is readonly [string, RoutingConnectionCatalogDto] => Boolean(entry[1]))))
  }, [operationalRepository])

  useEffect(() => { void reload().catch((cause) => setMessage(cause instanceof Error ? cause.message : 'Routing setup could not be loaded.')) }, [reload])

  useEffect(() => {
    if (!operationalRepository.getUsageRouteObservations || !policy) { setUsageObservations([]); return }
    let active = true
    void operationalRepository.getUsageRouteObservations(usagePeriod())
      .then((observations) => { if (active) setUsageObservations(observations) })
      .catch(() => { if (active) setUsageObservations([]) })
    return () => { active = false }
  }, [operationalRepository, policy])

  async function discover() {
    setBusyId('discover'); setMessage(undefined)
    try { setConnections(await operationalRepository.discoverRoutingConnections!()); setMessage('Engine check finished. Nothing was enabled or sent.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Engines could not be checked.') }
    finally { setBusyId(undefined) }
  }

  async function refresh(connection: RoutingConnectionSummaryDto) {
    setBusyId(connection.id); setMessage(undefined)
    try {
      const result = await operationalRepository.refreshRoutingConnection!(connection.id)
      setConnections((current) => current.map((value) => value.id === connection.id ? result.connection : value))
      setCatalogs((current) => ({ ...current, [connection.id]: result.catalog }))
      setMessage(`${connection.displayName} is checked. Review its models, then turn it on explicitly.`)
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : `${connection.displayName} could not be checked.`) }
    finally { setBusyId(undefined) }
  }

  async function toggleConnection(connection: RoutingConnectionSummaryDto) {
    setBusyId(connection.id); setMessage(undefined)
    try {
      const updated = await operationalRepository.setRoutingConnectionEnabled!(connection.id, !connection.enabled)
      setConnections((current) => current.map((value) => value.id === connection.id ? updated : value))
      setMessage(updated.enabled ? `${updated.displayName} is now available for saved routes.` : `${updated.displayName} is off. Saved route choices were preserved.`)
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The connection could not be changed.') }
    finally { setBusyId(undefined) }
  }

  async function connectOpenRouter() {
    setBusyId('openrouter'); setMessage(undefined)
    try {
      const pending = await operationalRepository.startOpenRouterConnection!()
      window.open(pending.authorizationUrl, '_blank', 'noopener,noreferrer')
      setMessage('OpenRouter authorization opened in a new browser tab. Return here and check the connection after approving it.')
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'OpenRouter authorization could not start.') }
    finally { setBusyId(undefined) }
  }

  async function persist(next: OperationalRoutingPolicyV3): Promise<OperationalRoutingPolicyV3> {
    const saved = await operationalRepository.updateRoutingPolicyV3!({ ...next, updatedAt: new Date().toISOString() }, policy?.policyVersion ?? null)
    setPolicy(saved); return saved
  }

  async function addProfile() {
    if (!selectedConnection?.enabled || !selectedModel || !profileName.trim()) return
    setBusyId('profile'); setMessage(undefined)
    const profile: RoutingProfileV3 = { id: `profile:${crypto.randomUUID()}`, displayName: profileName.trim(), kind: 'executable', connectionId: selectedConnection.id, providerId: selectedModel.providerId, modelId: selectedModel.modelId, effort: effort || null, readiness: EMPTY_READINESS, enabled: true }
    try {
      await persist({ ...workingPolicy, profiles: [...workingPolicy.profiles, profile] })
      await operationalRepository.validateRoutingProfileV3!(profile.id)
      setPolicy(await operationalRepository.getRoutingPolicyV3!())
      setProfileName(''); setModelId(''); setEffort('')
      setMessage(`${profile.displayName} is ready. Assign it to a kind of work below before it can be selected.`)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The route could not be validated.')
    } finally { setBusyId(undefined) }
  }

  async function updateAssignment(capabilityId: string, update: (assignment: WorkTypeAssignmentDto) => WorkTypeAssignmentDto) {
    const next = { ...workingPolicy, assignments: workingPolicy.assignments.map((assignment) => assignment.capabilityId === capabilityId ? update(assignment) : assignment) }
    setPolicy(next)
  }

  async function saveAssignments() {
    setBusyId('assignments'); setMessage(undefined)
    try { await persist(workingPolicy); setMessage('Work assignments saved. Automatic routes still run only when every connection and model check is current.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Assignments could not be saved.') }
    finally { setBusyId(undefined) }
  }

  async function removeLegacy(profileId: string) {
    try { await persist({ ...workingPolicy, profiles: workingPolicy.profiles.filter((profile) => profile.id !== profileId), assignments: workingPolicy.assignments.map((assignment) => ({ ...assignment, profileOrder: assignment.profileOrder.filter((id) => id !== profileId) })) }); setMessage('Inactive legacy route removed.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Legacy route could not be removed.') }
  }

  const providers = useMemo(() => [...new Set(selectedCatalog?.models.map((model) => model.providerId) ?? [])], [selectedCatalog])

  return <section className="space-y-5" aria-label="Executable engine routing setup">
    <section className="panel rounded-sm border border-chrome-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-[10px] font-mono uppercase tracking-[.18em] text-sync">Step 1</p><h2 className="mt-1 text-xl font-semibold text-chrome-ink">Connect the engines you already use</h2><p className="mt-1 max-w-3xl text-sm text-chrome-mut">FindMnemo checks local tools and accounts. Checking never installs, signs in, enables, or sends work.</p></div>
        <button type="button" onClick={() => void discover()} disabled={Boolean(busyId)} className="rounded-sm bg-memory px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-50">{busyId === 'discover' ? 'Checking…' : 'Check this computer'}</button>
      </div>
      {message && <p className="mt-3 rounded-sm border border-chrome-line bg-chrome/40 px-3 py-2 text-sm text-chrome-ink" role="status">{message}</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {connections.map((connection) => <article key={connection.id} className="rounded-sm border border-chrome-line bg-chrome/35 p-3">
          <div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-chrome-ink">{connection.displayName}</h3><p className="mt-1 text-xs text-chrome-mut">{explainConnection(connection)}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-mono ${connection.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-chrome-raised text-chrome-mut'}`}>{connection.enabled ? 'ON' : connection.authState.toUpperCase()}</span></div>
          <p className="mt-2 text-[10px] font-mono text-chrome-mut">Version {connection.installedVersion ?? 'not detected'} · Models {catalogs[connection.id]?.models.length ?? 'not checked'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {connection.adapterId === 'openrouter' && connection.authState !== 'ready' && <button type="button" onClick={() => void connectOpenRouter()} className="rounded-sm border border-memory/50 px-3 py-2 text-xs text-memory">Connect account</button>}
            <button type="button" onClick={() => void refresh(connection)} disabled={busyId === connection.id} className="rounded-sm border border-sync/50 px-3 py-2 text-xs text-sync disabled:opacity-50">Check connection</button>
            <button type="button" onClick={() => void toggleConnection(connection)} disabled={connection.authState !== 'ready' || !catalogs[connection.id] || busyId === connection.id} className="rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-ink disabled:opacity-40">{connection.enabled ? 'Turn off' : 'Turn on'}</button>
          </div>
        </article>)}
        {connections.length === 0 && <p className="text-sm text-chrome-mut">No engines have been checked yet.</p>}
      </div>
    </section>

    <section className="panel rounded-sm border border-chrome-line p-4">
      <p className="text-[10px] font-mono uppercase tracking-[.18em] text-sync">Step 2</p><h2 className="mt-1 text-xl font-semibold text-chrome-ink">Create an exact route</h2><p className="mt-1 text-sm text-chrome-mut">Choose a checked connection, then a model that connection actually reported. FindMnemo will not silently substitute another model.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-chrome-mut">Connection<select value={connectionId} onChange={(event) => { setConnectionId(event.target.value); setModelId(''); setEffort('') }} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink"><option value="">Choose a ready engine…</option>{connections.filter((value) => value.enabled && catalogs[value.id]).map((value) => <option key={value.id} value={value.id}>{value.displayName}</option>)}</select></label>
        <label className="text-xs text-chrome-mut">Model<select value={modelId} onChange={(event) => { setModelId(event.target.value); setEffort('') }} disabled={!selectedCatalog} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink disabled:opacity-50"><option value="">Choose a model…</option>{selectedCatalog?.models.map((model) => <option key={`${model.providerId}:${model.modelId}`} value={model.modelId}>{model.displayName} · {model.providerId}</option>)}</select></label>
        <label className="text-xs text-chrome-mut">Thinking effort<select value={effort} onChange={(event) => setEffort(event.target.value)} disabled={!selectedModel} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink disabled:opacity-50"><option value="">Provider default</option>{selectedModel?.supportedEfforts.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="text-xs text-chrome-mut">Route name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder={selectedConnection ? `${selectedConnection.displayName} route` : 'e.g. Careful writing'} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink" /></label>
      </div>
      <button type="button" onClick={() => void addProfile()} disabled={!selectedConnection?.enabled || !selectedModel || !profileName.trim() || busyId === 'profile'} className="mt-3 rounded-sm bg-memory px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-40">Check and add route</button>
      {providers.length > 1 && <p className="mt-2 text-xs text-chrome-mut">This connection reports models from {providers.length} providers. The provider is taken from the selected model.</p>}
    </section>

    <section className="panel rounded-sm border border-chrome-line p-4">
      <p className="text-[10px] font-mono uppercase tracking-[.18em] text-sync">Step 3</p><h2 className="mt-1 text-xl font-semibold text-chrome-ink">Choose who handles each kind of work</h2><p className="mt-1 text-sm text-chrome-mut">The first ready route is primary. Routes after it are backups in order. “Ask first” recommends; “Send automatically” lets an active connected chat dispatch without a second trip to FindMnemo.</p>
      <div className="mt-4 space-y-3">{workingPolicy.assignments.map((assignment) => {
        const label = assignment.capabilityId === 'default' ? 'Everything else' : workingPolicy.capabilities.find((capability) => capability.id === assignment.capabilityId)?.label ?? assignment.capabilityId
        const available = executableProfiles.filter((profile) => !assignment.profileOrder.includes(profile.id))
        return <article key={assignment.capabilityId} className="rounded-sm border border-chrome-line bg-chrome/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-chrome-ink">{label}</h3><p className="text-xs text-chrome-mut">{assignment.profileOrder.length ? assignment.profileOrder.map((id) => executableProfiles.find((profile) => profile.id === id)?.displayName ?? id).join(' → ') : 'No route assigned'}</p></div><select aria-label={`Behavior for ${label}`} value={assignment.behavior} onChange={(event) => void updateAssignment(assignment.capabilityId, (value) => ({ ...value, behavior: event.target.value as WorkTypeAssignmentDto['behavior'] }))} className="rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-xs text-chrome-ink"><option value="ask-before-send">Ask first</option><option value="send-automatically">Send automatically</option></select></div>
          <ol className="mt-2 space-y-1">{assignment.profileOrder.map((profileId, index) => <li key={profileId} className="flex items-center gap-2 rounded-sm border border-chrome-line px-2 py-2 text-xs"><span className="w-5 font-mono text-chrome-mut">{index + 1}</span><span className="min-w-0 flex-1 truncate text-chrome-ink">{executableProfiles.find((profile) => profile.id === profileId)?.displayName ?? profileId}</span><button type="button" disabled={index === 0} onClick={() => void updateAssignment(assignment.capabilityId, (value) => ({ ...value, profileOrder: move(value.profileOrder, index, -1) }))}>Up</button><button type="button" disabled={index === assignment.profileOrder.length - 1} onClick={() => void updateAssignment(assignment.capabilityId, (value) => ({ ...value, profileOrder: move(value.profileOrder, index, 1) }))}>Down</button><button type="button" onClick={() => void updateAssignment(assignment.capabilityId, (value) => ({ ...value, profileOrder: value.profileOrder.filter((id) => id !== profileId) }))} className="text-rose-300">Remove</button></li>)}</ol>
          {available.length > 0 && <select aria-label={`Add route for ${label}`} value="" onChange={(event) => { const id = event.target.value; if (id) void updateAssignment(assignment.capabilityId, (value) => ({ ...value, profileOrder: [...value.profileOrder, id] })) }} className="mt-2 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-xs text-chrome-ink"><option value="">Add a primary or backup…</option>{available.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName} · {profile.readiness.state}</option>)}</select>}
        </article>
      })}</div>
      <button type="button" onClick={() => void saveAssignments()} disabled={busyId === 'assignments'} className="mt-3 rounded-sm bg-memory px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-50">Save work assignments</button>
    </section>

    <section className="grid gap-3 lg:grid-cols-2">
      <article className="panel rounded-sm border border-chrome-line p-4"><h2 className="text-sm font-semibold text-chrome-ink">Project context</h2><p className="mt-1 text-xs text-chrome-mut">{folders.length ? `${folders.filter((folder) => folder.state === 'active').length} approved project folder(s) are available to connected chats. The chat can choose one by its private ID; raw paths never enter the browser.` : 'No project folders are connected. Routes use an empty local scratch folder, which is safe for general writing and questions.'}</p></article>
      <article className="panel rounded-sm border border-chrome-line p-4"><h2 className="text-sm font-semibold text-chrome-ink">Inactive old routes</h2>{legacyProfiles.length ? <ul className="mt-2 space-y-2">{legacyProfiles.map((profile) => <li key={profile.id} className="flex items-center justify-between gap-2 text-xs"><span className="text-chrome-mut">{profile.displayName} · cannot dispatch</span><button type="button" onClick={() => void removeLegacy(profile.id)} className="text-rose-300">Remove</button></li>)}</ul> : <p className="mt-1 text-xs text-chrome-mut">No inactive manual routes remain.</p>}</article>
    </section>

    <section className="panel rounded-sm border border-chrome-line p-4" aria-labelledby="route-evidence-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="route-evidence-heading" className="text-sm font-semibold text-chrome-ink">Observed evidence</h2><p className="mt-1 text-xs text-chrome-mut">Past local usage can inform your choice, but FindMnemo never reorders routes automatically. Cost is estimated when shown; latency is unknown until a destination reports it.</p></div>
        {onOpenUsage && <button type="button" onClick={() => onOpenUsage(usagePeriod())} className="rounded-sm border border-sync/50 px-3 py-2 text-xs text-sync">Open model usage</button>}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {executableProfiles.map((profile) => {
          const observation = usageObservations.find((value) => value.profileId === profile.id)
          const connection = connections.find((value) => value.id === profile.connectionId)
          const locality = connection?.adapterId === 'ollama-local' ? 'Local runtime' : connection ? 'Connected destination' : 'Unknown destination'
          return <article key={profile.id} className="rounded-sm border border-chrome-line bg-chrome/30 p-3 text-xs">
            <h3 className="font-semibold text-chrome-ink">{profile.displayName}</h3>
            <p className="mt-1 text-chrome-mut">{observation ? OBSERVATION_LABELS[observation.observation] : 'No usage evidence available'}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-chrome-mut"><dt>Tokens</dt><dd className="text-right text-chrome-ink">{observation?.totalTokens?.toLocaleString() ?? 'Unknown'}</dd><dt>Estimated cost</dt><dd className="text-right text-chrome-ink">{observation?.estimatedCost == null ? 'Unknown' : `$${observation.estimatedCost.toFixed(2)}`}</dd><dt>Locality</dt><dd className="text-right text-chrome-ink">{locality}</dd><dt>Latency</dt><dd className="text-right text-chrome-ink">Unknown</dd></dl>
            <p className="mt-2 font-mono text-[10px] text-chrome-mut">Provenance: local usage records · {observation?.periodStart && observation.periodEnd ? `${observation.periodStart} to ${observation.periodEnd}` : 'freshness unknown'}{observation && !observation.coverageComplete ? ' · partial coverage' : ''}</p>
          </article>
        })}
        {executableProfiles.length === 0 && <p className="text-xs text-chrome-mut">Create a checked route to compare its local usage evidence.</p>}
      </div>
    </section>
  </section>
}

function move(values: string[], index: number, direction: -1 | 1): string[] { const target = index + direction; if (target < 0 || target >= values.length) return values; const next = [...values]; [next[index], next[target]] = [next[target], next[index]]; return next }
