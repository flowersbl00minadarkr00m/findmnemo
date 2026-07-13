import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import type { AttentionAction, AttentionItem, HomeView, Ticket, View } from './types'
import {
  addSampleWorkNote,
  createSampleTicket,
  deleteSampleTicket,
  loadSampleWorkspace,
  resetSampleWorkspace,
  updateSampleTicketStatus,
} from './lib/sample-repository'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { OperationsDesk } from './components/OperationsDesk'
import { TicketBoard } from './components/TicketBoard'
import { NewTicketForm } from './components/NewTicketForm'
import { CommandPalette } from './components/CommandPalette'
import { TicketDetail } from './components/TicketDetail'
import { FilterBar, type TicketFilters } from './components/FilterBar'
import { SampleWorkspaceBanner } from './components/SampleWorkspaceBanner'
import { projectAttentionWorkspace } from './lib/attention-workspace'

const Analytics = lazy(() => import('./components/Analytics').then((module) => ({ default: module.Analytics })))
const DailyBrief = lazy(() => import('./components/DailyBrief').then((module) => ({ default: module.DailyBrief })))
const EmailPanel = lazy(() => import('./components/EmailPanel').then((module) => ({ default: module.EmailPanel })))

export function SampleWorkspace() {
  const [data, setData] = useState(loadSampleWorkspace)
  const [view, setView] = useState<View>('operations')
  const [filters, setFilters] = useState<TicketFilters>({ query: '', sources: [] })
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [reconcileStatus, setReconcileStatus] = useState<string>()
  const [selectedAttentionId, setSelectedAttentionId] = useState<string>()

  const updateStatus = useCallback((id: string, status: Ticket['status']) => {
    setData((current) => updateSampleTicketStatus(current, id, status))
  }, [])
  const addNote = useCallback((id: string, text: string) => {
    setData((current) => addSampleWorkNote(current, id, text))
  }, [])
  const deleteTicket = useCallback((id: string) => {
    setData((current) => deleteSampleTicket(current, id))
  }, [])
  const reset = useCallback(() => {
    setData(resetSampleWorkspace())
    setReconcileStatus('Sample fixtures restored.')
  }, [])
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLowerCase()
    return data.tickets.filter((ticket) => {
      if (filters.sources.length && !filters.sources.includes(ticket.source)) return false
      return !query || `${ticket.title} ${ticket.description} ${ticket.source}`.toLowerCase().includes(query)
    })
  }, [data.tickets, filters])
  const agents = data.activities.map((activity) => ({
    agent: activity.agent,
    state: activity.state,
    currentTask: activity.currentTask,
    label: activity.agent === 'Claude Cowork' ? 'Claude' : activity.agent,
    icon: '',
  }))
  const pendingEmails = data.emails.filter((email) => email.needsResponse).length
  const attentionProjection = useMemo(() => projectAttentionWorkspace({ tickets: data.tickets, ticketState: 'current', fictional: true }), [data.tickets])
  const selectedAttentionItem = attentionProjection.items.find((item) => item.id === selectedAttentionId)
  const selectedAttentionTicket = selectedAttentionItem?.kind === 'ticket'
    ? data.tickets.find((ticket) => `ticket:${ticket.id}` === selectedAttentionItem.recordRef)
    : undefined
  const selectHomeView = useCallback((next: HomeView) => setView(next), [])
  const handleSampleAttentionAction = useCallback(async (action: AttentionAction, item: AttentionItem) => {
    if (action.disabledReason) throw new Error(action.disabledReason)
    if (item.kind !== 'ticket') return
    const ticketId = item.recordRef.slice('ticket:'.length)
    if (action.kind === 'change-status') {
      setData((current) => updateSampleTicketStatus(current, ticketId, action.targetStatus ?? 'done'))
      return
    }
    setDetailId(ticketId)
  }, [])

  return (
    <div className="relative z-10 flex h-screen bg-mist text-ink">
      <Sidebar agents={agents} activeView={view} onNavigate={setView} ticketCount={data.tickets.filter((ticket) => ticket.status !== 'done').length} emailCount={pendingEmails} />
      <div className="flex min-w-0 flex-1 flex-col">
        <SampleWorkspaceBanner onReset={reset} status={reconcileStatus} />
        <TopBar view={view} sample onOpenPalette={() => setPaletteOpen(true)} telemetryCount={0} onExportTelemetry={() => undefined} onImportTelemetry={() => undefined} onExportObservedWork={() => undefined} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
            <Suspense fallback={<p className="text-sm text-mut">Loading sample view...</p>}>
              {view === 'operations' && <OperationsDesk projection={attentionProjection} selectedId={selectedAttentionId} selectedTicket={selectedAttentionTicket} onSelectedIdChange={setSelectedAttentionId} onOpenTicket={setDetailId} onAction={handleSampleAttentionAction} onSync={() => setReconcileStatus(`Sample reconciliation checked ${data.tickets.length} fictional tickets; no operational data was accessed.`)} homeView="operations" onHomeViewChange={selectHomeView} />}
              {view === 'brief' && <DailyBrief projection={attentionProjection} selectedId={selectedAttentionId} selectedTicket={selectedAttentionTicket} onSelectedIdChange={setSelectedAttentionId} onAction={handleSampleAttentionAction} onHomeViewChange={selectHomeView} />}
              {view === 'tickets' && <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><FilterBar filters={filters} onChange={setFilters} resultCount={filtered.length} totalCount={data.tickets.length} /><NewTicketForm onCreate={(title, description, source) => setData((current) => createSampleTicket(current, title, description, source))} /></div><TicketBoard tickets={filtered} allTickets={data.tickets} onStatusChange={updateStatus} onDelete={deleteTicket} onAddNote={addNote} onOpenDetail={setDetailId} /></div>}
              {view === 'analytics' && <Analytics tickets={data.tickets} />}
              {view === 'emails' && <EmailPanel emails={data.emails} onRefresh={reset} loading={false} sample />}
              {(view === 'sdd' || view === 'routing') && <section className="panel rounded-sm p-6"><p className="hud-label">Fictional Sample workspace</p><h2 className="mt-2 text-xl font-semibold">{view === 'sdd' ? 'Sample project gates' : 'Sample model routing'}</h2><p className="mt-2 text-sm text-mut">This tour does not load registry, Supabase, model policy, or operational storage. Connect the operational workspace to use this view with real data.</p></section>}
            </Suspense>
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} tickets={data.tickets} onNavigate={setView} onJumpToTicket={(id) => { setView('tickets'); setDetailId(id) }} />
      <TicketDetail ticket={data.tickets.find((ticket) => ticket.id === detailId) ?? null} onClose={() => setDetailId(null)} onStatusChange={updateStatus} onAddNote={addNote} onRecommendRoute={() => setView('routing')} />
    </div>
  )
}
