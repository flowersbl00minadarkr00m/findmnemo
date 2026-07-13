import type { AttentionSourceStatus, AttentionTruthState } from '../types'
import { attentionStateLabel } from '../lib/attention-labels'

const STATE_TONE: Record<AttentionTruthState, string> = {
  current: 'border-ok/40 text-ok',
  stale: 'border-warn/40 text-warn',
  partial: 'border-warn/40 text-warn',
  disconnected: 'border-alert/40 text-alert',
  unverified: 'border-line text-mut',
  fictional: 'border-memory/40 text-memory',
}

export function SourceHealthStrip({ sources, onRetry }: { sources: readonly AttentionSourceStatus[]; onRetry?: (sourceId: string) => void }) {
  if (sources.length === 0) {
    return (
      <div className="rounded-sm border border-line bg-paper/60 px-3 py-2 text-xs text-mut" role="status">
        Source coverage: unverified. Run MnemoSync when a companion source is available.
      </div>
    )
  }

  return (
    <section aria-label="Source coverage" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {sources.map((source) => (
        <article key={source.id} className={`rounded-sm border bg-paper/70 px-3 py-2 ${STATE_TONE[source.truthState]}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-ink">{source.label}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em]">{attentionStateLabel(source.truthState)}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-mut">{source.detail}</p>
          {onRetry && source.truthState !== 'current' && source.truthState !== 'fictional' && (
            <button type="button" onClick={() => onRetry(source.id)} className="mt-2 text-[10px] font-mono uppercase tracking-[0.08em] underline underline-offset-2">
              Retry source
            </button>
          )}
        </article>
      ))}
    </section>
  )
}
