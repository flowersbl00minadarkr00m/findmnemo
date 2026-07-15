const SAMPLE_CONNECTIONS = [
  { name: 'Codex', detail: 'Windows CLI · authenticated', state: 'Ready', stateClass: 'text-memory border-memory/40 bg-memory/10' },
  { name: 'Claude Code', detail: 'Windows CLI · sign-in required', state: 'Needs action', stateClass: 'text-amber-200 border-amber-400/40 bg-amber-400/10' },
  { name: 'Pi', detail: 'RPC destination · catalog current', state: 'Ready', stateClass: 'text-memory border-memory/40 bg-memory/10' },
] as const

const SAMPLE_ASSIGNMENTS = [
  { work: 'Default', primary: 'Codex · GPT-5.4 / low', backup: 'Pi · GPT-5.2', behavior: 'Ask first' },
  { work: 'Engineering', primary: 'Codex · GPT-5.4 / medium', backup: 'Pi · GPT-5.2', behavior: 'Send automatically' },
  { work: 'Review', primary: 'Claude · Opus 4.1', backup: 'Codex · GPT-5.4', behavior: 'Ask first' },
  { work: 'Research', primary: 'Pi · Gemini 2.5 Pro', backup: 'Claude · Sonnet 4', behavior: 'Ask first' },
] as const

const SAMPLE_USAGE_MODELS = [
  { name: 'Codex · GPT-5.4', tokens: '842k', sessions: 18, cost: '$8.74', share: '46%' },
  { name: 'Claude · Opus 4.1', tokens: '561k', sessions: 11, cost: '$6.82', share: '31%' },
  { name: 'Pi · Gemini 2.5 Pro', tokens: '286k', sessions: 9, cost: '$2.19', share: '16%' },
  { name: 'Other observed routes', tokens: '126k', sessions: 6, cost: '$0.67', share: '7%' },
] as const

export function SampleEnginesView() {
  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden rounded-sm p-5 sm:p-6" aria-labelledby="sample-routing-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="hud-label">Fictional Sample workspace</p>
            <h2 id="sample-routing-title" className="mt-2 text-2xl font-semibold text-ink">Sample model routing</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-mut">A representative, non-executable routing policy showing how FindMnemo separates discovered connections, readiness, assignments, and receipts.</p>
          </div>
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">Sample only · no providers contacted</span>
        </div>
      </section>

      <section aria-labelledby="sample-connections-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><p className="hud-label">Connections</p><h3 id="sample-connections-title" className="mt-1 text-lg font-semibold">Readiness stays destination-specific</h3></div>
          <p className="hidden text-xs text-faint sm:block">Fictional evidence</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {SAMPLE_CONNECTIONS.map((connection) => (
            <article key={connection.name} className="panel rounded-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h4 className="font-semibold text-ink">{connection.name}</h4><p className="mt-1 text-xs leading-5 text-mut">{connection.detail}</p></div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium ${connection.stateClass}`}>{connection.state}</span>
              </div>
              <p className="mt-4 text-[11px] text-faint">Catalog checked 8 minutes ago · sample</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel overflow-hidden rounded-sm" aria-labelledby="sample-assignments-title">
        <div className="border-b border-line px-5 py-4"><p className="hud-label">Routing policy</p><h3 id="sample-assignments-title" className="mt-1 text-lg font-semibold">One assignment per work type</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-white/[0.02] text-xs text-mut"><tr><th className="px-5 py-3">Work type</th><th className="px-5 py-3">Primary</th><th className="px-5 py-3">Backup</th><th className="px-5 py-3">Behavior</th></tr></thead>
            <tbody>{SAMPLE_ASSIGNMENTS.map((assignment) => <tr key={assignment.work} className="border-t border-line"><td className="px-5 py-3 font-medium text-ink">{assignment.work}</td><td className="px-5 py-3">{assignment.primary}</td><td className="px-5 py-3 text-mut">{assignment.backup}</td><td className="px-5 py-3"><span className="rounded-full border border-line px-2 py-1 text-xs">{assignment.behavior}</span></td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="panel rounded-sm p-5" aria-labelledby="sample-receipt-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="hud-label">Latest fictional receipt</p><h3 id="sample-receipt-title" className="mt-1 text-lg font-semibold">Engineering review returned to the requesting chat</h3></div>
          <span className="rounded-full border border-memory/40 bg-memory/10 px-3 py-1 text-xs font-medium text-memory">Completed</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs text-faint">Requested</dt><dd className="mt-1 text-ink">Codex · GPT-5.4 / medium</dd></div><div><dt className="text-xs text-faint">Actual evidence</dt><dd className="mt-1 text-ink">Model requested · unverified</dd></div><div><dt className="text-xs text-faint">Fallback</dt><dd className="mt-1 text-ink">Not used</dd></div><div><dt className="text-xs text-faint">Receipt</dt><dd className="mt-1 font-mono text-ink">DEMO-ROUTE-024</dd></div></dl>
      </section>
    </div>
  )
}

export function SampleUsageView() {
  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden rounded-sm p-5 sm:p-6" aria-labelledby="sample-usage-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="hud-label">Fictional Sample workspace</p><h2 id="sample-usage-title" className="mt-2 text-2xl font-semibold text-ink">Sample model usage</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-mut">Representative normalized usage for a 30-day period. It demonstrates coverage and attribution without running Tokscale or implying provider billing.</p></div>
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">Fictional · session-only</span>
        </div>
      </section>

      <section aria-label="Sample usage totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SampleMetric label="Total tokens" value="1.82m" detail="44 fictional sessions" />
        <SampleMetric label="Input tokens" value="1.18m" detail="Reported portion" />
        <SampleMetric label="Output tokens" value="412k" detail="Reported portion" />
        <SampleMetric label="Estimated cost" value="$18.42" detail="Not billing or quota data" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="panel rounded-sm p-5" aria-labelledby="sample-models-title">
          <div className="flex items-end justify-between gap-3"><div><p className="hud-label">Attribution</p><h3 id="sample-models-title" className="mt-1 text-lg font-semibold">Models used</h3></div><p className="text-xs text-faint">Last 30 days · sample</p></div>
          <div className="mt-4 space-y-4">{SAMPLE_USAGE_MODELS.map((model) => <div key={model.name}><div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium text-ink">{model.name}</span><span className="text-xs text-mut">{model.tokens} · {model.sessions} sessions · {model.cost}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-sync" style={{ width: model.share }} /></div></div>)}</div>
        </div>

        <div className="panel rounded-sm p-5" aria-labelledby="sample-coverage-title">
          <p className="hud-label">Coverage</p><h3 id="sample-coverage-title" className="mt-1 text-lg font-semibold">Partial, not complete</h3>
          <p className="mt-3 text-3xl font-mono font-bold text-ink">11 / 14</p><p className="mt-1 text-xs text-mut">recent days include observed records</p>
          <ul className="mt-5 space-y-3 text-sm"><CoverageLine label="Codex" value="Current" tone="text-memory" /><CoverageLine label="Claude Code" value="Partial" tone="text-amber-200" /><CoverageLine label="Pi" value="Current" tone="text-memory" /></ul>
          <p className="mt-5 border-t border-line pt-4 text-xs leading-5 text-faint">FindMnemo reports locally observed evidence. Missing days and unavailable attribution remain visible rather than being estimated.</p>
        </div>
      </section>

      <section className="panel rounded-sm p-5" aria-labelledby="sample-privacy-boundary"><p className="hud-label">Privacy boundary</p><h3 id="sample-privacy-boundary" className="mt-1 text-lg font-semibold">What this view never contains</h3><p className="mt-2 text-sm leading-6 text-mut">No prompts, responses, reasoning, credentials, raw logs, file contents, readable session identities, or workspace paths. The Sample workspace makes no companion or collector request.</p></section>
    </div>
  )
}

function SampleMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="panel rounded-sm p-4"><p className="hud-label">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-ink">{value}</p><p className="mt-1 text-xs text-mut">{detail}</p></article>
}

function CoverageLine({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <li className="flex items-center justify-between gap-3"><span className="text-mut">{label}</span><span className={`font-medium ${tone}`}>{value}</span></li>
}
