import type { UsageQueryDto } from '../../shared/companion-contract'

interface UsageFiltersProps {
  filters: UsageQueryDto
  onChange: (filters: UsageQueryDto) => void
  busy: boolean
}

export function UsageFilters({ filters, onChange, busy }: UsageFiltersProps) {
  const update = (key: keyof UsageQueryDto, value: string) => onChange({ ...filters, [key]: value || null })
  return (
    <fieldset aria-busy={busy} className="panel grid gap-3 rounded-sm p-4 sm:grid-cols-2 lg:grid-cols-5">
      <legend className="hud-label px-1">Filter observed usage</legend>
      <label className="text-xs text-mut">From<input aria-label="Usage period start" type="date" value={filters.start ?? ''} onChange={(event) => update('start', event.target.value)} className="mt-1 w-full rounded-sm border border-line bg-abyss px-3 py-2 text-ink" /></label>
      <label className="text-xs text-mut">To<input aria-label="Usage period end" type="date" value={filters.end ?? ''} onChange={(event) => update('end', event.target.value)} className="mt-1 w-full rounded-sm border border-line bg-abyss px-3 py-2 text-ink" /></label>
      <label className="text-xs text-mut">Tool<input aria-label="Filter by tool" value={filters.clientId ?? ''} onChange={(event) => update('clientId', event.target.value)} placeholder="All tools" className="mt-1 w-full rounded-sm border border-line bg-abyss px-3 py-2 text-ink" /></label>
      <label className="text-xs text-mut">Provider<input aria-label="Filter by provider" value={filters.providerId ?? ''} onChange={(event) => update('providerId', event.target.value)} placeholder="All providers" className="mt-1 w-full rounded-sm border border-line bg-abyss px-3 py-2 text-ink" /></label>
      <label className="text-xs text-mut">Model<input aria-label="Filter by model" value={filters.modelId ?? ''} onChange={(event) => update('modelId', event.target.value)} placeholder="All models" className="mt-1 w-full rounded-sm border border-line bg-abyss px-3 py-2 text-ink" /></label>
    </fieldset>
  )
}
