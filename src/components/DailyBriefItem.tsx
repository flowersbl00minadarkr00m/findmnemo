import { useState } from 'react'
import type { AttentionAction, AttentionItem } from '../types'
import { attentionStateLabel } from '../lib/attention-labels'
import { dailyBriefRowId } from '../lib/attention-dom'

export function DailyBriefItem({
  item,
  onInspect,
  onAction,
}: {
  item: AttentionItem
  onInspect: (id: string) => void
  onAction: (action: AttentionAction, item: AttentionItem) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function act(action: AttentionAction) {
    if (pending || action.disabledReason) return
    setPending(true)
    setError(undefined)
    try { await onAction(action, item) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed.') }
    finally { setPending(false) }
  }

  return (
    <li className="rounded-sm border border-line bg-paper/65 p-3">
      <div className="flex items-start justify-between gap-3">
        <button id={dailyBriefRowId(item.id)} type="button" onClick={() => onInspect(item.id)} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sync">
          <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
          <span className="mt-1 block line-clamp-2 text-xs text-mut">{item.priorityReason}</span>
          <span className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-faint">
            <span>{item.sourceLabel}</span>
            <span>{attentionStateLabel(item.truthState)}</span>
          </span>
        </button>
        <button
          type="button"
          disabled={pending || Boolean(item.primaryAction.disabledReason)}
          title={item.primaryAction.disabledReason}
          onClick={() => void act(item.primaryAction)}
          className="shrink-0 rounded-sm bg-sync px-3 py-2 text-xs font-semibold text-chrome disabled:opacity-45"
        >
          {pending ? 'Working…' : item.primaryAction.label}
        </button>
      </div>
      {item.secondaryActions.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-mono uppercase tracking-[0.08em] text-mut">More actions</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.secondaryActions.map((action) => (
              <button key={action.id} type="button" disabled={pending || Boolean(action.disabledReason)} onClick={() => void act(action)} className="rounded-sm border border-line px-2 py-1 text-[10px] text-ink disabled:opacity-45">
                {action.label}
              </button>
            ))}
          </div>
        </details>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-alert">{error}</p>}
    </li>
  )
}
