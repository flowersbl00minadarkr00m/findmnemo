import { lazy, Suspense, useState, useCallback, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { AttentionAction, AttentionItem, HomeView, MetricsView, Ticket, AgentActivity, View, LLMSource, ModelRoutingPolicy } from './types'
import type { OperationalRepository } from './lib/operational-repository'
import type { GmailSourceStatus } from './lib/operational-repository'
import type { AgentActivityAssignmentSummaryDto, AgentActivityIntegrationDto, CompletedRangePreset, GmailCandidateDto, GmailCheckDto, ProjectFolderSummaryDto, ReconciliationRunDto, SourceDescriptor, SourceId, UsageQueryDto } from '../shared/companion-contract'
import { pollReconciliationRun, recordReconciliationTelemetry } from './lib/reconciliation'
import {
  MODEL_ROUTING_POLICY_CHANGED_EVENT,
  MODEL_ROUTING_POLICY_STORAGE_KEY,
  loadModelRoutingPolicy,
} from './lib/model-routing-storage'
import { createEmptyModelRoutingPolicy } from './lib/model-routing'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { OperationsDesk } from './components/OperationsDesk'
import { projectAttentionWorkspace } from './lib/attention-workspace'
import { loadHomeViewPreference, saveHomeViewPreference, saveMetricsViewPreference } from './lib/view-preference'
import { MetricsViewSwitch } from './components/WorkspaceViewSwitch'
import { TicketBoard } from './components/TicketBoard'
import { NewTicketForm } from './components/NewTicketForm'
import { CommandPalette } from './components/CommandPalette'
import { FilterBar, type TicketFilters } from './components/FilterBar'
import { TicketDetail } from './components/TicketDetail'
import { LegacyMigrationPanel } from './components/LegacyMigrationPanel'
import { CompletedWorkPanel } from './components/CompletedWorkPanel'
import { loadCompletedWorkPreference, saveCompletedWorkPreference } from './lib/completed-work-preference'
import { SourceSetup } from './components/SourceSetup'
import { ActiveAssignmentsPanel } from './components/ActiveAssignmentsPanel'

const Analytics = lazy(() => import('./components/Analytics').then((module) => ({ default: module.Analytics })))
const DailyBrief = lazy(() => import('./components/DailyBrief').then((module) => ({ default: module.DailyBrief })))
const EmailPanel = lazy(() => import('./components/EmailPanel').then((module) => ({ default: module.EmailPanel })))
const ModelRoutingView = lazy(() => import('./components/ModelRoutingView').then((module) => ({ default: module.ModelRoutingView })))
const UsageView = lazy(() => import('./components/UsageView').then((module) => ({ default: module.UsageView })))
const DataPrivacyView = lazy(() => import('./components/DataPrivacyView').then((module) => ({ default: module.DataPrivacyView })))

interface RoutingPolicyState {
  policy: ModelRoutingPolicy
  issue?: string
}

function loadInitialRoutingPolicy(): RoutingPolicyState {
  const result = loadModelRoutingPolicy()
  if (result.status === 'empty' || result.status === 'loaded') return { policy: result.policy }
  return {
    policy: createEmptyModelRoutingPolicy(),
    issue: result.status === 'invalid'
      ? 'Stored data is invalid and was left unchanged. Import or save a valid replacement when ready.'
      : result.status === 'error' ? result.message : undefined,
  }
}

export default function App({ operationalRepository }: { operationalRepository: OperationalRepository }) {
  const initialCompletedPreference = useMemo(() => loadCompletedWorkPreference(typeof window === 'undefined' ? undefined : window.localStorage), [])
  const [view, setView] = useState<View>(() => loadHomeViewPreference(typeof window === 'undefined' ? undefined : window.localStorage))
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [operationalTicketState, setOperationalTicketState] = useState<'loading' | 'current' | 'stale' | 'error'>('loading')
  const [operationalTicketError, setOperationalTicketError] = useState<string>()
  const [activities] = useState<AgentActivity[]>([])
  const [gmailCandidates, setGmailCandidates] = useState<GmailCandidateDto[]>([])
  const [gmailCheck, setGmailCheck] = useState<GmailCheckDto>()
  const [gmailSourceStatus, setGmailSourceStatus] = useState<GmailSourceStatus>()
  const [gmailError, setGmailError] = useState<string>()
  const [routingPolicyState, setRoutingPolicyState] = useState<RoutingPolicyState>(loadInitialRoutingPolicy)
  const [emailLoading, setEmailLoading] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [filters, setFilters] = useState<TicketFilters>({ query: '', sources: [] })
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [routingTicketId, setRoutingTicketId] = useState<string | null>(null)
  const [usageInitialFilters, setUsageInitialFilters] = useState<UsageQueryDto>()
  const [reconciliationRun, setReconciliationRun] = useState<ReconciliationRunDto>()
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRunDto[]>([])
  const [reconciliationSources, setReconciliationSources] = useState<SourceDescriptor[]>([])
  const [reconciliationBusy, setReconciliationBusy] = useState(false)
  const [reconciliationError, setReconciliationError] = useState<string>()
  const [lastReconciliationSuccess, setLastReconciliationSuccess] = useState<string>()
  const [selectedAttentionId, setSelectedAttentionId] = useState<string>()
  const [chooseGmailThreadId, setChooseGmailThreadId] = useState<string>()
  const [ticketMode, setTicketMode] = useState<'active' | 'completed'>(initialCompletedPreference.mode)
  const [completedPreset, setCompletedPreset] = useState<CompletedRangePreset>(initialCompletedPreference.preset)
  const [showSourceSetup, setShowSourceSetup] = useState<boolean | null>(null)
  const [agentAssignments, setAgentAssignments] = useState<AgentActivityAssignmentSummaryDto[]>([])
  const [agentAssignmentCursor, setAgentAssignmentCursor] = useState<string | null>(null)
  const [agentIntegrations, setAgentIntegrations] = useState<AgentActivityIntegrationDto[]>([])
  const [agentProjects, setAgentProjects] = useState<ProjectFolderSummaryDto[]>([])
  const [agentActivityLoading, setAgentActivityLoading] = useState(false)
  const [agentActivityError, setAgentActivityError] = useState<string>()

  useEffect(() => { saveCompletedWorkPreference(window.localStorage, { mode: ticketMode, preset: completedPreset }) }, [completedPreset, ticketMode])

  useEffect(() => {
    let active = true
    if (!operationalRepository.getOnboardingSnapshot) {
      setShowSourceSetup(false)
      return () => { active = false }
    }
    operationalRepository.getOnboardingSnapshot().then((snapshot) => { if (active) setShowSourceSetup(snapshot.needsSetup) }).catch(() => { if (active) setShowSourceSetup(false) })
    return () => { active = false }
  }, [operationalRepository])

  const refreshOperationalTickets = useCallback(async () => {
    setOperationalTicketState((state) => state === 'current' ? 'current' : 'loading')
    try {
      const nextTickets = await operationalRepository.listTickets()
      setTickets(nextTickets)
      setOperationalTicketState('current')
      setOperationalTicketError(undefined)
    } catch (cause) {
      setOperationalTicketState((state) => tickets.length > 0 || state === 'current' ? 'stale' : 'error')
      setOperationalTicketError(cause instanceof Error ? cause.message : 'Companion ticket request failed.')
    }
  }, [operationalRepository, tickets.length])

  useEffect(() => {
    void refreshOperationalTickets()
  }, [refreshOperationalTickets])

  const refreshAgentActivity = useCallback(async () => {
    if (!operationalRepository.listAgentActivityAssignments) return
    setAgentActivityLoading(true)
    try {
      const [page, integrations, projects] = await Promise.all([
        operationalRepository.listAgentActivityAssignments({ scope: 'active', limit: 25 }),
        operationalRepository.listAgentActivityIntegrations?.() ?? Promise.resolve([]),
        operationalRepository.listProjectFolders?.() ?? Promise.resolve([]),
      ])
      setAgentAssignments(page.items)
      setAgentAssignmentCursor(page.nextCursor)
      setAgentIntegrations(integrations)
      setAgentProjects(projects)
      setAgentActivityError(undefined)
    } catch (cause) { setAgentActivityError(cause instanceof Error ? cause.message : 'Agent activity is unavailable.') }
    finally { setAgentActivityLoading(false) }
  }, [operationalRepository])

  useEffect(() => { void refreshAgentActivity() }, [refreshAgentActivity])

  const loadMoreAgentActivity = useCallback(async () => {
    if (!agentAssignmentCursor || !operationalRepository.listAgentActivityAssignments) return
    setAgentActivityLoading(true)
    try {
      const page = await operationalRepository.listAgentActivityAssignments({ scope: 'active', limit: 25, cursor: agentAssignmentCursor })
      setAgentAssignments((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
      setAgentAssignmentCursor(page.nextCursor)
      setAgentActivityError(undefined)
    } catch (cause) { setAgentActivityError(cause instanceof Error ? cause.message : 'More assignments could not be loaded.') }
    finally { setAgentActivityLoading(false) }
  }, [agentAssignmentCursor, operationalRepository])

  const updateAgentAssignment = useCallback(async (assignmentId: string, input: Parameters<NonNullable<OperationalRepository['updateAgentActivityAssignment']>>[1]) => {
    if (!operationalRepository.updateAgentActivityAssignment) throw new Error('Assignment controls are unavailable.')
    const updated = await operationalRepository.updateAgentActivityAssignment(assignmentId, input)
    setAgentAssignments((current) => updated.sourceUpdatePolicy === 'closed' || updated.terminalOutcome
      ? current.filter((item) => item.id !== updated.id)
      : current.map((item) => item.id === updated.id ? updated : item))
    await refreshOperationalTickets()
    return updated
  }, [operationalRepository, refreshOperationalTickets])

  const refreshOperationalEmails = useCallback(async () => {
    if (!operationalRepository?.listEmailCandidates) return
    try {
      const [candidates, status] = await Promise.all([
        operationalRepository.listEmailCandidates(),
        operationalRepository.getGmailSourceStatus?.(),
      ])
      setGmailCandidates(candidates)
      if (status) setGmailSourceStatus(status)
      setGmailError(undefined)
    } catch (cause) {
      setGmailError(cause instanceof Error ? cause.message : 'Gmail candidate refresh failed.')
    }
  }, [operationalRepository])

  useEffect(() => { void refreshOperationalEmails() }, [refreshOperationalEmails])

  useEffect(() => {
    if (!operationalRepository?.listReconciliationSources || !operationalRepository.listReconciliationRuns) return
    void Promise.all([operationalRepository.listReconciliationSources(), operationalRepository.listReconciliationRuns()])
      .then(([sources, runs]) => {
        setReconciliationSources(sources)
        setReconciliationRuns(runs)
        setReconciliationRun(runs[0])
        setLastReconciliationSuccess(runs.find((run) => run.state === 'complete')?.finishedAt)
      })
      .catch((cause) => setReconciliationError(cause instanceof Error ? cause.message : 'Reconciliation history is unavailable.'))
  }, [operationalRepository])

  useEffect(() => {
    const refreshRoutingPolicy = () => {
      const result = loadModelRoutingPolicy()
      if (result.status === 'empty' || result.status === 'loaded') {
        setRoutingPolicyState({ policy: result.policy })
        return
      }
      setRoutingPolicyState((current) => ({
        ...current,
        issue: result.status === 'invalid'
          ? 'Stored data is invalid and was left unchanged.'
          : result.status === 'error' ? result.message : undefined,
      }))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === MODEL_ROUTING_POLICY_STORAGE_KEY) refreshRoutingPolicy()
    }
    window.addEventListener('storage', handleStorage)
    window.addEventListener(MODEL_ROUTING_POLICY_CHANGED_EVENT, refreshRoutingPolicy)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(MODEL_ROUTING_POLICY_CHANGED_EVENT, refreshRoutingPolicy)
    }
  }, [])

  // Global ⌘K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleCreate = useCallback((title: string, description: string, source: LLMSource) => {
    void operationalRepository.createTicket(title, description, source)
      .then((ticket) => { setTickets((prev) => [...prev, ticket]); setOperationalTicketState('current') })
      .catch((cause) => { setOperationalTicketState('stale'); setOperationalTicketError(cause instanceof Error ? cause.message : 'Ticket creation failed.') })
  }, [operationalRepository])

  const performStatusChange = useCallback(async (id: string, status: Ticket['status']) => {
    const ticket = tickets.find((item) => item.id === id)
    if (!ticket) throw new Error('Ticket is no longer available. Refresh and review the current queue.')
    try {
      const updated = await operationalRepository.updateTicketStatus(ticket, status)
      setTickets((prev) => prev.map((item) => item.id === id ? updated : item))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Ticket update failed.'
      setOperationalTicketState('stale')
      setOperationalTicketError(message)
      throw cause
    }
  }, [operationalRepository, tickets])

  const handleStatusChange = useCallback((id: string, status: Ticket['status']) => {
    void performStatusChange(id, status).catch(() => undefined)
  }, [performStatusChange])

  const handleAddNote = useCallback((id: string, text: string) => {
    const ticket = tickets.find((item) => item.id === id)
    if (!ticket) return
    void operationalRepository.addWorkNote(ticket, text, 'Henry')
      .then((updated) => setTickets((prev) => prev.map((item) => item.id === id ? updated : item)))
      .catch((cause) => { setOperationalTicketState('stale'); setOperationalTicketError(cause instanceof Error ? cause.message : 'Note update failed.') })
  }, [operationalRepository, tickets])

  const handleDelete = useCallback((id: string) => {
    void operationalRepository.deleteTicket(id)
      .then(() => setTickets((prev) => prev.filter((ticket) => ticket.id !== id)))
      .catch((cause) => { setOperationalTicketState('stale'); setOperationalTicketError(cause instanceof Error ? cause.message : 'Ticket deletion failed.') })
  }, [operationalRepository])

  const handleRecommendRoute = useCallback((ticket: Ticket) => {
    setRoutingTicketId(ticket.id)
    setDetailId(null)
    setView('routing')
  }, [])

  const handleRefreshEmails = useCallback(async () => {
    if (!operationalRepository.startGmailCheck || !operationalRepository.getGmailCheck) return
    setEmailLoading(true)
    setGmailError(undefined)
    try {
      let run = await operationalRepository.startGmailCheck()
      setGmailCheck(run)
      while (run.state === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 500))
        run = await operationalRepository.getGmailCheck(run.id)
        setGmailCheck(run)
      }
      await refreshOperationalEmails()
      if (run.state === 'failed') setGmailError(run.errorCode ?? 'Gmail check failed.')
    } catch (cause) {
      setGmailError(cause instanceof Error ? cause.message : 'Gmail check failed.')
    } finally {
      setEmailLoading(false)
    }
  }, [operationalRepository, refreshOperationalEmails])

  const handleConnectGmail = useCallback(async () => {
    if (!operationalRepository.connectGmail) return
    const consentWindow = window.open('about:blank', '_blank')
    if (!consentWindow) {
      setGmailError('POPUP_BLOCKED: allow pop-ups for FindMnemo, then reconnect Gmail.')
      return
    }
    consentWindow.opener = null
    setEmailLoading(true)
    setGmailError(undefined)
    try {
      const authorizationUrl = await operationalRepository.connectGmail()
      consentWindow.location.replace(authorizationUrl)
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        const status = await operationalRepository.getGmailSourceStatus?.()
        if (status?.connected) {
          setGmailSourceStatus(status)
          await handleRefreshEmails()
          return
        }
      }
      setGmailError('OAUTH_TIMEOUT: Google consent did not complete. Reconnect Gmail to try again.')
    } catch (cause) {
      consentWindow.close()
      setGmailError(cause instanceof Error ? cause.message : 'Gmail authorization did not complete.')
    } finally {
      setEmailLoading(false)
    }
  }, [handleRefreshEmails, operationalRepository])

  const handleEmailDecision = useCallback(async (candidate: GmailCandidateDto, action: 'confirm' | 'dismiss' | 'defer') => {
    if (!operationalRepository?.decideEmailCandidate) return
    setGmailError(undefined)
    try {
      const updated = await operationalRepository.decideEmailCandidate(candidate, action)
      setGmailCandidates((current) => current.map((item) => item.accountId === updated.accountId && item.threadId === updated.threadId ? updated : item))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Candidate decision failed.'
      setGmailError(message === 'RECORD_CHANGED' ? 'RECORD_CHANGED: refresh before retrying; the newer decision was preserved.' : message)
    }
  }, [operationalRepository])

  const handleEmailAssociation = useCallback(async (
    candidate: GmailCandidateDto,
    input: { mode: 'create'; ticket: Ticket } | { mode: 'link'; ticketId: string },
    idempotencyKey: string,
  ) => {
    if (!operationalRepository?.associateEmailCandidate) return
    try {
      await operationalRepository.associateEmailCandidate(candidate, input, idempotencyKey)
      setGmailCandidates((current) => current.map((item) => item.accountId === candidate.accountId && item.threadId === candidate.threadId
        ? { ...item, state: 'linked', recordVersion: item.recordVersion + 1 }
        : item))
      await refreshOperationalTickets()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Association failed.'
      setGmailError(`${message}. Confirmation remains untracked and retryable.`)
      throw cause
    }
  }, [operationalRepository, refreshOperationalTickets])

  const handleJumpToTicket = useCallback((id: string) => {
    setView('tickets')
    setFilters({ query: '', sources: [] })
    setHighlightId(id)
    setTimeout(() => setHighlightId(null), 2500)
  }, [])

  const handleOpenDetail = useCallback((id: string) => setDetailId(id), [])

  const monitorReconciliation = useCallback(async (initial: ReconciliationRunDto) => {
    if (!operationalRepository) return
    setReconciliationBusy(true)
    setReconciliationError(undefined)
    try {
      const final = await pollReconciliationRun(operationalRepository, initial, setReconciliationRun)
      recordReconciliationTelemetry(final)
      if (final.state === 'complete') setLastReconciliationSuccess(final.finishedAt)
      if (operationalRepository.listReconciliationRuns) {
        const runs = await operationalRepository.listReconciliationRuns()
        setReconciliationRuns(runs)
        setReconciliationRun(runs[0] ?? final)
      } else {
        setReconciliationRuns((runs) => [final, ...runs.filter((run) => run.id !== final.id)].slice(0, 20))
      }
      await refreshOperationalTickets()
    } catch (cause) {
      setReconciliationError(cause instanceof Error ? cause.message : 'Reconciliation refresh failed.')
    } finally {
      setReconciliationBusy(false)
    }
  }, [operationalRepository, refreshOperationalTickets])

  const handleSync = useCallback(async () => {
    if (!operationalRepository?.startReconciliation) {
      setReconciliationError('Connect the local companion before running MnemoSync.')
      throw new Error('Connect the local companion before running MnemoSync.')
    }
    setView('operations')
    setReconciliationBusy(true)
    try {
      const initial = await operationalRepository.startReconciliation()
      await monitorReconciliation(initial)
    } catch (cause) {
      setReconciliationBusy(false)
      const message = cause instanceof Error ? cause.message : 'Reconciliation could not start.'
      setReconciliationError(message)
      throw cause
    }
  }, [monitorReconciliation, operationalRepository])

  const handleRetrySource = useCallback(async (sourceId: SourceId) => {
    if (!reconciliationRun || !operationalRepository?.retryReconciliation) throw new Error('No reconciliation run is available to retry.')
    setReconciliationBusy(true)
    try {
      const initial = await operationalRepository.retryReconciliation(reconciliationRun.id, [sourceId])
      await monitorReconciliation(initial)
    } catch (cause) {
      setReconciliationBusy(false)
      const message = cause instanceof Error ? cause.message : 'Source retry could not start.'
      setReconciliationError(message)
      throw cause
    }
  }, [monitorReconciliation, operationalRepository, reconciliationRun])

  const handleAttentionAction = useCallback(async (action: AttentionAction, item: AttentionItem) => {
    if (action.disabledReason) throw new Error(action.disabledReason)
    if (action.kind === 'open-ticket' || action.kind === 'review-receipt') {
      setDetailId(item.recordRef.slice('ticket:'.length))
      return
    }
    if (action.kind === 'change-status') {
      await performStatusChange(item.recordRef.slice('ticket:'.length), action.targetStatus ?? 'done')
      return
    }
    if (action.kind === 'review-gmail' || action.kind === 'choose-ticket') {
      const threadId = item.recordRef.split(':').at(-1)
      if (action.kind === 'choose-ticket' && threadId) setChooseGmailThreadId(threadId)
      setView('emails')
      return
    }
    if (action.kind === 'retry-source') {
      await handleRetrySource(item.recordRef.slice('source:'.length) as SourceId)
      return
    }
    if (action.kind === 'run-sync') {
      await handleSync()
      return
    }
    throw new Error('This action is unavailable from the current evidence.')
  }, [handleRetrySource, handleSync, performStatusChange])

  const handleNavigate = useCallback((v: View) => {
    setView(v)
    if (v === 'operations' || v === 'brief') saveHomeViewPreference(window.localStorage, v)
    if (v === 'usage' || v === 'analytics') saveMetricsViewPreference(window.localStorage, v)
  }, [])

  const handleHomeViewChange = useCallback((next: HomeView) => handleNavigate(next), [handleNavigate])
  const handleMetricsViewChange = useCallback((next: MetricsView) => handleNavigate(next), [handleNavigate])

  const agentList = activities.map((a) => ({
    agent: a.agent,
    state: a.state,
    currentTask: a.currentTask,
    label: a.agent === 'Claude Cowork' ? 'Claude' : a.agent,
    icon: '',
  }))

  const pendingEmails = gmailCandidates.filter((candidate) => candidate.state === 'candidate' || candidate.state === 'deferred').length
  const ticketsWithGenerated = tickets
  const attentionProjection = useMemo(() => projectAttentionWorkspace({
    tickets: ticketsWithGenerated,
    gmailCandidates,
    reconciliationSources,
    reconciliationRun,
    reconciliationRuns,
    ticketState: operationalTicketState,
    gmailTruthState: gmailError ? 'disconnected' : gmailSourceStatus?.lastSuccessAt ? 'current' : 'unverified',
    lastReconciliationSuccessAt: lastReconciliationSuccess,
    agentAssignments,
    agentIntegrations,
  }), [agentAssignments, agentIntegrations, gmailCandidates, gmailError, gmailSourceStatus?.lastSuccessAt, lastReconciliationSuccess, operationalTicketState, reconciliationRun, reconciliationRuns, reconciliationSources, ticketsWithGenerated])
  const selectedAttentionItem = attentionProjection.items.find((item) => item.id === selectedAttentionId)
  const selectedAttentionTicket = selectedAttentionItem?.kind === 'ticket'
    ? ticketsWithGenerated.find((ticket) => `ticket:${ticket.id}` === selectedAttentionItem.recordRef)
    : undefined

  useEffect(() => {
    if (selectedAttentionId && !attentionProjection.items.some((item) => item.id === selectedAttentionId)) setSelectedAttentionId(undefined)
  }, [attentionProjection.items, selectedAttentionId])

  const q = filters.query.trim().toLowerCase()
  const filteredTickets = ticketsWithGenerated.filter((t) => {
    if (filters.sources.length > 0 && !filters.sources.includes(t.source)) return false
    if (!q) return true
    return `${t.title} ${t.description} ${t.source}`.toLowerCase().includes(q)
  })

  return (
    <div className="relative z-10 flex h-screen bg-mist text-ink">
      <Sidebar
        agents={agentList}
        activeView={view}
        onNavigate={handleNavigate}
        ticketCount={ticketsWithGenerated.filter((t) => t.status !== 'done').length}
        emailCount={pendingEmails}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          view={view}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={() => setView('settings')}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {showSourceSetup === false && operationalTicketState !== 'current' && (
              <div className="mb-4 rounded-sm border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200" role="status">
                Ticket state: {operationalTicketState}. {operationalTicketError ?? 'Loading companion-owned tickets.'}
                <button type="button" onClick={() => void refreshOperationalTickets()} className="ml-3 underline">Retry</button>
              </div>
            )}
            {showSourceSetup === null ? <ViewLoading /> : showSourceSetup ? <SourceSetup repository={operationalRepository} onNavigate={handleNavigate} onFinished={(run) => { setShowSourceSetup(false); if (run) { setReconciliationRun(run); void refreshOperationalTickets() } }} /> : <>
            <LegacyMigrationPanel repository={operationalRepository} onImported={() => void refreshOperationalTickets()} />
            <AnimatePresence initial={false}>
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.15 }}
              >
                <Suspense fallback={<ViewLoading />}>
                  {view === 'operations' && (
                      <OperationsDesk
                        projection={attentionProjection}
                        selectedId={selectedAttentionId}
                        onSelectedIdChange={setSelectedAttentionId}
                        onOpenTicket={handleOpenDetail}
                        selectedTicket={selectedAttentionTicket}
                        onAction={handleAttentionAction}
                        onSync={handleSync}
                        onRetrySource={(sourceId) => handleRetrySource(sourceId as SourceId)}
                        recoveryBusy={reconciliationBusy}
                        reconciliationState={reconciliationRun?.state}
                        loading={operationalTicketState === 'loading'}
                        error={operationalTicketState === 'error' ? operationalTicketError : reconciliationError}
                        homeView="operations"
                        onHomeViewChange={handleHomeViewChange}
                        onOpenSettings={() => handleNavigate('settings')}
                        activeAssignments={<ActiveAssignmentsPanel assignments={agentAssignments} projects={agentProjects} integrations={agentIntegrations} onUpdate={updateAgentAssignment} onLoadMore={() => void loadMoreAgentActivity()} hasMore={Boolean(agentAssignmentCursor)} loading={agentActivityLoading} error={agentActivityError} onOpenPrivacy={() => handleNavigate('settings')} />}
                      />
                  )}
                  {view === 'brief' && (
                      <DailyBrief
                        projection={attentionProjection}
                        selectedId={selectedAttentionId}
                        selectedTicket={selectedAttentionTicket}
                        onSelectedIdChange={setSelectedAttentionId}
                        onAction={handleAttentionAction}
                        onHomeViewChange={handleHomeViewChange}
                      />
                  )}

                  {view === 'tickets' && (
                    <div className="space-y-4">
                      <div className="inline-flex rounded-sm border border-chrome-line bg-chrome p-1" role="tablist" aria-label="Ticket view">
                        <button type="button" role="tab" aria-selected={ticketMode === 'active'} onClick={() => setTicketMode('active')} className={`rounded-sm px-4 py-2 text-xs font-semibold ${ticketMode === 'active' ? 'bg-sync text-white' : 'text-chrome-mut'}`}>Active</button>
                        <button type="button" role="tab" aria-selected={ticketMode === 'completed'} onClick={() => setTicketMode('completed')} className={`rounded-sm px-4 py-2 text-xs font-semibold ${ticketMode === 'completed' ? 'bg-sync text-white' : 'text-chrome-mut'}`}>Completed</button>
                      </div>
                      {ticketMode === 'active' ? <>
                      <ActiveAssignmentsPanel assignments={agentAssignments} projects={agentProjects} integrations={agentIntegrations} onUpdate={updateAgentAssignment} onLoadMore={() => void loadMoreAgentActivity()} hasMore={Boolean(agentAssignmentCursor)} loading={agentActivityLoading} error={agentActivityError} onOpenPrivacy={() => handleNavigate('settings')} />
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <FilterBar
                          filters={filters}
                          onChange={setFilters}
                          resultCount={filteredTickets.length}
                          totalCount={tickets.length}
                        />
                        <NewTicketForm onCreate={handleCreate} />
                      </div>
                      <TicketBoard
                        tickets={filteredTickets.filter((ticket) => ticket.status !== 'done')}
                        allTickets={ticketsWithGenerated}
                        onStatusChange={handleStatusChange}
                        onDelete={handleDelete}
                        onAddNote={handleAddNote}
                        highlightId={highlightId}
                        onOpenDetail={handleOpenDetail}
                        columns={['todo', 'in-progress', 'blocked']}
                      />
                      </> : <CompletedWorkPanel repository={operationalRepository} initialPreset={completedPreset} onPresetChange={setCompletedPreset} onOpenTicket={handleOpenDetail} onReopen={async (id) => { await performStatusChange(id, 'todo') }} />}
                    </div>
                  )}

                  {view === 'routing' && (
                    <ModelRoutingView
                      policy={routingPolicyState.policy}
                      loadIssue={routingPolicyState.issue}
                      ticket={ticketsWithGenerated.find((ticket) => ticket.id === routingTicketId)}
                      onPolicyChange={(policy) => setRoutingPolicyState({ policy })}
                      operationalRepository={operationalRepository}
                      onOpenUsage={(filters) => {
                        setUsageInitialFilters(filters)
                        setView('usage')
                      }}
                    />
                  )}

                  {(view === 'usage' || view === 'analytics') && (
                    <div className="space-y-4">
                      <div className="flex justify-end"><MetricsViewSwitch value={view} onChange={handleMetricsViewChange} /></div>
                      {view === 'analytics' ? <Analytics tickets={tickets} onOpenCompleted={(preset) => { setCompletedPreset(preset); setTicketMode('completed'); setView('tickets') }} /> : <UsageView repository={operationalRepository} initialFilters={usageInitialFilters} />}
                    </div>
                  )}

                  {view === 'emails' && (
                    <EmailPanel
                      candidates={gmailCandidates}
                      check={gmailCheck}
                      sourceStatus={gmailSourceStatus}
                      error={gmailError}
                      onRefresh={handleRefreshEmails}
                      onConnect={handleConnectGmail}
                      onDecision={handleEmailDecision}
                      tickets={tickets}
                      onAssociate={handleEmailAssociation}
                      chooseThreadId={chooseGmailThreadId}
                      onChooseHandled={() => setChooseGmailThreadId(undefined)}
                      loading={emailLoading}
                    />
                  )}
                  {view === 'settings' && <DataPrivacyView repository={operationalRepository} onImported={() => void refreshOperationalTickets()} onNavigate={handleNavigate} />}
                </Suspense>
              </motion.div>
            </AnimatePresence>
            </>}
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tickets={ticketsWithGenerated}
        onNavigate={handleNavigate}
        onJumpToTicket={handleJumpToTicket}
      />

      <TicketDetail
        ticket={ticketsWithGenerated.find((t) => t.id === detailId) ?? null}
        onClose={() => setDetailId(null)}
        onStatusChange={handleStatusChange}
        onAddNote={handleAddNote}
        onRecommendRoute={handleRecommendRoute}
      />
    </div>
  )
}

function ViewLoading() {
  return (
    <div className="panel rounded-sm px-4 py-6 text-sm text-mut">
      Loading view...
    </div>
  )
}
