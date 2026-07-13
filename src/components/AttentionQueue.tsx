import type { AttentionItem } from '../types'
import { attentionStateLabel } from '../lib/attention-labels'
import { attentionRowId } from '../lib/attention-dom'

const PRIORITY_TONE = {
  critical: 'bg-alert',
  high: 'bg-warn',
  normal: 'bg-sync',
  low: 'bg-faint',
} as const

export function AttentionQueue({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly AttentionItem[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-52 items-center justify-center rounded-sm border border-dashed border-line bg-paper/40 p-6 text-center">
        <div>
          <p className="text-sm font-semibold text-ink">No evidenced attention items</p>
          <p className="mt-1 text-xs text-mut">No actionable work is currently evidenced. Run MnemoSync to refresh configured sources.</p>
        </div>
      </div>
    )
  }

  return (
    <ul className="min-w-0 space-y-2" aria-label="Prioritized attention queue">
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <button
            type="button"
            id={attentionRowId(item.id)}
            aria-pressed={selectedId === item.id}
            onClick={() => onSelect(item.id)}
            className={`w-full rounded-sm border px-3 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sync ${
              selectedId === item.id ? 'border-sync bg-sync/10' : 'border-line bg-paper/65 hover:border-sync/50 hover:bg-paper'
            }`}
          >
            <span className="flex items-start gap-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_TONE[item.priority]}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 max-w-full truncate text-sm font-semibold text-ink">{item.title}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-mut">{item.bucket.replace('-', ' ')}</span>
              </span>
              <span className="mt-1 block line-clamp-2 text-xs text-mut">{item.priorityReason}</span>
              <span className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-faint">
                <span>{item.sourceLabel}</span>
                {item.ownerLabel && <span>Owner: {item.ownerLabel}</span>}
                <span>State: {attentionStateLabel(item.truthState)}</span>
              </span>
            </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
