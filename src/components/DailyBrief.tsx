import type { AttentionAction, AttentionBucket, AttentionItem, AttentionWorkspaceProjection, HomeView, Ticket } from '../types'
import { useNarrowInspector } from '../lib/use-narrow-inspector'
import { dailyBriefRowId } from '../lib/attention-dom'
import { DailyBriefItem } from './DailyBriefItem'
import { DayStatus } from './DayStatus'
import { EvidenceInspector } from './EvidenceInspector'
import { SourceHealthStrip } from './SourceHealthStrip'
import { WorkspaceViewSwitch } from './WorkspaceViewSwitch'

const BUCKETS: Array<{ id: AttentionBucket; label: string; description: string }> = [
  { id: 'needs-action', label: 'Needs action', description: 'Decisions or recovery you can move now.' },
  { id: 'waiting', label: 'Waiting', description: 'Work held by a dependency or deferred decision.' },
  { id: 'recently-resolved', label: 'Recently resolved', description: 'Recent outcomes retained for a quick confidence check.' },
]

export function DailyBrief({
  projection,
  selectedId,
  selectedTicket,
  onSelectedIdChange,
  onAction,
  onHomeViewChange,
}: {
  projection: AttentionWorkspaceProjection
  selectedId?: string
  selectedTicket?: Ticket
  onSelectedIdChange: (id?: string) => void
  onAction: (action: AttentionAction, item: AttentionItem) => Promise<void>
  onHomeViewChange: (view: HomeView) => void
}) {
  const narrow = useNarrowInspector()
  const selected = projection.items.find((item) => item.id === selectedId)
  function closeInspector() {
    const returnId = selectedId
    onSelectedIdChange(undefined)
    window.setTimeout(() => {
      if (returnId) document.getElementById(dailyBriefRowId(returnId))?.focus()
    }, 0)
  }
  return (
    <section className="space-y-4" aria-labelledby="daily-brief-title">
      <header className="panel rounded-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="hud-label">FindMnemo decision view</p>
            <h1 id="daily-brief-title" className="mt-2 text-2xl font-semibold text-ink">Daily Brief</h1>
            <p className="mt-1 max-w-2xl text-sm text-mut">A lower-density pass over the same authoritative work, evidence, and actions.</p>
          </div>
          <WorkspaceViewSwitch value="brief" onChange={onHomeViewChange} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <DayStatus status={projection.dayStatus} />
        <SourceHealthStrip sources={projection.sources} />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <div className="min-w-0 space-y-4">
          {BUCKETS.map((bucket) => {
            const items = projection.items.filter((item) => item.bucket === bucket.id)
            return (
              <section key={bucket.id} className="panel min-w-0 overflow-hidden rounded-sm p-4" aria-labelledby={`brief-${bucket.id}`}>
                <h2 id={`brief-${bucket.id}`} className="text-sm font-semibold text-ink">{bucket.label}</h2>
                <p className="mt-1 text-xs text-mut">{bucket.description}</p>
                {items.length === 0 ? (
                  <p className="mt-3 rounded-sm border border-dashed border-line px-3 py-3 text-xs text-faint">No evidenced items in this section.</p>
                ) : (
                  <ul className="mt-3 space-y-2" aria-label={bucket.label}>
                    {items.map((item) => <DailyBriefItem key={item.id} item={item} onInspect={onSelectedIdChange} onAction={onAction} />)}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
        {(!narrow || selected) && <EvidenceInspector item={selected} ticket={selectedTicket} onAction={onAction} drawer={narrow} onClose={closeInspector} />}
      </div>
    </section>
  )
}
