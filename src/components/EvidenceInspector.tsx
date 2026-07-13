import { useEffect, useRef, useState } from 'react'
import type { AttentionAction, AttentionItem, Ticket } from '../types'
import { attentionStateLabel } from '../lib/attention-labels'
import { ReceiptDispositionControls } from './ReceiptDispositionControls'

export function EvidenceInspector({
  item,
  ticket,
  onOpenTicket,
  onAction,
  drawer = false,
  onClose,
}: {
  item?: AttentionItem
  ticket?: Ticket
  onOpenTicket?: (ticketId: string) => void
  onAction?: (action: AttentionAction, item: AttentionItem) => Promise<void>
  drawer?: boolean
  onClose?: () => void
}) {
  const inspectorRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [pendingActionId, setPendingActionId] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  useEffect(() => {
    if (drawer && item) closeButtonRef.current?.focus()
  }, [drawer, item])
  if (!item) {
    return (
      <aside className="panel rounded-sm p-5" aria-label="Evidence inspector">
        <p className="hud-label">Evidence inspector</p>
        <p className="mt-5 text-sm text-mut">Select a queue item to inspect the evidence FindMnemo actually has.</p>
      </aside>
    )
  }

  const ticketId = item.kind === 'ticket' ? item.recordRef.slice('ticket:'.length) : undefined
  async function runAction(action: AttentionAction) {
    if (!item || !onAction || action.disabledReason || pendingActionId) return
    setPendingActionId(action.id)
    setActionError(undefined)
    try {
      await onAction(action, item)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Action failed.'
      setActionError(message === 'RECORD_CHANGED' ? 'The record changed. Refresh and review the newer state before retrying.' : message)
    } finally {
      setPendingActionId(undefined)
    }
  }
  return (
    <aside
      ref={inspectorRef}
      role={drawer ? 'dialog' : undefined}
      aria-modal={drawer ? true : undefined}
      tabIndex={drawer ? -1 : undefined}
      onKeyDown={(event) => {
        if (drawer && event.key === 'Escape') onClose?.()
        if (drawer && event.key === 'Tab' && inspectorRef.current) {
          const focusable = [...inspectorRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
          const first = focusable[0]
          const last = focusable.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }
      }}
      className={drawer ? 'panel fixed inset-x-3 bottom-3 top-3 z-50 overflow-y-auto rounded-sm p-5 shadow-2xl' : 'panel min-w-0 rounded-sm p-5'}
      aria-label={`Evidence for ${item.title}`}
    >
      {drawer && (
        <div className="mb-3 flex justify-end">
          <button ref={closeButtonRef} type="button" onClick={onClose} className="rounded-sm border border-line px-3 py-2 text-xs font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-sync">
            Close inspector
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="hud-label">Evidence inspector</p>
          <h2 className="mt-3 text-lg font-semibold text-ink">{item.title}</h2>
          <p className="mt-1 text-sm text-mut">{item.summary}</p>
        </div>
        <span className="rounded-sm border border-line px-2 py-1 font-mono text-[10px] uppercase text-mut">
          {attentionStateLabel(item.truthState)}
        </span>
      </div>

      <dl className="mt-5 grid gap-3 text-xs">
        <EvidenceRow label="Why prioritized" value={item.priorityReason} />
        <EvidenceRow label="Authoritative record" value={item.recordRef} />
        <EvidenceRow label="Evidence state" value={item.evidence.availability.replace('-', ' ')} />
        <EvidenceRow
          label="Rollback / reversibility"
          value={item.evidence.rollbackRefs?.length
            ? item.evidence.rollbackRefs.map((ref) => ref.value ?? ref.label).join(' · ')
            : 'Not available.'}
        />
      </dl>

      <section className="mt-5" aria-labelledby="available-evidence">
        <h3 id="available-evidence" className="text-xs font-semibold uppercase tracking-[0.1em] text-mut">Available evidence</h3>
        {item.evidence.refs.length === 0 && item.evidence.blockers.length === 0 && item.evidence.receiptIds.length === 0 && (item.evidence.rollbackRefs?.length ?? 0) === 0 ? (
          <p className="mt-2 rounded-sm border border-line bg-chrome/30 px-3 py-2 text-xs text-mut">
            {item.evidence.availability === 'required-missing' ? 'Required evidence is not linked.' : 'Not available.'}
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-xs text-mut">
            {item.evidence.refs.map((ref, index) => (
              <li key={`${ref.label}-${index}`} className="rounded-sm border border-line bg-chrome/30 px-3 py-2">
                <span className="font-semibold text-ink">{ref.label}</span>{ref.value ? `: ${ref.value}` : ''}
              </li>
            ))}
            {item.evidence.blockers.map((blocker) => (
              <li key={blocker.id} className="rounded-sm border border-line bg-chrome/30 px-3 py-2">
                Blocker {blocker.id}: <span className="font-semibold text-ink">{blocker.state}</span>
              </li>
            ))}
            {item.evidence.receiptIds.map((id) => <li key={id}>Receipt: {id}</li>)}
            {item.evidence.rollbackRefs?.map((ref, index) => (
              <li key={`${ref.label}-${index}`} className="rounded-sm border border-line bg-chrome/30 px-3 py-2">
                <span className="font-semibold text-ink">{ref.label}</span>{ref.value ? `: ${ref.value}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      {ticket && <div className="mt-5"><ReceiptDispositionControls ticket={ticket} /></div>}

      {actionError && <p role="alert" className="mt-4 rounded-sm border border-alert/40 bg-alert/10 px-3 py-2 text-xs text-alert">{actionError}</p>}

      {onAction && (
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Available actions">
          {[item.primaryAction, ...item.secondaryActions].map((availableAction, index) => (
            <button
              key={availableAction.id}
              type="button"
              disabled={Boolean(availableAction.disabledReason || pendingActionId)}
              title={availableAction.disabledReason}
              onClick={() => void runAction(availableAction)}
              className={index === 0 ? 'rounded-sm bg-sync px-3 py-2 text-xs font-semibold text-chrome disabled:opacity-45' : 'rounded-sm border border-line px-3 py-2 text-xs text-ink disabled:opacity-45'}
            >
              {pendingActionId === availableAction.id ? 'Working…' : availableAction.label}
            </button>
          ))}
        </div>
      )}

      {ticketId && onOpenTicket && !onAction && (
        <button type="button" onClick={() => onOpenTicket(ticketId)} className="mt-5 rounded-sm bg-sync px-3 py-2 text-xs font-semibold text-chrome hover:bg-memory">
          Open ticket detail
        </button>
      )}
    </aside>
  )
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-faint">{label}</dt><dd className="mt-0.5 break-words text-ink">{value}</dd></div>
}
