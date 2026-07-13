import { useState } from 'react'
import type { LLMSource } from '../types'
import { SOURCE_COLORS } from '../types'

interface Props {
  onCreate: (title: string, description: string, source: LLMSource) => void
}

const SOURCES: LLMSource[] = ['Pi', 'Codex', 'Claude Cowork']

export function NewTicketForm({ onCreate }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState<LLMSource>('Pi')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onCreate(title.trim(), description.trim(), source)
    setTitle('')
    setDescription('')
    setSource('Pi')
    setExpanded(false)
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-xs font-mono uppercase tracking-wide bg-sync hover:bg-[#E8641C] text-white rounded-sm px-4 py-2 transition-colors"
      >
        + New Ticket
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="panel rounded-sm p-4 space-y-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ticket title…"
        autoFocus
        className="w-full bg-mist/70 border border-line rounded-sm px-3 py-2 text-sm text-ink placeholder-faint focus:outline-none focus:border-sync"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full bg-mist/70 border border-line rounded-sm px-3 py-2 text-sm text-ink placeholder-faint focus:outline-none focus:border-sync resize-none"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-mut">Source:</span>
        {SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={`text-xs font-mono px-2 py-0.5 rounded-sm font-medium text-white transition-opacity ${
              source === s ? SOURCE_COLORS[s] + ' opacity-100' : SOURCE_COLORS[s] + ' opacity-35 hover:opacity-60'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="text-xs font-mono uppercase tracking-wide bg-sync hover:bg-[#E8641C] text-white rounded-sm px-4 py-1.5 transition-colors"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-mut hover:text-ink transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
