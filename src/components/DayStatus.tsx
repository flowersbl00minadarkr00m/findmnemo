import type { AttentionDayStatus } from '../types'

export function DayStatus({ status }: { status: AttentionDayStatus }) {
  return (
    <section className="rounded-sm border border-line bg-paper/70 px-4 py-3" aria-label="Daily decision progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="hud-label">Day status</p>
          <p className="mt-1 text-sm text-ink">{status.label}</p>
        </div>
        <span className="font-mono text-xl font-semibold text-sync">{status.progress === null ? '—' : `${status.progress}%`}</span>
      </div>
      {status.progress !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-chrome" aria-hidden="true">
          <div className="h-full bg-sync" style={{ width: `${Math.max(0, Math.min(100, status.progress))}%` }} />
        </div>
      )}
    </section>
  )
}
