import { useEffect, useMemo, useRef, useState } from 'react'
import type { GmailCandidateDto } from '../../shared/companion-contract'
import type { LLMSource, Ticket } from '../types'

interface Props {
  candidate: GmailCandidateDto
  tickets: Ticket[]
  onCancel: () => void
  onAssociate: (input: { mode: 'create'; ticket: Ticket } | { mode: 'link'; ticketId: string }, idempotencyKey: string) => Promise<void>
}

export function EmailTicketChooser({ candidate, tickets, onCancel, onAssociate }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'create' | 'link'>('create')
  const [title, setTitle] = useState(candidate.subject)
  const [description, setDescription] = useState(`${candidate.snippet}\n\nFrom: ${candidate.sender}\nReceived: ${candidate.receivedAt}`)
  const [source, setSource] = useState<LLMSource>('Codex')
  const [query, setQuery] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return tickets.filter((ticket) => !normalized || `${ticket.title} ${ticket.description}`.toLowerCase().includes(normalized)).slice(0, 20)
  }, [query, tickets])

  useEffect(() => { dialogRef.current?.focus() }, [])

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? [])]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(undefined)
    try {
      if (mode === 'link') {
        if (!ticketId) throw new Error('Choose one existing ticket.')
        await onAssociate({ mode: 'link', ticketId }, idempotencyKey)
      } else {
        const now = new Date().toISOString()
        await onAssociate({ mode: 'create', ticket: {
          id: crypto.randomUUID(), title: title.trim(), description: description.trim(), source, status: 'todo',
          workNotes: [], decisionLog: [], createdAt: now, updatedAt: now, origin: 'local-bridge',
          artifacts: [{ id: crypto.randomUUID(), type: 'url', label: 'Open Gmail thread', url: candidate.gmailUrl, createdAt: now }],
        } }, idempotencyKey)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Association failed. The confirmation remains retryable.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="email-ticket-chooser-heading" tabIndex={-1} onKeyDown={handleDialogKeyDown} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
    <form onSubmit={submit} className="panel my-auto max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-sm border border-memory/40 p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3"><div><h3 id="email-ticket-chooser-heading" className="text-sm font-semibold text-ink">Create or link a ticket</h3><p className="mt-1 text-xs text-faint">Only sender, subject, received time, bounded snippet, and Gmail reference are prefilled.</p></div><button type="button" onClick={onCancel} className="text-xs text-mut underline">Cancel</button></div>
      <fieldset className="mt-4 flex gap-4"><legend className="sr-only">Association type</legend><label className="text-xs text-ink"><input type="radio" name="association-mode" checked={mode === 'create'} onChange={() => setMode('create')} /> Create new</label><label className="text-xs text-ink"><input type="radio" name="association-mode" checked={mode === 'link'} onChange={() => setMode('link')} /> Link existing</label></fieldset>
      {mode === 'create' ? <div className="mt-4 grid gap-3"><label className="text-xs text-mut">Title<input aria-label="Ticket title" value={title} onChange={(event) => setTitle(event.target.value)} required className="mt-1 w-full rounded-sm border border-line bg-mist px-3 py-2 text-ink" /></label><label className="text-xs text-mut">Description<textarea aria-label="Ticket description" value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="mt-1 w-full rounded-sm border border-line bg-mist px-3 py-2 text-ink" /></label><label className="text-xs text-mut">Agent<select aria-label="Ticket agent" value={source} onChange={(event) => setSource(event.target.value as LLMSource)} className="mt-1 w-full rounded-sm border border-line bg-mist px-3 py-2 text-ink"><option>Pi</option><option>Codex</option><option>Claude Cowork</option></select></label></div> : <div className="mt-4"><label className="text-xs text-mut">Search tickets<input aria-label="Search existing tickets" value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full rounded-sm border border-line bg-mist px-3 py-2 text-ink" /></label><div className="mt-2 max-h-48 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Existing ticket results">{matches.map((ticket) => <label key={ticket.id} className="flex gap-2 rounded-sm border border-line px-3 py-2 text-xs text-ink"><input type="radio" name="existing-ticket" value={ticket.id} checked={ticketId === ticket.id} onChange={() => setTicketId(ticket.id)} />{ticket.title}</label>)}</div></div>}
      {error && <p role="alert" className="mt-3 text-xs text-alert">{error}</p>}
      <button type="submit" disabled={pending} className="mt-4 rounded-sm bg-sync px-4 py-2 text-xs font-semibold text-chrome disabled:opacity-50">{pending ? 'Saving...' : mode === 'create' ? 'Create and link ticket' : 'Link selected ticket'}</button>
    </form>
    </div>
  )
}
