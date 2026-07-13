import type { CompanionReasonCode, GmailCandidateDto } from '../../shared/companion-contract'

const REASON_COPY: Partial<Record<CompanionReasonCode, string>> = {
  LATEST_FROM_OTHER: 'The latest meaningful message is from someone else.',
  NO_LATER_SELF_REPLY: 'No later reply from one of your configured addresses was found.',
  NOT_AUTOMATED: 'The message does not match the automated or bulk-mail rules.',
  LATEST_FROM_SELF: 'Your address sent the latest meaningful message.',
  AUTOMATED_MESSAGE: 'The message looks automated, bulk, or list-generated.',
  ALREADY_DISMISSED: 'You previously dismissed this thread.',
  ALREADY_LINKED: 'This thread is already linked to a ticket.',
  DRAFT_SPAM_OR_TRASH: 'Only draft, spam, or trash messages were found.',
}

interface Props {
  candidate: GmailCandidateDto
  onDecision?: (candidate: GmailCandidateDto, action: 'confirm' | 'dismiss' | 'defer') => void
  onChooseTicket?: (candidate: GmailCandidateDto) => void
}

export function EmailCandidateCard({ candidate, onDecision, onChooseTicket }: Props) {
  const actionable = candidate.state === 'candidate' || candidate.state === 'deferred'
  return (
    <article className="panel rounded-sm p-4" aria-labelledby={`email-${candidate.threadId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={`email-${candidate.threadId}`} className="text-sm font-semibold text-ink">{candidate.subject}</h3>
          <p className="mt-1 text-xs text-mut">From {candidate.sender} · {new Date(candidate.receivedAt).toLocaleString()}</p>
          <p className="mt-2 text-xs leading-5 text-mut">{candidate.snippet}</p>
        </div>
        <span className="rounded-sm border border-line px-2 py-1 text-[10px] font-mono uppercase text-ink">State: {candidate.state}</span>
      </div>
      <div className="mt-3" aria-label="Why this thread was classified">
        <p className="hud-label">Why</p>
        <ul className="mt-1 space-y-1 text-xs text-faint">{candidate.reasonCodes.map((reason) => <li key={reason}>{REASON_COPY[reason] ?? reason}</li>)}</ul>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {actionable && <>
          <button type="button" onClick={() => onDecision?.(candidate, 'confirm')} className="rounded-sm bg-sync px-3 py-1.5 text-xs font-semibold text-chrome">Confirm</button>
          <button type="button" onClick={() => onDecision?.(candidate, 'defer')} className="rounded-sm border border-line px-3 py-1.5 text-xs text-ink">Defer</button>
          <button type="button" onClick={() => onDecision?.(candidate, 'dismiss')} className="rounded-sm border border-alert/40 px-3 py-1.5 text-xs text-alert">Dismiss</button>
        </>}
        {candidate.state === 'confirmed-untracked' && <button type="button" onClick={() => onChooseTicket?.(candidate)} className="rounded-sm bg-sync px-3 py-1.5 text-xs font-semibold text-chrome">Create or link ticket</button>}
        <a href={candidate.gmailUrl} target="_blank" rel="noopener noreferrer" className="rounded-sm border border-memory/50 px-3 py-1.5 text-xs text-memory">Open in Gmail</a>
      </div>
    </article>
  )
}
