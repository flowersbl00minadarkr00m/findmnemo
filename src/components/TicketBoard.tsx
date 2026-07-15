import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Ticket, TicketStatus } from '../types'
import { STATUS_LABELS, STATUS_ACCENTS } from '../types'
import { TicketCard } from './TicketCard'

interface Props {
  tickets: Ticket[]
  onStatusChange: (id: string, status: Ticket['status']) => void
  onDelete: (id: string) => void
  onAddNote: (id: string, note: string) => void
  highlightId?: string | null
  onOpenDetail?: (id: string) => void
  allTickets?: Ticket[]
  columns?: TicketStatus[]
}

const COLUMNS: TicketStatus[] = ['todo', 'in-progress', 'done', 'blocked']

export function TicketBoard({ tickets, onStatusChange, onDelete, onAddNote, highlightId, onOpenDetail, allTickets, columns = COLUMNS }: Props) {
  const [dragOver, setDragOver] = useState<TicketStatus | null>(null)
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: React.DragEvent, status: TicketStatus) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/ticket-id')
    if (id) onStatusChange(id, status)
    setDragOver(null)
    setDragging(false)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {columns.map((status) => {
        const columnTickets = tickets.filter((t) => t.status === status)
        const isOver = dragOver === status
        return (
          <div
            key={status}
            onDragOver={(e) => { e.preventDefault(); setDragOver(status) }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
            }}
            onDrop={(e) => handleDrop(e, status)}
            className={`rounded-sm p-2 -m-2 transition-colors ${
              isOver ? 'bg-sync/5 outline outline-1 outline-sync/50' :
              dragging ? 'outline outline-1 outline-dashed outline-faint/60' : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_ACCENTS[status]}`} />
              <h2 className="text-[11px] font-mono font-semibold text-mut uppercase tracking-[0.14em]">
                {STATUS_LABELS[status]}
              </h2>
              <span className="ml-auto text-[11px] font-mono text-mut border border-line bg-paper rounded-sm px-2 py-0.5 tabular-nums">
                {columnTickets.length}
              </span>
            </div>
            <div className="space-y-2 min-h-[120px]">
              <AnimatePresence initial={false}>
                {columnTickets.map((ticket) => (
                  <motion.div
                    key={ticket.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.18 }}
                  >
                    <TicketCard
                      ticket={ticket}
                      onStatusChange={onStatusChange}
                      onDelete={onDelete}
                      onAddNote={onAddNote}
                      highlighted={highlightId === ticket.id}
                      onDragStateChange={setDragging}
                      onOpenDetail={onOpenDetail}
                      allTickets={allTickets ?? tickets}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {columnTickets.length === 0 && (
                <div className="border border-dashed border-line rounded-sm py-6 text-center">
                  <p className="text-[11px] font-mono text-faint">{dragging ? 'Drop here' : 'No tickets'}</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
