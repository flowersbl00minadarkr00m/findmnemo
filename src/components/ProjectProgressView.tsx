import type { ProjectProgressItem, Ticket } from '../types'
import { SddGateTicketBadge } from './SddGateTicketBadge'

interface Props {
  items: ProjectProgressItem[]
  tickets: Ticket[]
  loading?: boolean
  error?: string
  onRefresh: () => void
  onOpenDetail: (id: string) => void
}

const ISSUE_CLASSES: Record<ProjectProgressItem['issues'][number]['severity'], string> = {
  info: 'border-sync/35 text-sync bg-sync/10',
  warning: 'border-warn/40 text-warn bg-warn/10',
  blocker: 'border-alert/45 text-alert bg-alert/10',
}

function gateRank(gate: ProjectProgressItem['currentGate']): number {
  const ranks: Record<ProjectProgressItem['currentGate'], number> = {
    'invalid-status': 0,
    'stale-path': 1,
    'requirements:draft': 2,
    'requirements:approved': 3,
    'design:draft': 4,
    'design:approved': 5,
    'tasks:draft': 6,
    'tasks:approved': 7,
    'implementation:in-progress': 8,
    'implementation:done': 9,
    'review:done': 10,
    uninitialized: 11,
  }
  return ranks[gate]
}

export function ProjectProgressView({ items, tickets, loading, error, onRefresh, onOpenDetail }: Props) {
  const sortedItems = [...items].sort((a, b) => gateRank(a.currentGate) - gateRank(b.currentGate) || a.projectName.localeCompare(b.projectName))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="hud-label">Projects / SDD</p>
          <p className="mt-1 text-sm text-mut">
            Registry-derived project gates, next safe actions, and generated FindMnemo tickets.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-sm border border-sync/40 bg-sync/10 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-sync hover:bg-sync/20"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-sm border border-warn/45 bg-warn/10 px-3 py-2 text-sm text-warn">
          {error}
        </div>
      )}

      {loading && (
        <div className="panel rounded-sm px-4 py-6 text-sm text-mut">Loading project progress...</div>
      )}

      {!loading && sortedItems.length === 0 && (
        <div className="panel rounded-sm px-4 py-6">
          <p className="text-sm text-ink">No project progress items are available.</p>
          <p className="mt-1 text-xs text-mut">
            Run the local scanner and sync `project_progress_items`, or load local generated progress data for private verification.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {sortedItems.map((item) => (
          <ProjectProgressRow
            key={item.id}
            item={item}
            tickets={tickets.filter((ticket) => ticket.projectProgressId === item.id)}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectProgressRow({
  item,
  tickets,
  onOpenDetail,
}: {
  item: ProjectProgressItem
  tickets: Ticket[]
  onOpenDetail: (id: string) => void
}) {
  const gateTickets = tickets.filter((ticket) => ticket.generatedKind === 'sdd-gate-placeholder')
  const taskTickets = tickets.filter((ticket) => ticket.generatedKind === 'sdd-task-execution')

  return (
    <section className="panel rounded-sm px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">{item.projectName}</h2>
            <span className="rounded-sm border border-line bg-paper/70 px-1.5 py-0.5 text-[10px] font-mono text-mut">
              {item.currentGate}
            </span>
            {item.origin === 'registry-sync' && (
              <span className="rounded-sm border border-sync/35 bg-sync/10 px-1.5 py-0.5 text-[10px] font-mono text-sync">
                registry-sync
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-mut">
            {item.specTitle ?? item.specId ?? 'Project SDD state'}
          </p>
        </div>
        <p className="text-[10px] font-mono text-faint">scanned {shortDate(item.lastScannedAt)}</p>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-mono uppercase text-faint mb-1">Next safe action</p>
            <p className="text-sm text-ink leading-relaxed">{item.nextSafeAction}</p>
          </div>

          {item.issues.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.issues.map((issue) => (
                <span key={`${issue.severity}:${issue.message}`} className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-mono ${ISSUE_CLASSES[issue.severity]}`}>
                  {issue.severity}: {issue.message}
                </span>
              ))}
            </div>
          )}

          <div>
            <p className="text-[10px] font-mono uppercase text-faint mb-1">Artifacts</p>
            <div className="flex flex-wrap gap-1.5">
              {item.artifactRefs.length === 0 ? (
                <span className="text-xs text-faint">No artifact refs recorded.</span>
              ) : item.artifactRefs.map((ref) => (
                <span key={`${ref.kind}:${ref.path}`} className="max-w-full truncate rounded-sm border border-line bg-paper/70 px-1.5 py-0.5 text-[10px] font-mono text-mut" title={ref.path}>
                  {ref.kind}: {ref.label}
                </span>
              ))}
            </div>
          </div>

          {item.canonicalPath && (
            <p className="text-[10px] font-mono text-faint">Path: {item.canonicalPath}</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase text-faint">Generated tickets</p>
          <TicketLinks title="Gate placeholders" tickets={gateTickets} onOpenDetail={onOpenDetail} />
          <TicketLinks title="Execution tickets" tickets={taskTickets} onOpenDetail={onOpenDetail} />
        </div>
      </div>
    </section>
  )
}

function TicketLinks({ title, tickets, onOpenDetail }: { title: string; tickets: Ticket[]; onOpenDetail: (id: string) => void }) {
  return (
    <div className="rounded-sm border border-line/70 bg-mist/40 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-mono text-faint">{title}</p>
        <span className="text-[10px] font-mono text-faint tabular-nums">{tickets.length}</span>
      </div>
      {tickets.length === 0 ? (
        <p className="text-xs text-faint">None linked.</p>
      ) : (
        <div className="space-y-1.5">
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => onOpenDetail(ticket.id)}
              className="w-full rounded-sm border border-line bg-paper/60 px-2 py-2 text-left hover:border-sync/50"
            >
              <p className="truncate text-xs text-ink">{ticket.title}</p>
              <div className="mt-1">
                <SddGateTicketBadge ticket={ticket} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
