import type { HomeView, MetricsView } from '../types'

export function WorkspaceViewSwitch({
  value,
  onChange,
  briefDisabled = false,
}: {
  value: HomeView
  onChange: (view: HomeView) => void
  briefDisabled?: boolean
}) {
  return (
    <fieldset className="inline-flex rounded-sm border border-line bg-chrome p-1" aria-label="Home view">
      <legend className="sr-only">Home view</legend>
      {(['operations', 'brief'] as const).map((view) => {
        const disabled = view === 'brief' && briefDisabled
        return (
          <label
            key={view}
            className={`rounded-sm px-3 py-1.5 text-xs font-mono uppercase tracking-[0.1em] transition-colors ${
              value === view ? 'bg-sync text-chrome' : 'text-mut hover:text-ink'
            } ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
          >
            <input
              className="sr-only"
              type="radio"
              name="home-view"
              value={view}
              checked={value === view}
              disabled={disabled}
              onChange={() => onChange(view)}
            />
            {view === 'operations' ? 'Operations Desk' : 'Daily Brief'}
          </label>
        )
      })}
    </fieldset>
  )
}

export function MetricsViewSwitch({ value, onChange }: { value: MetricsView; onChange: (view: MetricsView) => void }) {
  return <fieldset className="inline-flex rounded-sm border border-line bg-chrome p-1" aria-label="Metrics view"><legend className="sr-only">Metrics view</legend>{(['usage', 'analytics'] as const).map((view) => <label key={view} className={`cursor-pointer rounded-sm px-3 py-1.5 text-xs font-mono uppercase tracking-[0.1em] transition-colors ${value === view ? 'bg-sync text-chrome' : 'text-mut hover:text-ink'}`}><input className="sr-only" type="radio" name="metrics-view" value={view} checked={value === view} onChange={() => onChange(view)} />{view === 'usage' ? 'Model Usage' : 'Work Metrics'}</label>)}</fieldset>
}
