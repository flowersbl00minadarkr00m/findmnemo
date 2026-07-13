import type { Ticket } from '../types'

interface Props {
  ticket: Pick<Ticket, 'generatedKind' | 'sddGate' | 'receiptRequired'>
}

const KIND_LABELS: Record<NonNullable<Ticket['generatedKind']>, string> = {
  manual: 'Manual',
  'sdd-gate-placeholder': 'SDD gate',
  'sdd-task-execution': 'SDD task',
}

const KIND_CLASSES: Record<NonNullable<Ticket['generatedKind']>, string> = {
  manual: 'border-line text-mut bg-paper/70',
  'sdd-gate-placeholder': 'border-sync/45 text-sync bg-sync/10',
  'sdd-task-execution': 'border-memory/45 text-memory bg-memory/10',
}

export function SddGateTicketBadge({ ticket }: Props) {
  if (!ticket.generatedKind && !ticket.sddGate && !ticket.receiptRequired) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {ticket.generatedKind && (
        <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-mono ${KIND_CLASSES[ticket.generatedKind]}`}>
          {KIND_LABELS[ticket.generatedKind]}
        </span>
      )}
      {ticket.sddGate && (
        <span className="rounded-sm border border-line bg-paper/70 px-1.5 py-0.5 text-[10px] font-mono text-mut">
          {ticket.sddGate}
        </span>
      )}
      {ticket.receiptRequired && (
        <span className="rounded-sm border border-warn/45 bg-warn/10 px-1.5 py-0.5 text-[10px] font-mono text-warn">
          receipt required
        </span>
      )}
    </span>
  )
}
