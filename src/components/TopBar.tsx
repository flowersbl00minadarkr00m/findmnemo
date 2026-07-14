import type { View } from '../types'
import { VIEW_META } from '../lib/workspace-navigation'

interface Props {
  view: View
  sample?: boolean
  onOpenPalette: () => void
  onOpenSettings: () => void
}

export function TopBar({
  view,
  sample = false,
  onOpenPalette,
  onOpenSettings,
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
        {!sample && <button type="button" onClick={onOpenSettings} className="rounded-sm border border-chrome-line bg-chrome-raised/60 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-chrome-mut hover:text-chrome-ink">Data & Privacy</button>}

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
