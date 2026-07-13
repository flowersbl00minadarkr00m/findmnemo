import type { LLMSource } from '../types'
import { SOURCE_COLORS } from '../types'

export interface TicketFilters {
  query: string
  sources: LLMSource[]
}

interface Props {
  filters: TicketFilters
  onChange: (filters: TicketFilters) => void
  resultCount: number
  totalCount: number
}

const SOURCES: LLMSource[] = ['Pi', 'Codex', 'Claude Cowork']

export function FilterBar({ filters, onChange, resultCount, totalCount }: Props) {
  const filtering = filters.query.trim() !== '' || filters.sources.length > 0

  function toggleSource(s: LLMSource) {
    const sources = filters.sources.includes(s)
      ? filters.sources.filter((x) => x !== s)
      : [...filters.sources, s]
    onChange({ ...filters, sources })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <svg className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
        </svg>
        <input
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          placeholder="Filter tickets…"
          className="w-52 text-xs bg-paper border border-line rounded-sm pl-8 pr-3 py-1.5 text-ink placeholder-faint focus:outline-none focus:border-sync transition-colors"
        />
      </div>

      {SOURCES.map((s) => {
        const active = filters.sources.includes(s)
        return (
          <button
            key={s}
            onClick={() => toggleSource(s)}
            className={`text-[11px] font-mono px-2.5 py-1 rounded-sm font-medium border transition-all ${
              active
                ? `${SOURCE_COLORS[s]} border-transparent text-white`
                : 'bg-paper border-line text-mut hover:text-ink hover:border-faint'
            }`}
          >
            {s === 'Claude Cowork' ? 'Claude' : s}
          </button>
        )
      })}

      {filtering && (
        <>
          <span className="text-[11px] font-mono text-faint">{resultCount} of {totalCount}</span>
          <button
            onClick={() => onChange({ query: '', sources: [] })}
            className="text-[11px] text-mut hover:text-ink underline underline-offset-2 transition-colors"
          >
            Clear
          </button>
        </>
      )}
    </div>
  )
}
