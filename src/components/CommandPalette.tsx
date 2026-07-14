import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Ticket, View } from '../types'
import { SOURCE_TEXT_COLORS, STATUS_LABELS } from '../types'
import { PRIMARY_AREAS, resolvePrimaryArea } from '../lib/workspace-navigation'

interface Command {
  id: string
  label: string
  hint?: string
  section: 'Navigate' | 'Actions' | 'Tickets'
  keywords: string
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  tickets: Ticket[]
  onNavigate: (view: View) => void
  onJumpToTicket: (id: string) => void
}

export function CommandPalette({ open, onClose, tickets, onNavigate, onJumpToTicket }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = PRIMARY_AREAS.map((area) => ({
      id: `nav-${area.id}`,
      label: `Go to ${area.label}`,
      hint: area.id === 'next-actions' ? 'SDD work appears as tickets' : undefined,
      section: 'Navigate' as const,
      keywords: `${area.id} ${area.label} ${area.description} ${area.keywords.join(' ')}`.toLowerCase(),
      run: () => { onNavigate(resolvePrimaryArea(area.id, typeof window === 'undefined' ? undefined : window.localStorage)); onClose() },
    }))
    nav.push({ id: 'nav-settings', label: 'Open Data & Privacy', hint: 'download, restore, compatibility', section: 'Navigate', keywords: 'settings data privacy compatibility export import telemetry', run: () => { onNavigate('settings'); onClose() } })

    const actions: Command[] = [
      {
        id: 'act-new',
        label: 'New ticket',
        hint: 'opens the ticket board',
        section: 'Actions',
        keywords: 'new create ticket add task',
        run: () => { onNavigate('tickets'); onClose() },
      },
    ]

    const ticketCmds: Command[] = tickets.map((t) => ({
      id: `ticket-${t.id}`,
      label: t.title,
      hint: `${t.source} · ${STATUS_LABELS[t.status]}`,
      section: 'Tickets' as const,
      keywords: `${t.title} ${t.description} ${t.source} ${t.status}`.toLowerCase(),
      run: () => { onJumpToTicket(t.id); onClose() },
    }))

    return [...nav, ...actions, ...ticketCmds]
  }, [tickets, onNavigate, onJumpToTicket, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => q.split(/\s+/).every((word) => c.keywords.includes(word)))
  }, [commands, query])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => setSelected(0), [query])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
      if (e.key === 'Enter') { e.preventDefault(); filtered[selected]?.run() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, selected, onClose])

  // Keep selection in view
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  let lastSection: string | null = null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 bg-chrome/70 backdrop-blur-sm flex items-start justify-center pt-[14vh] px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="w-full max-w-xl bg-chrome border border-chrome-line rounded-sm shadow-2xl shadow-black/40 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 border-b border-chrome-line">
              <span className="text-sync font-mono text-xs shrink-0" aria-hidden="true">▮</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tickets, jump to a view, run an action…"
                className="flex-1 bg-transparent py-3.5 text-sm text-chrome-ink placeholder-chrome-mut focus:outline-none"
              />
              <kbd className="text-[10px] text-chrome-mut bg-chrome-raised border border-chrome-line rounded-sm px-1.5 py-0.5">esc</kbd>
            </div>

            <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
              {filtered.length === 0 && (
                <p className="text-sm text-chrome-mut text-center py-8">No results for “{query}”</p>
              )}
              {filtered.map((cmd, i) => {
                const showSection = cmd.section !== lastSection
                lastSection = cmd.section
                return (
                  <div key={cmd.id}>
                    {showSection && (
                      <p className="px-4 pt-2 pb-1 text-[10px] font-mono font-semibold uppercase tracking-[0.18em] text-chrome-mut">{cmd.section}</p>
                    )}
                    <button
                      data-idx={i}
                      onClick={cmd.run}
                      onMouseEnter={() => setSelected(i)}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left transition-colors ${
                        i === selected ? 'bg-sync/15 text-white border-l-2 border-sync' : 'text-chrome-mut border-l-2 border-transparent'
                      }`}
                    >
                      <span className="text-sm truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <span className={`text-[10px] shrink-0 ${cmd.hint.startsWith('Pi') ? SOURCE_TEXT_COLORS['Pi'] : cmd.hint.startsWith('Codex') ? SOURCE_TEXT_COLORS['Codex'] : cmd.hint.startsWith('Claude') ? SOURCE_TEXT_COLORS['Claude Cowork'] : 'text-chrome-mut'}`}>
                          {cmd.hint}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-4 px-4 py-2 border-t border-chrome-line text-[10px] text-chrome-mut">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">↵</kbd> select</span>
              <span><kbd className="font-mono">esc</kbd> close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
