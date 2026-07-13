import type { View } from '../types'

interface Props {
  view: View
  sample?: boolean
  onOpenPalette: () => void
  telemetryCount: number
  onExportTelemetry: () => void
  onImportTelemetry: () => void
  onExportObservedWork: () => void
}

const VIEW_META: Record<View, { title: string; subtitle: string }> = {
  operations: { title: 'Operations Desk', subtitle: 'Prioritized work, evidence, and source health' },
  brief: { title: 'Daily Brief', subtitle: 'A simplified pass over the same operational records' },
  tickets: { title: 'Tickets', subtitle: 'Kanban board - drag cards between columns' },
  sdd: { title: 'Projects/SDD', subtitle: 'Project gates, generated tickets, and receipt state' },
  routing: { title: 'Model Routing', subtitle: 'Local capability-aware route preferences' },
  analytics: { title: 'Analytics', subtitle: 'Throughput, agent load, and cycle time' },
  emails: { title: 'Emails', subtitle: 'Inbox threads awaiting a response' },
}

export function TopBar({
  view,
  sample = false,
  onOpenPalette,
  telemetryCount,
  onExportTelemetry,
  onImportTelemetry,
  onExportObservedWork,
}: Props) {
  const meta = VIEW_META[view]
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

  return (
    <header className="sticky top-0 z-30 min-h-14 flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 bg-chrome/92 backdrop-blur-xl border-b border-chrome-line shadow-[0_14px_34px_rgba(0,0,0,0.2)]">
      <div className="min-w-0 max-w-full">
        <h1 className="text-[13px] font-mono font-semibold uppercase tracking-[0.14em] text-chrome-ink leading-tight">
          <span className="text-sync">| </span>{meta.title}
        </h1>
        <p className="text-[11px] text-chrome-mut leading-tight truncate">{meta.subtitle}</p>
      </div>

      <div className="flex max-w-full flex-wrap items-center justify-end gap-2 sm:gap-3">
        {!sample && <details className="relative">
          <summary className="cursor-pointer list-none rounded-sm border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-amber-300 hover:bg-amber-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
            Compatibility
          </summary>
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] rounded-sm border border-chrome-line bg-chrome-raised p-3 text-xs leading-5 text-chrome-mut shadow-xl">
            <p className="font-medium text-chrome-ink">Current product: FindMnemo</p>
            <p>Legacy identifiers remain readable: <code>mnemosync</code>, <code>mnemosync://</code>, and existing local storage keys.</p>
            <p>Supported consumers: FlowSensa, OSSensa, SancusSight, and LocalCFO.</p>
          </div>
        </details>}

        {!sample && <button
          type="button"
          onClick={onExportObservedWork}
          title="Download a private, legacy-compatible FindMnemo observed-work JSON file."
          className="flex items-center gap-2 rounded-sm border border-memory/40 bg-memory/10 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-memory hover:bg-memory/20"
        >
          Export observed work
        </button>}

        {!sample && <button
          type="button"
          onClick={onImportTelemetry}
          title="Import agent telemetry from a JSONL file."
          className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-memory border border-memory/40 bg-memory/10 hover:bg-memory/20 rounded-sm px-3 py-1.5 transition-colors"
        >
          Import
        </button>}

        {!sample && <button
          type="button"
          onClick={onExportTelemetry}
          title="Export the local activity ledger for FlowSensa or another schema-compatible consumer."
          className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-sync border border-sync/40 bg-sync/10 hover:bg-sync/20 rounded-sm px-3 py-1.5 transition-colors"
        >
          Telemetry
          <span className="text-memory">{telemetryCount}</span>
        </button>}

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search or jump to the command palette"
          className="group flex min-w-0 items-center gap-2 text-xs text-chrome-mut hover:text-chrome-ink bg-chrome-raised/60 hover:bg-chrome-raised border border-chrome-line rounded-sm pl-3 pr-2 py-1.5 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
          </svg>
          <span className="hidden sm:inline">Search or jump to...</span>
          <kbd className="text-[10px] text-chrome-mut group-hover:text-chrome-ink bg-chrome border border-chrome-line rounded-sm px-1.5 py-0.5">
            {isMac ? 'Cmd' : 'Ctrl'} K
          </kbd>
        </button>

      </div>
    </header>
  )
}
