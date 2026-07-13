import type { ReconciliationRunDto, SourceDescriptor, SourceId } from '../../shared/companion-contract'

export function SourceCoverage({ run, sources, onRetry }: { run?: ReconciliationRunDto; sources: SourceDescriptor[]; onRetry?: (sourceId: SourceId) => void }) {
  if (!run && sources.length === 0) return null
  const rows = sources.map((descriptor) => ({ descriptor, result: run?.sources.find((source) => source.sourceId === descriptor.id) }))
  return (
    <section className="absolute inset-x-4 bottom-4 max-h-[44%] overflow-y-auto rounded-sm border border-line bg-mist/95 p-3 text-xs" aria-label="MnemoSync source coverage">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(({ descriptor, result }) => {
          const retryable = result && (result.state === 'failed' || result.state === 'unavailable' || result.unresolved > 0 || result.duplicate > 0)
          return <div key={descriptor.id} className="rounded-sm border border-line px-3 py-2">
            <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ink">{descriptor.label}</span><span className="font-mono text-faint">{result?.state ?? (descriptor.enabled ? 'not checked' : 'disabled')}</span></div>
            {result && <p className="mt-1 text-faint">{result.checked} checked · {result.added} added · {result.updated} updated · {result.unchanged} unchanged · {result.excluded} excluded · {result.duplicate} duplicate · {result.unresolved} unresolved</p>}
            {retryable && onRetry && <button type="button" onClick={() => onRetry(descriptor.id)} className="mt-2 text-sync underline">Retry this source</button>}
          </div>
        })}
      </div>
    </section>
  )
}
