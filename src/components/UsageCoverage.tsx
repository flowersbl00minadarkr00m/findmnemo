import type { UsageCapabilityDto, UsageCoverageDto } from '../../shared/companion-contract'

interface UsageCoverageProps { capability: UsageCapabilityDto; coverage: UsageCoverageDto | null }

export function UsageCoverage({ capability, coverage }: UsageCoverageProps) {
  return (
    <section className="panel rounded-sm p-4" aria-labelledby="usage-coverage-title">
      <h2 id="usage-coverage-title" className="hud-label">Coverage and freshness</h2>
      <p className="mt-2 text-sm text-ink">Tokscale {capability.installedVersion ?? 'not detected'} · verified range {capability.supportedRange}</p>
      <p className="mt-1 text-xs text-mut">Last successful refresh: {capability.lastSuccessfulRefreshAt ? new Date(capability.lastSuccessfulRefreshAt).toLocaleString() : 'Never refreshed'}</p>
      {!coverage && <p className="mt-3 text-sm text-mut">No observed usage is stored yet. This does not mean your account usage is zero.</p>}
      {coverage && <div className="mt-3 space-y-2">
        <p className={`text-sm ${coverage.complete ? 'text-emerald-300' : 'text-amber-300'}`}>{coverage.complete ? 'Available sources reported complete coverage for this scan.' : 'Incomplete coverage — totals may omit tools or sessions.'}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {coverage.sources.map((source) => <li key={source.clientId} className="rounded-sm border border-line px-3 py-2 text-xs"><span className="font-medium text-ink">{source.clientId}</span><span className="ml-2 text-mut">{source.state} · {source.messageCount === null ? 'message count unknown' : `${source.messageCount} messages`}</span></li>)}
        </ul>
      </div>}
      <p className="mt-3 text-xs text-mut">FindMnemo receives normalized counts only. Prompts, responses, credentials, raw logs, and raw session/workspace identities stay out of the browser.</p>
    </section>
  )
}
