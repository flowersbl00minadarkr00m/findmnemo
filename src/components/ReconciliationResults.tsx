import type { ReconciliationRunDto } from '../../shared/companion-contract'

export function ReconciliationResults({ run, lastSuccess, error }: { run?: ReconciliationRunDto; lastSuccess?: string; error?: string }) {
  if (!run && !error) return null
  const gaps = run?.items.filter((item) => item.classification === 'duplicate' || item.classification === 'unresolved') ?? []
  return <div className="absolute top-14 right-4 max-h-[32%] max-w-[70%] overflow-y-auto rounded-sm border border-line bg-mist/95 px-3 py-2 text-xs break-words [overflow-wrap:anywhere]" aria-live="polite">
    {error ? <p role="alert" className="text-alert">MnemoSync failed to start or refresh: {error}</p> : <p className="text-ink">MnemoSync {run?.state}. {run?.startedAt ? `Last attempt ${new Date(run.startedAt).toLocaleString()}.` : ''} {lastSuccess ? `Last success ${new Date(lastSuccess).toLocaleString()}.` : 'No successful run yet.'}</p>}
    {gaps.length > 0 && <p className="mt-1 text-warn">{gaps.length} durable item gap{gaps.length === 1 ? '' : 's'}: {gaps.slice(0, 3).map((item) => `${item.sourceId}/${item.externalId} (${item.classification})`).join(', ')}</p>}
  </div>
}
