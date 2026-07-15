import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CompletedRangePreset, CompletedWorkQueryDto, CompletedWorkResultDto } from '../../shared/companion-contract'
import type { OperationalRepository } from '../lib/operational-repository'

interface Props { repository: OperationalRepository; onOpenTicket: (id: string) => void; onReopen: (id: string) => Promise<void>; initialPreset?: CompletedRangePreset; onPresetChange?: (preset: CompletedRangePreset) => void }
type RangeChoice = CompletedRangePreset | 'custom'

export function CompletedWorkPanel({ repository, onOpenTicket, onReopen, initialPreset = '30d', onPresetChange }: Props) {
  const [preset, setPreset] = useState<RangeChoice>(initialPreset)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [result, setResult] = useState<CompletedWorkResultDto>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [reopeningId, setReopeningId] = useState<string>()
  const query = useMemo(() => rangeQuery(preset, customStart, customEnd), [preset, customStart, customEnd])

  const load = useCallback(async (cursor?: string) => {
    if (!repository.queryCompletedWork || !query) return
    setLoading(true); setError(undefined)
    try {
      const next = await repository.queryCompletedWork({ ...query, cursor })
      setResult((current) => cursor && current ? { ...next, records: [...current.records, ...next.records] } : next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Completed work could not be loaded.') }
    finally { setLoading(false) }
  }, [query, repository])

  async function reopen(id: string) {
    setReopeningId(id); setError(undefined)
    try { await onReopen(id); setResult((current) => current ? { ...current, records: current.records.filter((record) => record.id !== id), total: Math.max(0, current.total - 1) } : current) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The ticket could not be reopened.') }
    finally { setReopeningId(undefined) }
  }

  useEffect(() => { void load() }, [load])

  function choosePreset(value: CompletedRangePreset) {
    setPreset(value)
    onPresetChange?.(value)
  }

  return <section className="space-y-4" aria-labelledby="completed-work-heading">
    <div className="panel rounded-sm border border-chrome-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="completed-work-heading" className="text-lg font-semibold text-chrome-ink">Completed tickets</h2><p className="mt-1 text-sm text-chrome-mut">Choose the period you want to review. Dates use your current time zone.</p></div><div className="flex gap-2">{repository.downloadCompletedWork && query && <><button type="button" onClick={() => void repository.downloadCompletedWork!(query, 'csv')} className="rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-ink">Export CSV</button><button type="button" onClick={() => void repository.downloadCompletedWork!(query, 'json')} className="rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-ink">Export JSON</button></>}</div></div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Completed ticket date range">{(['7d', '30d', '90d', '12mo'] as const).map((value) => <button key={value} type="button" aria-pressed={preset === value} onClick={() => choosePreset(value)} className={`rounded-sm border px-3 py-2 text-xs ${preset === value ? 'border-sync bg-sync/15 text-sync' : 'border-chrome-line text-chrome-mut'}`}>{value === '12mo' ? '12 months' : value.replace('d', ' days')}</button>)}<button type="button" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')} className={`rounded-sm border px-3 py-2 text-xs ${preset === 'custom' ? 'border-sync bg-sync/15 text-sync' : 'border-chrome-line text-chrome-mut'}`}>Custom</button></div>
      {preset === 'custom' && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-chrome-mut">From<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink" /></label><label className="text-xs text-chrome-mut">Through<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="mt-1 w-full rounded-sm border border-chrome-line bg-chrome px-3 py-2 text-sm text-chrome-ink" /></label></div>}
    </div>
    {error && <p className="rounded-sm border border-rose-400/40 p-3 text-sm text-rose-300" role="alert">{error}</p>}
    {result?.unknownCompletionCount ? <p className="rounded-sm border border-memory/40 bg-memory/10 p-3 text-sm text-chrome-mut">{result.unknownCompletionCount} older completed ticket(s) have no reliable completion date, so they are disclosed but not placed inside this date range.</p> : null}
    <div className="panel rounded-sm border border-chrome-line p-4">
      <p className="text-xs font-mono text-chrome-mut">{loading && !result ? 'Loading…' : `${result?.total ?? 0} completed ticket(s) in this period`}</p>
      <ul className="mt-3 divide-y divide-chrome-line">{result?.records.map((ticket) => <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><button type="button" onClick={() => onOpenTicket(ticket.id)} className="truncate text-left text-sm font-semibold text-chrome-ink hover:text-sync">{ticket.title}</button><p className="mt-1 text-xs text-chrome-mut">Completed {new Date(ticket.completedAt).toLocaleString()} · {ticket.projectLabel ?? ticket.source}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-mono text-emerald-300">DONE</span><button type="button" onClick={() => void reopen(ticket.id)} disabled={reopeningId === ticket.id} className="rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-ink disabled:opacity-50">{reopeningId === ticket.id ? 'Reopening…' : 'Reopen'}</button></div></li>)}</ul>
      {!loading && result?.records.length === 0 && <p className="py-8 text-center text-sm text-chrome-mut">No tickets were completed in this period.</p>}
      {result?.nextCursor && <button type="button" onClick={() => void load(result.nextCursor!)} disabled={loading} className="mt-3 rounded-sm border border-sync/50 px-3 py-2 text-xs text-sync disabled:opacity-50">{loading ? 'Loading…' : 'Load more'}</button>}
    </div>
  </section>
}

function rangeQuery(preset: RangeChoice, customStart: string, customEnd: string): CompletedWorkQueryDto | null {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1)
  let start = new Date(end)
  if (preset === '7d') start.setDate(start.getDate() - 7)
  else if (preset === '30d') start.setDate(start.getDate() - 30)
  else if (preset === '90d') start.setDate(start.getDate() - 90)
  else if (preset === '12mo') start.setMonth(start.getMonth() - 12)
  else {
    if (!customStart || !customEnd) return null
    start = new Date(`${customStart}T00:00:00`)
    const inclusiveEnd = new Date(`${customEnd}T00:00:00`); inclusiveEnd.setDate(inclusiveEnd.getDate() + 1); end.setTime(inclusiveEnd.getTime())
  }
  if (!Number.isFinite(start.getTime()) || start >= end) return null
  return { startInclusive: start.toISOString(), endExclusive: end.toISOString(), timeZone, limit: 50 }
}
