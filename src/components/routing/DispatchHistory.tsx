import { useCallback, useEffect, useState } from 'react'
import type { RoutingDispatchReceiptDto } from '../../../shared/companion-contract'
import type { OperationalRepository } from '../../lib/operational-repository'

interface Props { operationalRepository?: OperationalRepository }

function routeLabel(route: RoutingDispatchReceiptDto['requestedProfileSnapshot'] | RoutingDispatchReceiptDto['actualRoute']): string {
  if (!route) return 'Not reported'
  return `${route.providerId ?? route.destinationAdapterId} / ${route.modelId}${route.effort ? ` / ${route.effort}` : ''}`
}

function routesDiffer(receipt: RoutingDispatchReceiptDto): boolean {
  const actual = receipt.actualRoute
  const requested = receipt.requestedProfileSnapshot
  return Boolean(actual && (actual.destinationAdapterId !== requested.destinationAdapterId || actual.destinationInstanceId !== requested.destinationInstanceId || actual.providerId !== requested.providerId || actual.modelId !== requested.modelId || actual.effort !== requested.effort))
}

function returnExplanation(receipt: RoutingDispatchReceiptDto): string {
  if (receipt.returnState === 'delivered') return 'Delivered to the originating chat tool call.'
  if (receipt.returnState === 'pending') return receipt.state === 'completed'
    ? 'Destination completed; delivery acknowledgement is still pending. The active originating call may still hold the result.'
    : 'No result has been delivered yet.'
  return receipt.state === 'completed'
    ? 'The destination completed, but the originating chat could not receive it. Result content is not persisted and may be unavailable after companion restart.'
    : 'No result was delivered. Review the failure state before retrying.'
}

export function DispatchHistory({ operationalRepository }: Props) {
  const [receipts, setReceipts] = useState<RoutingDispatchReceiptDto[]>([])
  const [loading, setLoading] = useState(Boolean(operationalRepository?.listRoutingDispatchReceipts))
  const [message, setMessage] = useState<string>()

  const refresh = useCallback(async () => {
    if (!operationalRepository?.listRoutingDispatchReceipts) return
    setLoading(true)
    try { setReceipts(await operationalRepository.listRoutingDispatchReceipts()); setMessage(undefined) }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Dispatch history is unavailable.') }
    finally { setLoading(false) }
  }, [operationalRepository])

  useEffect(() => { void refresh() }, [refresh])

  async function cancel(receipt: RoutingDispatchReceiptDto) {
    if (!operationalRepository?.cancelRoutingDispatch) return
    try {
      await operationalRepository.cancelRoutingDispatch(receipt.id)
      setMessage('Cancellation requested. The receipt will remain truthful if the destination had already finished.')
      await refresh()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Cancellation was not accepted.') }
  }

  async function retry(receipt: RoutingDispatchReceiptDto) {
    if (!operationalRepository?.retryRoutingDispatch) return
    try {
      const next = await operationalRepository.retryRoutingDispatch(receipt.id, crypto.randomUUID())
      setMessage(`Started retry generation ${next.generation}, linked to generation ${receipt.generation}.`)
      await refresh()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The original task is no longer in companion memory. Retry from the originating chat.')
    }
  }

  if (!operationalRepository?.listRoutingDispatchReceipts) return null

  return (
    <section className="panel min-w-0 rounded-sm border border-chrome-line p-4 sm:p-5" aria-labelledby="dispatch-history-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="dispatch-history-heading" className="text-lg font-semibold text-chrome-ink">Dispatch history</h2><p className="mt-1 text-xs text-chrome-mut">Routing metadata only. Prompts, responses, credentials, raw logs, and private paths are never rendered here.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-10 rounded-sm border border-chrome-line px-3 py-2 text-xs text-chrome-mut disabled:opacity-40">{loading ? 'Refreshing...' : 'Refresh history'}</button>
      </div>
      {message && <p className="mt-3 rounded-sm border border-memory/40 bg-memory/5 p-3 text-xs text-memory" role="status" aria-live="polite">{message}</p>}
      {!loading && receipts.length === 0 && <p className="mt-4 rounded-sm border border-chrome-line bg-chrome/40 p-4 text-sm text-chrome-mut">No dispatch receipts yet. Recommendations do not create execution receipts.</p>}
      <ol className="mt-4 space-y-3">
        {receipts.map((receipt) => {
          const canCancel = ['requested', 'accepted', 'running'].includes(receipt.state)
          const canRetry = ['failed', 'timed-out', 'cancelled'].includes(receipt.state)
          const mismatch = routesDiffer(receipt)
          return (
            <li key={receipt.id} className="min-w-0 rounded-sm border border-chrome-line bg-chrome/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="text-sm font-semibold text-chrome-ink">{receipt.origin.adapterId} · generation {receipt.generation}</p><p className="mt-1 break-all text-[10px] font-mono text-chrome-mut">Receipt {receipt.id}</p></div>
                <span className="rounded-sm border border-chrome-line px-2 py-1 text-[10px] font-mono uppercase text-chrome-ink">{receipt.state}</span>
              </div>
              <dl className="mt-3 grid min-w-0 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <div className="min-w-0"><dt className="text-chrome-mut">Requested route</dt><dd className="break-words text-chrome-ink">{routeLabel(receipt.requestedProfileSnapshot)}</dd></div>
                <div className="min-w-0"><dt className="text-chrome-mut">Actual route</dt><dd className={mismatch ? 'break-words text-rose-300' : 'break-words text-chrome-ink'}>{routeLabel(receipt.actualRoute)}{mismatch ? ' — mismatch' : ''}</dd></div>
                <div><dt className="text-chrome-mut">Capability basis</dt><dd className="break-words text-chrome-ink">{receipt.capabilityIds.join(', ') || 'None'} · {receipt.classificationSource}</dd></div>
                <div><dt className="text-chrome-mut">Policy</dt><dd className="text-chrome-ink">Version {receipt.policyVersion}</dd></div>
                <div><dt className="text-chrome-mut">Created</dt><dd className="text-chrome-ink">{new Date(receipt.createdAt).toLocaleString()}</dd></div>
                <div><dt className="text-chrome-mut">Failure</dt><dd className="break-words text-chrome-ink">{receipt.failureCode ?? 'None reported'}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-chrome-mut"><strong className="text-chrome-ink">Return:</strong> {returnExplanation(receipt)}</p>
              {receipt.priorReceiptId && <p className="mt-1 break-all text-[10px] text-chrome-mut">Retry of {receipt.priorReceiptId}</p>}
              {(canCancel || canRetry) && <div className="mt-3 flex flex-wrap gap-2">{canCancel && <button type="button" onClick={() => void cancel(receipt)} className="min-h-10 rounded-sm border border-rose-400/50 px-3 py-2 text-xs text-rose-300">Cancel dispatch</button>}{canRetry && <button type="button" onClick={() => void retry(receipt)} className="min-h-10 rounded-sm border border-memory/50 px-3 py-2 text-xs text-memory">Retry as new generation</button>}</div>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
