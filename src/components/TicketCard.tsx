import { useEffect, useRef, useState } from 'react'
import type { ReadinessState, Ticket } from '../types'
import { STATUS_LABELS, SOURCE_COLORS } from '../types'
import { computeTicketReadiness, getBlockingReferences } from '../lib/workflow-intelligence'
import { SddGateTicketBadge } from './SddGateTicketBadge'

interface Props {
  ticket: Ticket
  onStatusChange: (id: string, status: Ticket['status']) => void
  onDelete: (id: string) => void
  onAddNote: (id: string, note: string) => void
  compact?: boolean
  highlighted?: boolean
  onDragStateChange?: (dragging: boolean) => void
  onOpenDetail?: (id: string) => void
  allTickets?: Ticket[]
}

const ACCENT_BORDERS: Record<Ticket['source'], string> = {
  'Pi': 'border-l-purple-500',
  'Codex': 'border-l-blue-500',
  'Claude Cowork': 'border-l-amber-500',
}

const READINESS_LABELS: Record<ReadinessState, string> = {
  ready: 'Ready',
  blocked: 'Blocked',
  done: 'Done',
}

const READINESS_CLASSES: Record<ReadinessState, string> = {
  ready: 'text-ok border-ok/40 bg-ok/10',
  blocked: 'text-alert border-alert/45 bg-alert/10',
  done: 'text-sync border-sync/35 bg-sync/10',
}

export function TicketCard({
  ticket,
  onStatusChange,
  onDelete,
  onAddNote,
  compact,
  highlighted,
  onDragStateChange,
  onOpenDetail,
  allTickets,
}: Props) {
  const sourceColor = SOURCE_COLORS[ticket.source]
  const [expanded, setExpanded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const ticketSet = allTickets ?? [ticket]
  const readiness = computeTicketReadiness(ticket, ticketSet)
  const blockers = getBlockingReferences(ticket, ticketSet)
  const blockerSummary = blockers.length > 0 ? summarizeBlocker(blockers[0]) : undefined

  const detailCount = ticket.artifacts.length + ticket.decisionLog.length + ticket.workNotes.length

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setExpanded(true)
    }
  }, [highlighted])

  function handleAddNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const input = form.elements.namedItem('note') as HTMLInputElement
    if (input.value.trim()) {
      onAddNote(ticket.id, input.value.trim())
      input.value = ''
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onOpenDetail?.(ticket.id)}
        className="w-full text-left flex items-center gap-3 p-3 rounded-sm border border-line/70 bg-paper/60 hover:bg-paper hover:border-sync/50 transition-colors"
        title="Open ticket detail"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sourceColor}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink truncate">{ticket.title}</p>
          <p className="text-[10px] font-mono text-faint truncate">
            {ticket.source} / {STATUS_LABELS[ticket.status]} / {READINESS_LABELS[readiness]} / {timeAgo(ticket.updatedAt)}
          </p>
        </div>
        <SddGateTicketBadge ticket={ticket} />
        <span
          className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-mono shrink-0 ${READINESS_CLASSES[readiness]}`}
          title={`Readiness: ${READINESS_LABELS[readiness]}`}
        >
          {READINESS_LABELS[readiness]}
        </span>
      </button>
    )
  }

  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/ticket-id', ticket.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStateChange?.(true)
      }}
      onDragEnd={() => onDragStateChange?.(false)}
      className={`group bg-paper border border-line border-l-2 ${ACCENT_BORDERS[ticket.source]} rounded-sm p-3.5 space-y-2.5 cursor-grab active:cursor-grabbing hover:border-sync/50 hover:shadow-md hover:-translate-y-px transition-all ${
        highlighted ? 'ring-2 ring-sync/60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className={`min-w-0 text-left font-semibold text-[13px] leading-snug text-ink ${onOpenDetail ? 'cursor-pointer hover:text-sync transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sync' : ''}`}
          onClick={() => onOpenDetail?.(ticket.id)}
          title={onOpenDetail ? 'Open ticket detail' : undefined}
          disabled={!onOpenDetail}
        >
          <h3>{ticket.title}</h3>
        </button>
        <span className={`${sourceColor} text-[10px] px-2 py-0.5 rounded-sm font-mono text-white whitespace-nowrap shrink-0`}>
          {ticket.source === 'Claude Cowork' ? 'Claude' : ticket.source}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SddGateTicketBadge ticket={ticket} />
        <span
          className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-mono ${READINESS_CLASSES[readiness]}`}
          aria-label={`Readiness: ${READINESS_LABELS[readiness]}`}
          title={`Readiness: ${READINESS_LABELS[readiness]}`}
        >
          {READINESS_LABELS[readiness]}
        </span>
        {blockerSummary && (
          <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-faint" title={blockerSummary}>
            {blockerSummary}
          </span>
        )}
      </div>

      {ticket.description && (
        <p className="text-xs text-mut leading-relaxed line-clamp-3">{ticket.description}</p>
      )}

      <div className="flex items-center gap-2">
        <select
          value={ticket.status}
          onChange={(e) => onStatusChange(ticket.id, e.target.value as Ticket['status'])}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-xs bg-mist/70 border border-line rounded-sm px-2 py-1.5 text-ink focus:outline-none focus:border-sync transition-colors"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <span className="text-[10px] font-mono text-faint whitespace-nowrap tabular-nums">{timeAgo(ticket.updatedAt)}</span>
      </div>

      {detailCount > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] text-faint hover:text-mut transition-colors"
        >
          <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {ticket.workNotes.length > 0 && <span>{ticket.workNotes.length} notes</span>}
          {ticket.decisionLog.length > 0 && <span>/ {ticket.decisionLog.length} decisions</span>}
          {ticket.artifacts.length > 0 && <span>/ {ticket.artifacts.length} artifacts</span>}
        </button>
      )}

      {expanded && (
        <div className="space-y-2.5 pt-0.5">
          {ticket.artifacts.length > 0 && (
            <div className="space-y-1">
              <p className="hud-label">Artifacts</p>
              {ticket.artifacts.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"
                  className="block text-xs text-sync hover:text-memory truncate">
                  <span className="text-faint font-mono">{a.type}:</span> {a.label}
                </a>
              ))}
            </div>
          )}

          {ticket.decisionLog.length > 0 && (
            <div className="space-y-1">
              <p className="hud-label">Decisions</p>
              {ticket.decisionLog.slice(-3).map((d) => (
                <div key={d.id} className="text-xs text-mut bg-mist/70 border border-line/60 rounded-sm px-2 py-1.5">
                  <span className={`font-mono ${d.gateType === 'one-way' ? 'text-alert' : 'text-ok'}`}>
                    {d.gateType === 'one-way' ? '1-way' : '2-way'}
                  </span>
                  <span className="ml-2 text-ink">{d.decision}</span>
                  {d.reasoning && <p className="text-[11px] text-mut mt-0.5 leading-relaxed">{d.reasoning}</p>}
                </div>
              ))}
            </div>
          )}

          {ticket.workNotes.length > 0 && (
            <div className="space-y-1">
              <p className="hud-label">Work Notes</p>
              {ticket.workNotes.map((note) => (
                <p key={note.id} className="text-xs text-mut bg-mist/70 border border-line/60 rounded-sm px-2 py-1.5 leading-relaxed">
                  {note.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 pt-0.5">
        <form onSubmit={handleAddNote} className="flex flex-1 gap-1">
          <input
            name="note"
            placeholder="Add note..."
            className="flex-1 min-w-0 text-xs bg-mist/70 border border-line rounded-sm px-2 py-1 text-ink placeholder-faint focus:outline-none focus:border-sync transition-colors"
          />
          <button type="submit" className="text-xs text-mut bg-mist hover:bg-line/60 border border-line rounded-sm px-2 py-1 transition-colors">
            +
          </button>
        </form>
        <button
          onClick={() => onDelete(ticket.id)}
          title="Delete ticket"
          className="opacity-0 group-hover:opacity-100 text-faint hover:text-alert transition-all p-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}

type BlockerReference = ReturnType<typeof getBlockingReferences>[number]

function summarizeBlocker(blocker: BlockerReference): string {
  if (blocker.reason === 'missing-ticket') return `Blocked by missing/external: ${blocker.id}`
  if (blocker.reason === 'self-reference') return 'Blocked by invalid self-reference'
  return `Blocked by ${blocker.ticket?.title ?? blocker.id}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
