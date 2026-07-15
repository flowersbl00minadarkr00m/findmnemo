import { useEffect, useMemo, useState } from 'react'
import type { OnboardingSnapshotDto, ReconciliationRunDto, SourceId } from '../../shared/companion-contract'
import type { OperationalRepository } from '../lib/operational-repository'
import type { View } from '../types'
import { AgentActivityControls } from './AgentActivityControls'

export function SourceSetup({ repository, onNavigate, onFinished }: { repository: OperationalRepository; onNavigate: (view: View) => void; onFinished: (run?: ReconciliationRunDto) => void }) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshotDto>()
  const [selected, setSelected] = useState<SourceId[]>([])
  const [run, setRun] = useState<ReconciliationRunDto>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    repository.getOnboardingSnapshot?.().then((next) => {
      if (!active) return
      setSnapshot(next)
      setSelected(next.sources.flatMap((source) => source.reconciliationSourceId && source.state === 'connected' ? [source.reconciliationSourceId] : []))
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : 'Source setup is unavailable.')).finally(() => active && setBusy(false))
    return () => { active = false }
  }, [repository])

  const result = useMemo(() => {
    if (!run || run.state === 'running') return null
    const succeeded = run.sources.filter((source) => source.state === 'checked')
    const failed = run.sources.filter((source) => source.state === 'failed' || source.state === 'unavailable')
    const useful = succeeded.reduce((sum, source) => sum + source.added + source.updated + source.unresolved, 0)
    return { useful, failed: failed.length, succeeded: succeeded.length }
  }, [run])

  async function refresh(requested: SourceId[] = selected) {
    if (!repository.startOnboardingRefresh || !repository.getReconciliationRun) return
    setBusy(true); setError(undefined)
    try {
      let next = await repository.startOnboardingRefresh(requested)
      setRun(next)
      while (next.state === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 300))
        next = await repository.getReconciliationRun(next.id)
        setRun(next)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The first refresh could not finish.') }
    finally { setBusy(false) }
  }

  function openSetup(id: OnboardingSnapshotDto['sources'][number]['id']) {
    const view: View = id === 'gmail' ? 'emails' : id === 'model-usage' ? 'usage' : 'settings'
    onFinished()
    onNavigate(view)
  }

  if (busy && !snapshot) return <div className="panel rounded-sm p-6 text-sm text-mut" role="status">Checking the sources available on this computer…</div>

  return <section className="panel rounded-sm p-5 sm:p-7" aria-labelledby="source-setup-title">
    <p className="hud-label">First-time setup</p>
    <h1 id="source-setup-title" className="mt-2 text-2xl font-semibold text-ink">Choose what FindMnemo should read</h1>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-mut">Everything here is optional. Choose only sources you want. Private paths, credentials, prompts, responses, and raw logs stay off the hosted app.</p>
    {error && <p className="mt-4 rounded-sm border border-alert/50 bg-alert/10 p-3 text-sm text-alert" role="alert">{error}</p>}
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      {snapshot?.sources.map((source) => <article key={source.id} className="rounded-sm border border-line bg-chrome/30 p-4">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-ink">{source.label}</h2><p className="mt-1 text-sm text-mut">{source.description}</p></div><span className="rounded-full border border-line px-2 py-1 text-[10px] font-mono uppercase text-memory">{source.state.replace('-', ' ')}</span></div>
        <dl className="mt-3 space-y-2 text-xs text-mut"><div><dt className="font-semibold text-ink">What stays private</dt><dd>{source.privacy}</dd></div><div><dt className="font-semibold text-ink">What it adds</dt><dd>{source.produces}</dd></div></dl>
        {source.agentActivity && <AgentActivityControls integrations={source.agentActivity} repository={repository} />}
        <div className="mt-3 flex items-center gap-3">
          {source.reconciliationSourceId && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={selected.includes(source.reconciliationSourceId)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, source.reconciliationSourceId!])] : current.filter((id) => id !== source.reconciliationSourceId))} />Include in first refresh</label>}
          <button type="button" onClick={() => openSetup(source.id)} className="ml-auto rounded-sm border border-line px-3 py-2 text-xs text-ink">{source.state === 'connected' ? 'View details' : 'Set up'}</button>
        </div>
      </article>)}
    </div>
    {run && <div className="mt-4 rounded-sm border border-line p-4" role="status"><p className="font-semibold text-ink">{run.state === 'running' ? 'Refreshing selected sources…' : result?.failed ? 'Refresh finished with gaps' : result?.useful ? 'FindMnemo found useful work' : 'Refresh complete — nothing needs attention yet'}</p>{result && <p className="mt-1 text-sm text-mut">{result.succeeded} source(s) checked successfully · {result.failed} source(s) need attention · {result.useful} new, updated, or review item(s).</p>}</div>}
    <div className="mt-5 flex flex-wrap gap-3">
      {!result && <button type="button" onClick={() => void refresh()} disabled={busy} className="rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-50">{busy ? 'Refreshing…' : selected.length ? 'Refresh selected sources' : 'Continue with tickets only'}</button>}
      {result && <button type="button" onClick={() => onFinished(run)} className="rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome">Open My Day</button>}
      {!run && selected.length > 0 && <button type="button" onClick={() => void refresh([])} disabled={busy} className="rounded-sm border border-line px-4 py-2 text-sm text-mut disabled:opacity-50">Skip optional sources</button>}
    </div>
  </section>
}
