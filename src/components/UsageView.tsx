import { useCallback, useEffect, useRef, useState } from 'react'
import type { NormalizedUsageRecordDto, RoutingExecutionProfile, UsageCapabilityDto, UsageManualMappingDto, UsageQueryDto, UsageRefreshRunDto, UsageSummaryDto } from '../../shared/companion-contract'
import type { OperationalRepository } from '../lib/operational-repository'
import { formatEstimatedCost, formatUsageMetric } from '../lib/usage-format'
import { usageIdentityKeyForBrowser } from '../lib/usage-identity'
import { UsageCoverage } from './UsageCoverage'
import { UsageFilters } from './UsageFilters'
import { UsageMappingPanel } from './UsageMappingPanel'

interface UsageViewProps {
  repository: OperationalRepository
  initialFilters?: UsageQueryDto
}

const defaultFilters = (): UsageQueryDto => {
  const end = new Date()
  const start = new Date(end)
  start.setUTCMonth(start.getUTCMonth() - 12)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), clientId: null, providerId: null, modelId: null, profileId: null, mappingState: null }
}

export function UsageView({ repository, initialFilters }: UsageViewProps) {
  const [filters, setFilters] = useState<UsageQueryDto>(() => initialFilters ?? defaultFilters())
  const [capability, setCapability] = useState<UsageCapabilityDto>()
  const [summary, setSummary] = useState<UsageSummaryDto>()
  const [unmapped, setUnmapped] = useState<NormalizedUsageRecordDto[]>([])
  const [mappings, setMappings] = useState<UsageManualMappingDto[]>([])
  const [profiles, setProfiles] = useState<RoutingExecutionProfile[]>([])
  const [run, setRun] = useState<UsageRefreshRunDto>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (initialFilters) setFilters(initialFilters)
  }, [initialFilters])

  const load = useCallback(async () => {
    if (!repository.getUsageCapability || !repository.getUsageSummary || !repository.getUsageRecords) {
      setError('Usage requires the current local companion. Update or reconnect the companion, then retry.')
      return
    }
    setBusy(true)
    try {
      const unmappedFilters = { ...filters, mappingState: 'unmapped' as const }
      const [nextCapability, nextSummary, records, nextMappings, policy] = await Promise.all([
        repository.getUsageCapability(), repository.getUsageSummary(filters), repository.getUsageRecords(unmappedFilters), repository.listUsageMappings?.() ?? [], repository.getRoutingPolicy?.() ?? null,
      ])
      if (!mounted.current) return
      setCapability(nextCapability); setSummary(nextSummary); setUnmapped(records.records); setMappings(nextMappings); setProfiles(policy?.profiles ?? []); setError(undefined)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Usage evidence is unavailable.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [filters, repository])

  useEffect(() => { void load() }, [load])

  const refresh = useCallback(async () => {
    if (!repository.startUsageRefresh || !repository.getUsageRefresh || !filters.start || !filters.end) return
    setBusy(true); setError(undefined)
    try {
      let next = await repository.startUsageRefresh({ since: filters.start, until: filters.end })
      if (mounted.current) setRun(next)
      while (!['complete', 'partial', 'failed', 'cancelled'].includes(next.state)) {
        await new Promise((resolve) => setTimeout(resolve, 350))
        if (!mounted.current) return
        next = await repository.getUsageRefresh(next.id)
        setRun(next)
      }
      await load()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Usage refresh failed.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [filters.end, filters.start, load, repository])

  const cancel = useCallback(async () => {
    if (!run || !repository.cancelUsageRefresh) return
    setRun(await repository.cancelUsageRefresh(run.id))
  }, [repository, run])

  const saveMapping = useCallback(async (mapping: { clientId: string; providerId: string | null; modelId: string; profileId: string }) => {
    if (!repository.saveUsageMapping) return
    try {
      await repository.saveUsageMapping({ ...mapping, identityKey: await usageIdentityKeyForBrowser(mapping) })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mapping could not be saved.')
    }
  }, [load, repository])

  const removeMapping = useCallback(async (identityKey: string) => {
    if (!repository.removeUsageMapping) return
    try { await repository.removeUsageMapping(identityKey); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mapping could not be removed.') }
  }, [load, repository])

  const exportUsage = useCallback(async (format: 'json' | 'csv') => {
    if (!repository.downloadUsageExport) return
    try { await repository.downloadUsageExport(filters, format, true) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Usage export failed.') }
  }, [filters, repository])

  const clearHistory = useCallback(async () => {
    if (!repository.clearUsageHistory || !window.confirm('Clear normalized usage history? Manual route mappings will be preserved.')) return
    await repository.clearUsageHistory(); setRun(undefined); await load()
  }, [load, repository])

  const clearMappings = useCallback(async () => {
    if (!repository.clearUsageMappings || !window.confirm('Clear all manual usage mappings? Usage history will be preserved.')) return
    await repository.clearUsageMappings(); await load()
  }, [load, repository])

  if (!capability && busy) return <div className="panel rounded-sm p-6 text-sm text-mut" role="status">Checking local model-usage capability…</div>
  if (!capability) return <div className="panel rounded-sm border border-rose-400/40 p-6"><h2 className="text-lg font-semibold">Usage is unavailable</h2><p className="mt-2 text-sm text-mut">{error ?? 'Connect the local companion and retry.'}</p><button type="button" onClick={() => void load()} className="mt-4 rounded-sm border border-sync px-3 py-2 text-sm text-sync">Retry</button></div>

  const supported = capability.state === 'installed-supported'
  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden rounded-sm p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="hud-label">Local model usage</p><h2 className="mt-2 text-2xl font-semibold text-ink">See what you actually use</h2><p className="mt-2 max-w-2xl text-sm text-mut">Token and estimated-cost evidence collected locally by Tokscale. This is observed session activity, not provider billing or subscription quota.</p><p className="mt-2 text-xs font-medium text-memory">{usageCollectorLabel(capability)}{capability.installedVersion ? ` · Tokscale ${capability.installedVersion}` : ''}</p></div>
          <div className="flex gap-2"><button type="button" disabled={!supported || busy} onClick={() => void refresh()} className="rounded-sm bg-sync px-4 py-2 text-sm font-medium text-chrome disabled:opacity-40">Refresh usage</button>{run && !['complete', 'partial', 'failed', 'cancelled'].includes(run.state) && <button type="button" onClick={() => void cancel()} className="rounded-sm border border-rose-400/60 px-4 py-2 text-sm text-rose-300">Cancel</button>}</div>
        </div>
        {!supported && <div className="mt-4 rounded-sm border border-amber-400/40 bg-amber-400/10 p-4 text-sm"><p className="font-medium text-amber-200">{usageCapabilityTitle(capability)}</p><p className="mt-1 text-mut">{capability.guidance.summary}</p><p className="mt-1 text-mut">A separate global Tokscale installation is not required.</p><a className="mt-2 inline-block text-sync underline" href={capability.guidance.installationUrl} target="_blank" rel="noreferrer">Open FindMnemo troubleshooting</a></div>}
        {run && <p className="mt-4 text-sm" role="status" aria-live="polite">Refresh: <span className="font-medium">{run.state}</span> · {run.stage.replaceAll('-', ' ')}{run.retainedPreviousSuccess ? ' · previous successful data retained' : ''}</p>}
        {error && <p className="mt-4 rounded-sm border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-200" role="alert">{error}</p>}
      </section>

      <UsageFilters filters={filters} onChange={setFilters} busy={busy} />

      {summary && <>
        <section aria-label="Usage totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total tokens" value={formatUsageMetric(summary.totalTokens, true)} detail={`${summary.recordCount} observed daily model records`} />
          <MetricCard label="Input tokens" value={formatUsageMetric(summary.inputTokens, true)} detail="Reported or known portion" />
          <MetricCard label="Output tokens" value={formatUsageMetric(summary.outputTokens, true)} detail="Reported or known portion" />
          <MetricCard label="Estimated cost" value={formatEstimatedCost(summary.cost, summary.currencies[0])} detail="Not billing or quota data" />
        </section>
        <section className="panel rounded-sm p-4" aria-labelledby="token-composition-title"><h2 id="token-composition-title" className="hud-label">Token composition</h2><dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Composition label="Input" value={formatUsageMetric(summary.inputTokens)} /><Composition label="Output" value={formatUsageMetric(summary.outputTokens)} /><Composition label="Cache read" value={formatUsageMetric(summary.cacheReadTokens)} /><Composition label="Cache write" value={formatUsageMetric(summary.cacheWriteTokens)} /><Composition label="Reasoning" value={formatUsageMetric(summary.reasoningTokens)} /></dl></section>
        <section className="grid gap-4 xl:grid-cols-2">
          <BreakdownTable title="Models used" rows={summary.breakdowns.models} />
          <BreakdownTable title="Tools used" rows={summary.breakdowns.clients} />
        </section>
        <section className="panel rounded-sm p-4 overflow-x-auto" aria-labelledby="usage-trend-title"><h2 id="usage-trend-title" className="hud-label">Daily trend</h2><table className="mt-3 w-full min-w-[32rem] text-left text-sm"><thead className="text-xs text-mut"><tr><th className="py-2">Date</th><th>Records</th><th>Tokens</th><th>Estimated cost</th></tr></thead><tbody>{summary.trends.day.map((point) => <tr key={point.periodStart} className="border-t border-line"><td className="py-2">{point.periodStart}</td><td>{point.recordCount}</td><td>{formatUsageMetric(point.totalTokens)}</td><td>{formatEstimatedCost(point.cost, summary.currencies[0])}</td></tr>)}</tbody></table>{summary.trends.day.length === 0 && <p className="py-6 text-sm text-mut">No observed usage in this period. Coverage may still be incomplete.</p>}</section>
        <UsageCoverage capability={capability} coverage={summary.coverage} />
        <UsageMappingPanel unmapped={unmapped} mappings={mappings} profiles={profiles} onSave={saveMapping} onRemove={removeMapping} />
        <section className="panel rounded-sm p-4" aria-labelledby="usage-data-controls"><h2 id="usage-data-controls" className="hud-label">Export or clear local evidence</h2><p className="mt-2 text-sm text-mut">Exports contain normalized records and provenance, never prompts, responses, credentials, raw logs, or raw session/workspace identities.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void exportUsage('json')} className="rounded-sm border border-sync px-3 py-2 text-sm text-sync">Export JSON</button><button type="button" onClick={() => void exportUsage('csv')} className="rounded-sm border border-sync px-3 py-2 text-sm text-sync">Export CSV</button><button type="button" onClick={() => void clearHistory()} className="rounded-sm border border-rose-400/50 px-3 py-2 text-sm text-rose-300">Clear usage history</button><button type="button" onClick={() => void clearMappings()} className="rounded-sm border border-rose-400/50 px-3 py-2 text-sm text-rose-300">Clear mappings</button></div></section>
      </>}
    </div>
  )
}

function usageCapabilityTitle(capability: UsageCapabilityDto): string {
  if (capability.collectorSource === 'external-recovery') return 'External recovery could not be verified.'
  if (capability.state === 'installed-unsupported-version') return 'Unsupported built-in collector version.'
  if (capability.reasonCode === 'TOKSCALE_EMBEDDED_UNSUPPORTED_PLATFORM') return 'Built-in collector unavailable for this platform.'
  if (capability.reasonCode === 'TOKSCALE_PROCESS_FAILED') return 'Built-in collector damaged.'
  return 'Built-in collector unavailable.'
}

function usageCollectorLabel(capability: UsageCapabilityDto): string {
  if (capability.collectorSource === 'embedded') return 'Built-in collector ready'
  if (capability.collectorSource === 'external-recovery') return 'External recovery selected'
  if (capability.state === 'installed-supported' && capability.collectorSource === undefined) return 'Collector ready · update companion for source details'
  return 'Built-in collector unavailable'
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="panel rounded-sm p-4"><p className="hud-label">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{value}</p><p className="mt-1 text-xs text-mut">{detail}</p></article>
}

function BreakdownTable({ title, rows }: { title: string; rows: UsageSummaryDto['breakdowns']['models'] }) {
  return <section className="panel rounded-sm p-4 overflow-x-auto"><h2 className="hud-label">{title}</h2><table className="mt-3 w-full text-left text-sm"><thead className="text-xs text-mut"><tr><th className="py-2">Name</th><th>Records</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-t border-line"><td className="py-2 text-ink">{row.label}</td><td>{row.recordCount}</td><td>{formatUsageMetric(row.totalTokens)}</td><td>{formatEstimatedCost(row.cost, undefined)}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="py-6 text-sm text-mut">No observed usage.</p>}</section>
}

function Composition({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-mut">{label}</dt><dd className="mt-1 font-mono text-sm text-ink">{value}</dd></div>
}
