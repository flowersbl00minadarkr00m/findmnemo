import type { GmailCandidateDto, GmailCheckDto } from '../../shared/companion-contract'
import type { GmailSourceStatus } from '../lib/operational-repository'
import type { EmailThread } from '../types'
import type { Ticket } from '../types'
import { EmailCandidateCard } from './EmailCandidateCard'
import { EmailTicketChooser } from './EmailTicketChooser'
import { useEffect, useRef, useState } from 'react'

interface Props {
  emails?: EmailThread[]
  candidates?: GmailCandidateDto[]
  check?: GmailCheckDto
  sourceStatus?: GmailSourceStatus
  error?: string
  onRefresh: () => void
  onConnect?: () => void
  onDecision?: (candidate: GmailCandidateDto, action: 'confirm' | 'dismiss' | 'defer') => void
  tickets?: Ticket[]
  onAssociate?: (candidate: GmailCandidateDto, input: { mode: 'create'; ticket: Ticket } | { mode: 'link'; ticketId: string }, idempotencyKey: string) => Promise<void>
  loading: boolean
  sample?: boolean
  chooseThreadId?: string
  onChooseHandled?: () => void
}

const EMPTY_CANDIDATES: GmailCandidateDto[] = []

export function EmailPanel(props: Props) {
  const [choosing, setChoosing] = useState<GmailCandidateDto>()
  const chooserTrigger = useRef<HTMLElement | null>(null)
  const candidates = props.candidates ?? EMPTY_CANDIDATES
  const { chooseThreadId, emails, onAssociate, onChooseHandled, sample } = props
  useEffect(() => {
    if (sample || emails || !chooseThreadId || !onAssociate) return
    const candidate = candidates.find((item) => item.threadId === chooseThreadId && item.state === 'confirmed-untracked')
    if (!candidate) return
    setChoosing(candidate)
    onChooseHandled?.()
  }, [candidates, chooseThreadId, emails, onAssociate, onChooseHandled, sample])
  if (props.sample || props.emails) return <SampleEmailPanel {...props} emails={props.emails ?? []} />
  const active = candidates.filter((candidate) => candidate.state === 'candidate' || candidate.state === 'deferred')
  const state = props.check?.state ?? props.sourceStatus?.state ?? 'not-checked'
  const credentialCapability = props.sourceStatus?.credentialCapability
  const credentialUnavailable = credentialCapability !== undefined && credentialCapability.state !== 'available'
  const needsConnection = props.sourceStatus?.connected === false
    || (props.sourceStatus?.connected !== true && (
      props.sourceStatus?.errorCode === 'GMAIL_TOKEN_REVOKED'
      || props.error?.includes('GMAIL_TOKEN_REVOKED') === true
    ))

  return (
    <section className="space-y-4" aria-labelledby="gmail-candidates-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p id="gmail-candidates-heading" className="hud-label">Gmail response candidates</p>
          <p className="mt-1 text-xs text-mut">State: <strong className="text-ink">{state}</strong>. Decisions are stored locally by the companion.</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
            <span>Last attempt: {formatTime(props.sourceStatus?.lastAttemptAt)}</span>
            <span>Last success: {formatTime(props.sourceStatus?.lastSuccessAt)}</span>
            <span>Coverage: {formatCoverage(props.check ?? props.sourceStatus)}</span>
          </div>
        </div>
        <button type="button" onClick={needsConnection ? props.onConnect : props.onRefresh} disabled={props.loading || credentialUnavailable || (needsConnection && !props.onConnect)} className="rounded-sm bg-sync px-3 py-2 text-xs font-semibold text-chrome disabled:opacity-50">
          {props.loading
            ? needsConnection ? 'Opening Google consent...' : 'Checking Gmail...'
            : credentialUnavailable ? 'Credential store unavailable'
              : needsConnection ? 'Reconnect Gmail'
              : props.error || state === 'partial' || state === 'failed' ? 'Retry failed check' : 'Check Gmail'}
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {props.loading ? 'Gmail metadata check in progress.' : `Gmail candidate state ${state}. ${active.length} candidates require review.`}
      </p>
      {props.error && <div role="alert" className="rounded-sm border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-alert">Check failed: {props.error}. Prior candidate data remains visible.</div>}
      {needsConnection && <p className="text-xs text-mut">Google consent opens in your default browser. Return here after approving metadata-only Gmail access.</p>}
      {credentialUnavailable && <div role="alert" className="rounded-sm border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"><strong>{credentialCapability.code}:</strong> {credentialCapability.guidance} Gmail remains disconnected; tickets and other local sources are still available.</div>}
      {props.check?.state === 'partial' && <div className="rounded-sm border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">Partial coverage: {props.check.failedThreadIds.length} thread(s) could not be checked. Retry is safe and does not duplicate candidates.</div>}

      {candidates.length === 0 && !props.loading ? (
        <div className="panel rounded-sm p-8 text-center"><p className="text-sm text-mut">No Gmail candidates are stored.</p><p className="mt-1 text-xs text-faint">Connect Gmail and run a metadata check, or retry if the previous attempt failed.</p></div>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => <EmailCandidateCard key={`${candidate.accountId}:${candidate.threadId}`} candidate={candidate} onDecision={props.onDecision} onChooseTicket={(selected) => { chooserTrigger.current = document.activeElement as HTMLElement | null; setChoosing(selected) }} />)}
        </div>
      )}
      {choosing && props.onAssociate && <EmailTicketChooser candidate={choosing} tickets={props.tickets ?? []} onCancel={() => closeChooser(setChoosing, chooserTrigger)} onAssociate={async (input, key) => { await props.onAssociate?.(choosing, input, key); closeChooser(setChoosing, chooserTrigger) }} />}
    </section>
  )
}

function closeChooser(setChoosing: (candidate: GmailCandidateDto | undefined) => void, trigger: React.RefObject<HTMLElement | null>) {
  const returnTarget = trigger.current
  setChoosing(undefined)
  queueMicrotask(() => returnTarget?.focus())
}

function SampleEmailPanel({ emails, onRefresh, loading }: Props & { emails: EmailThread[] }) {
  const pending = emails.filter((email) => email.needsResponse)
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3"><div><p className="hud-label">Fictional sample inbox</p><p className="mt-1 text-[11px] text-faint">These messages never connect to Gmail or operational storage.</p></div><button type="button" onClick={onRefresh} disabled={loading} className="rounded-sm bg-sync px-3 py-2 text-xs font-semibold text-chrome disabled:opacity-50">Reset sample inbox</button></div>
      {pending.map((email) => <article key={email.id} className="panel rounded-sm p-4"><h3 className="text-sm font-medium text-ink">{email.subject}</h3><p className="mt-1 text-xs text-mut">{email.from}</p><p className="mt-2 text-xs text-mut">{email.snippet}</p><p className="mt-2 text-[10px] font-mono uppercase text-warn">Fictional · needs reply</p></article>)}
    </section>
  )
}

function formatTime(value?: string): string { return value ? new Date(value).toLocaleString() : 'never' }
function formatCoverage(value?: { coverageStart?: string; coverageEnd?: string }): string {
  if (!value?.coverageStart || !value.coverageEnd) return 'not checked'
  return `${new Date(value.coverageStart).toLocaleDateString()} to ${new Date(value.coverageEnd).toLocaleDateString()}`
}
