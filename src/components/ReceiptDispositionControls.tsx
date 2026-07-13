import { useState, type ReactNode } from 'react'
import type { HumanReceiptDisposition, Ticket } from '../types'
import { buildHumanActivityEvent } from '../lib/human-activity'
import { appendTelemetry } from '../lib/telemetry'

export type ReceiptDispositionWriter = (
  receiptId: string,
  disposition: HumanReceiptDisposition,
) => Promise<{ ok: boolean; error?: string }>

export function ReceiptDispositionControls({
  ticket,
  updateDisposition = defaultDispositionWriter,
}: {
  ticket: Ticket
  updateDisposition?: ReceiptDispositionWriter
}) {
  const [lastRecorded, setLastRecorded] = useState<{
    label: string
    remoteState: 'local-only' | 'saving' | 'saved' | 'failed'
    error?: string
  } | null>(null)
  const receiptIds = ticket.receiptIds ?? []
  const primaryReceiptId = receiptIds[0]
  const show = ticket.receiptRequired || receiptIds.length > 0
  if (!show) return null

  async function recordDisposition(
    activity: 'human-verified-artifact' | 'human-accepted-ai-receipt' | 'human-rejected-output',
    label: string,
    humanDisposition?: HumanReceiptDisposition,
  ) {
    const event = buildHumanActivityEvent({
      activity,
      ticketId: ticket.id,
      projectProgressId: ticket.projectProgressId,
      ...(primaryReceiptId ? { receiptId: primaryReceiptId } : {}),
      note: `${label} from FindMnemo evidence review.`,
      artifactRefs: ticket.artifacts.map((artifact) => ({ label: artifact.label, ref: artifact.url ?? artifact.id })),
    })
    appendTelemetry(event)
    setLastRecorded({ label, remoteState: humanDisposition ? 'saving' : 'local-only' })

    if (!humanDisposition || !primaryReceiptId) return
    const result = await updateDisposition(primaryReceiptId, humanDisposition)
    setLastRecorded({
      label,
      remoteState: result.ok ? 'saved' : 'failed',
      ...(result.error ? { error: result.error } : {}),
    })
  }

  return (
    <section className="rounded-sm border border-line bg-mist/40 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="hud-label mb-1">Human receipt disposition</p>
          <p className="text-xs text-mut">
            {primaryReceiptId ? `Linked receipt: ${primaryReceiptId}` : 'Receipt required; no AI receipt is linked yet.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <DispositionButton onClick={() => void recordDisposition('human-verified-artifact', 'Verified evidence')}>Verify</DispositionButton>
          <DispositionButton disabled={!primaryReceiptId} onClick={() => void recordDisposition('human-accepted-ai-receipt', 'Accepted AI receipt', 'accepted')}>Accept</DispositionButton>
          <DispositionButton disabled={!primaryReceiptId} onClick={() => void recordDisposition('human-rejected-output', 'Rejected AI receipt', 'rejected')}>Reject</DispositionButton>
        </div>
      </div>
      {lastRecorded && (
        <p role="status" className={`mt-2 text-[10px] font-mono ${lastRecorded.remoteState === 'failed' ? 'text-warn' : 'text-ok'}`}>
          Recorded: {lastRecorded.label}
          {lastRecorded.remoteState === 'saved' && ' / Supabase disposition saved'}
          {lastRecorded.remoteState === 'saving' && ' / saving Supabase disposition...'}
          {lastRecorded.remoteState === 'local-only' && ' / local telemetry only'}
          {lastRecorded.remoteState === 'failed' && ` / Supabase update failed: ${lastRecorded.error ?? 'unknown error'}`}
        </p>
      )}
    </section>
  )
}

async function defaultDispositionWriter(receiptId: string, disposition: HumanReceiptDisposition) {
  const { updateAiReceiptHumanDisposition } = await import('../lib/supabase')
  return updateAiReceiptHumanDisposition(receiptId, disposition)
}

function DispositionButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="rounded-sm border border-line bg-paper/70 px-2 py-1 text-[10px] font-mono text-mut transition-colors hover:border-sync/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45">
      {children}
    </button>
  )
}
