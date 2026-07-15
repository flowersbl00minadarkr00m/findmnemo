import type { AttentionAction, AttentionItem, AttentionWorkspaceProjection, HomeView, Ticket } from '../types'
import type { ReactNode } from 'react'
import { useNarrowInspector } from '../lib/use-narrow-inspector'
import { attentionRowId } from '../lib/attention-dom'
import { AttentionQueue } from './AttentionQueue'
import { EvidenceInspector } from './EvidenceInspector'
import { SourceHealthStrip } from './SourceHealthStrip'
import { WorkspaceViewSwitch } from './WorkspaceViewSwitch'

export function OperationsDesk({
  projection,
  selectedId,
  onSelectedIdChange,
  onOpenTicket,
  selectedTicket,
  onAction,
  homeView = 'operations',
  onHomeViewChange = () => undefined,
  onSync,
  onRetrySource,
  recoveryBusy = false,
  reconciliationState,
  loading = false,
  error,
  activeAssignments,
  onOpenSettings,
}: {
  projection: AttentionWorkspaceProjection
  selectedId?: string
  onSelectedIdChange: (id?: string) => void
  onOpenTicket?: (ticketId: string) => void
  selectedTicket?: Ticket
  onAction?: (action: AttentionAction, item: AttentionItem) => Promise<void>
  homeView?: HomeView
  onHomeViewChange?: (view: HomeView) => void
  onSync?: () => void
  onRetrySource?: (sourceId: string) => void
  recoveryBusy?: boolean
  reconciliationState?: string
  loading?: boolean
  error?: string
  activeAssignments?: ReactNode
  onOpenSettings?: () => void
}) {
  const narrow = useNarrowInspector()
  const selected = projection.items.find((item) => item.id === selectedId)
  function closeInspector() {
    const returnId = selectedId
    onSelectedIdChange(undefined)
    window.setTimeout(() => {
      if (returnId) document.getElementById(attentionRowId(returnId))?.focus()
    }, 0)
  }
  return (
    <section aria-labelledby="operations-desk-title" className="space-y-4">
      <header className="panel rounded-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="hud-label">FindMnemo attention workspace</p>
            <h1 id="operations-desk-title" className="mt-2 text-2xl font-semibold text-ink">Operations Desk</h1>
            <p className="mt-1 max-w-2xl text-sm text-mut">Prioritized work, source health, and available evidence from the current operational record.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onSync && (
              <button type="button" onClick={onSync} disabled={recoveryBusy} className="rounded-sm border border-sync/50 px-3 py-1.5 text-xs font-semibold text-sync hover:bg-sync/10 disabled:opacity-50">
                {recoveryBusy ? 'MnemoSync running…' : 'MnemoSync'}
              </button>
            )}
            <WorkspaceViewSwitch value={homeView} onChange={onHomeViewChange} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 font-mono text-xs text-mut" aria-label="Day status">
          <span>{projection.dayStatus.label}</span>
          {projection.dayStatus.progress !== null && <span>{projection.dayStatus.progress}% resolved</span>}
        </div>
        {reconciliationState && <p className="mt-2 text-xs text-mut" role="status">MnemoSync {reconciliationState}</p>}
      </header>

      <SourceHealthStrip sources={projection.sources} onRetry={onRetrySource} onOpenSettings={onOpenSettings} />

      {activeAssignments}

      {loading && projection.items.length === 0 && (
        <div className="panel rounded-sm p-6 text-sm text-mut" role="status">Loading companion-owned operational evidence…</div>
      )}
      {error && (
        <div className="rounded-sm border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-alert" role="alert">
          Operational evidence is unavailable: {error}
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <section className="panel min-w-0 overflow-hidden rounded-sm p-4" aria-labelledby="attention-queue-title">
          <h2 id="attention-queue-title" className="hud-label mb-3">Prioritized attention</h2>
          <AttentionQueue items={projection.items} selectedId={selectedId} onSelect={onSelectedIdChange} />
        </section>
        {(!narrow || selected) && <EvidenceInspector item={selected} ticket={selectedTicket} onOpenTicket={onOpenTicket} onAction={onAction} drawer={narrow} onClose={closeInspector} />}
      </div>
    </section>
  )
}
