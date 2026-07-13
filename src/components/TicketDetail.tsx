import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { Ticket } from '../types'
import { STATUS_LABELS, SOURCE_COLORS, STATUS_ACCENTS } from '../types'
import { summarizeReview } from '../lib/workflow-intelligence'
import { SddGateTicketBadge } from './SddGateTicketBadge'
import { ReceiptDispositionControls } from './ReceiptDispositionControls'

interface Props {
  ticket: Ticket | null
  onClose: () => void
  onStatusChange: (id: string, status: Ticket['status']) => void
  onAddNote: (id: string, note: string) => void
  onRecommendRoute: (ticket: Ticket) => void
}

const REVERSIBILITY_LABEL: Record<string, string> = {
  high: 'easily reversed',
  medium: 'reversible with effort',
  low: 'hard to reverse',
}

const REVIEW_LABEL: Record<string, string> = {
  approved: 'Approved',
  'approved-with-follow-ups': 'Approved with follow-ups',
  'needs-fixes': 'Needs fixes',
}

export function TicketDetail({ ticket, onClose, onStatusChange, onAddNote, onRecommendRoute }: Props) {
  function handleAddNote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!ticket) return
    const input = e.currentTarget.elements.namedItem('note') as HTMLInputElement
    if (input.value.trim()) {
      onAddNote(ticket.id, input.value.trim())
      input.value = ''
    }
  }

  return (
    <AnimatePresence>
      {ticket && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-40 bg-chrome/60 backdrop-blur-sm flex items-start justify-center pt-[8vh] px-4 pb-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="panel w-full max-w-2xl max-h-[82vh] overflow-y-auto rounded-sm bg-paper"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-paper/95 backdrop-blur border-b border-line px-5 py-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className={`${SOURCE_COLORS[ticket.source]} text-[10px] font-mono px-2 py-0.5 rounded-sm text-white`}>
                    {ticket.source === 'Claude Cowork' ? 'Claude' : ticket.source}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-mut">
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_ACCENTS[ticket.status]}`} />
                    {STATUS_LABELS[ticket.status]}
                  </span>
                  <span className="text-[10px] font-mono text-faint">
                    opened {shortDate(ticket.createdAt)} / updated {timeAgo(ticket.updatedAt)}
                  </span>
                  <SddGateTicketBadge ticket={ticket} />
                </div>
                <h2 className="text-base font-semibold text-ink leading-snug">{ticket.title}</h2>
              </div>
              <button
                onClick={onClose}
                className="text-faint hover:text-ink text-lg leading-none px-1 shrink-0 transition-colors"
                title="Close"
              >
                x
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {ticket.description && (
                <p className="text-sm text-mut leading-relaxed">{ticket.description}</p>
              )}

              <ReadinessMetadata ticket={ticket} />
              <FogMapSection ticket={ticket} />
              <ExecutionEvidenceSection ticket={ticket} />
              <ExpandContractSection ticket={ticket} />
              <ReviewSection ticket={ticket} />
              <ReceiptDispositionControls ticket={ticket} />

              <section>
                <p className="hud-label mb-2">Decision log / {ticket.decisionLog.length}</p>
                {ticket.decisionLog.length === 0 ? (
                  <p className="text-xs text-faint">No decisions recorded on this ticket yet.</p>
                ) : (
                  <div className="space-y-2">
                    {ticket.decisionLog.map((d) => (
                      <div key={d.id} className="border border-line rounded-sm px-3 py-2.5 bg-mist/50">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {d.kind && <WorkflowTag>{kindLabel(d.kind)}</WorkflowTag>}
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm border ${
                            d.gateType === 'one-way'
                              ? 'text-alert border-red-300 bg-red-50'
                              : 'text-ok border-emerald-300 bg-emerald-50'
                          }`}>
                            {d.gateType === 'one-way' ? 'one-way gate' : 'two-way gate'}
                          </span>
                          <span className="text-[10px] font-mono text-mut">
                            {REVERSIBILITY_LABEL[d.reversibility]}
                          </span>
                          <span className="text-[10px] font-mono text-faint ml-auto">{shortDate(d.timestamp)}</span>
                        </div>
                        <p className="text-sm text-ink font-medium">{d.decision}</p>
                        {d.reasoning && (
                          <p className="text-xs text-mut mt-1 leading-relaxed">{d.reasoning}</p>
                        )}
                        {d.evidenceRefs && d.evidenceRefs.length > 0 && (
                          <p className="text-[10px] font-mono text-faint mt-1">Evidence: {d.evidenceRefs.join(', ')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <p className="hud-label mb-2">Work notes / {ticket.workNotes.length}</p>
                {ticket.workNotes.length === 0 ? (
                  <p className="text-xs text-faint">No notes yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {ticket.workNotes.map((n) => (
                      <div key={n.id} className="text-xs text-mut bg-mist/50 border border-line/60 rounded-sm px-3 py-2 leading-relaxed">
                        {n.kind && <WorkflowTag>{kindLabel(n.kind)}</WorkflowTag>}
                        <span className={n.kind ? 'block mt-1' : ''}>{n.text}</span>
                        <span className="block text-[10px] font-mono text-faint mt-0.5">{shortDate(n.createdAt)}</span>
                        {n.evidenceRefs && n.evidenceRefs.length > 0 && (
                          <span className="block text-[10px] font-mono text-faint mt-0.5">Evidence: {n.evidenceRefs.join(', ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {ticket.artifacts.length > 0 && (
                <section>
                  <p className="hud-label mb-2">Artifacts / {ticket.artifacts.length}</p>
                  <div className="space-y-1">
                    {ticket.artifacts.map((a) => (
                      <a
                        key={a.id}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-sync hover:text-memory truncate"
                      >
                        <span className="text-faint font-mono">{a.type}:</span> {a.label}
                        {a.status && a.status !== 'available' && (
                          <span className="ml-2 text-[10px] font-mono text-warn">{a.status}</span>
                        )}
                      </a>
                    ))}
                  </div>
                </section>
              )}

              <section className="border-t border-line pt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRecommendRoute(ticket)}
                  className="rounded-sm border border-sync/50 bg-sync/10 px-2.5 py-1.5 text-xs font-medium text-sync transition-colors hover:bg-sync/20"
                >
                  Recommend route
                </button>
                <select
                  value={ticket.status}
                  onChange={(e) => onStatusChange(ticket.id, e.target.value as Ticket['status'])}
                  className="text-xs bg-mist/70 border border-line rounded-sm px-2 py-1.5 text-ink focus:outline-none focus:border-sync"
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <form onSubmit={handleAddNote} className="flex flex-1 min-w-48 gap-1">
                  <input
                    name="note"
                    placeholder="Add note..."
                    className="flex-1 min-w-0 text-xs bg-mist/70 border border-line rounded-sm px-2 py-1.5 text-ink placeholder-faint focus:outline-none focus:border-sync"
                  />
                  <button type="submit" className="text-xs text-mut bg-mist hover:bg-line/60 border border-line rounded-sm px-2.5 transition-colors">
                    +
                  </button>
                </form>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ReadinessMetadata({ ticket }: { ticket: Ticket }) {
  const hasCriteria = (ticket.acceptanceCriteria?.length ?? 0) > 0
  const hasChecks = (ticket.verificationChecks?.length ?? 0) > 0
  const hasBlockers = (ticket.blockedBy?.length ?? 0) > 0
  const show = Boolean(ticket.delivers || hasCriteria || hasChecks || hasBlockers || ticket.generatedKind || ticket.sddGate || ticket.receiptRequired)
  if (!show) return null

  return (
    <section className="border border-line rounded-sm bg-mist/40 px-3 py-3">
      <p className="hud-label mb-2">Readiness metadata</p>
      <div className="space-y-3">
        {ticket.delivers && <FieldBlock label="Delivers">{ticket.delivers}</FieldBlock>}
        {hasBlockers && (
          <div>
            <SubLabel>Blockers</SubLabel>
            <div className="flex flex-wrap gap-1.5">
              {ticket.blockedBy?.map((id) => <WorkflowTag key={id}>{id}</WorkflowTag>)}
            </div>
          </div>
        )}
        {hasCriteria && <Checklist title="Acceptance criteria" items={ticket.acceptanceCriteria ?? []} />}
        {hasChecks && <VerificationList title="Verification checks" checks={ticket.verificationChecks ?? []} />}
        {(ticket.generatedKind || ticket.sddGate || ticket.receiptRequired) && (
          <div className="flex flex-wrap gap-1.5">
            {ticket.generatedKind && <WorkflowTag>{ticket.generatedKind}</WorkflowTag>}
            {ticket.sddGate && <WorkflowTag>{ticket.sddGate}</WorkflowTag>}
            {ticket.receiptRequired && <WorkflowTag>receipt required</WorkflowTag>}
          </div>
        )}
      </div>
    </section>
  )
}

function FogMapSection({ ticket }: { ticket: Ticket }) {
  const fogMap = ticket.fogMap
  if (!fogMap) return null

  return (
    <section className="border border-line rounded-sm bg-mist/40 px-3 py-3">
      <p className="hud-label mb-2">Fog map</p>
      <div className="space-y-3">
        {fogMap.destination && <FieldBlock label="Destination">{fogMap.destination}</FieldBlock>}
        {fogMap.decisionsSoFar.length > 0 && <BulletList title="Decisions so far" items={fogMap.decisionsSoFar} />}
        {fogMap.items.length > 0 && (
          <div>
            <SubLabel>Open map items</SubLabel>
            <div className="space-y-1.5">
              {fogMap.items.map((item) => (
                <div key={item.id} className="border border-line/60 rounded-sm bg-paper/50 px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <WorkflowTag>{item.type}</WorkflowTag>
                    <WorkflowTag>{item.state}</WorkflowTag>
                    {item.blockedBy?.map((id) => <WorkflowTag key={id}>blocked by {id}</WorkflowTag>)}
                  </div>
                  <p className="text-xs text-mut leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {fogMap.outOfScope.length > 0 && <BulletList title="Out of scope" items={fogMap.outOfScope} />}
      </div>
    </section>
  )
}

function ExecutionEvidenceSection({ ticket }: { ticket: Ticket }) {
  const evidence = ticket.executionEvidence
  if (!evidence) return null

  const checks = [
    evidence.firstFailingCheck,
    evidence.passingCheck,
    evidence.finalVerification,
  ].filter((check): check is NonNullable<typeof check> => Boolean(check))

  return (
    <section className="border border-line rounded-sm bg-mist/40 px-3 py-3">
      <p className="hud-label mb-2">Execution evidence</p>
      <div className="space-y-3">
        {evidence.testSeam && <FieldBlock label="Test seam">{evidence.testSeam}</FieldBlock>}
        <VerificationList title="Red / green / final checks" checks={checks} />
        {evidence.refactorNote && <FieldBlock label="Refactor note">{evidence.refactorNote}</FieldBlock>}
      </div>
    </section>
  )
}

function ExpandContractSection({ ticket }: { ticket: Ticket }) {
  const plan = ticket.expandContractPlan
  if (!plan) return null

  return (
    <section className="border border-line rounded-sm bg-mist/40 px-3 py-3">
      <p className="hud-label mb-2">Expand-contract plan</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <PhaseList title="Expand" phases={plan.expand} />
        <PhaseList title="Migrate" phases={plan.migrate} />
        <PhaseList title="Contract" phases={plan.contract} />
      </div>
    </section>
  )
}

function ReviewSection({ ticket }: { ticket: Ticket }) {
  const review = ticket.review
  if (!review) return null

  return (
    <section className="border border-line rounded-sm bg-mist/40 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <p className="hud-label">Review</p>
        <WorkflowTag>overall: {REVIEW_LABEL[summarizeReview(review)]}</WorkflowTag>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ReviewAxis title="Spec" axis={review.spec} />
        <ReviewAxis title="Standards" axis={review.standards} />
      </div>
      {(review.reviewedAt || review.reviewer) && (
        <p className="text-[10px] font-mono text-faint mt-2">
          {review.reviewer ? `Reviewed by ${review.reviewer}` : 'Reviewed'}{review.reviewedAt ? ` on ${shortDate(review.reviewedAt)}` : ''}
        </p>
      )}
    </section>
  )
}

function ReviewAxis({ title, axis }: { title: string; axis: NonNullable<Ticket['review']>['spec'] }) {
  return (
    <div className="border border-line/60 rounded-sm bg-paper/50 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <SubLabel>{title}</SubLabel>
        <WorkflowTag>{REVIEW_LABEL[axis.verdict]}</WorkflowTag>
      </div>
      {axis.findings.length === 0 ? (
        <p className="text-xs text-faint">No findings recorded.</p>
      ) : (
        <div className="space-y-1.5">
          {axis.findings.map((finding) => (
            <div key={finding.id} className="text-xs text-mut leading-relaxed">
              <span className="font-mono text-faint">{finding.severity}:</span> {finding.message}
              {finding.smellTags && finding.smellTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {finding.smellTags.map((tag) => <WorkflowTag key={tag}>smell: {tag}</WorkflowTag>)}
                </div>
              )}
              {finding.refs && finding.refs.length > 0 && (
                <p className="text-[10px] font-mono text-faint mt-0.5">Refs: {finding.refs.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Checklist({ title, items }: { title: string; items: NonNullable<Ticket['acceptanceCriteria']> }) {
  return (
    <div>
      <SubLabel>{title}</SubLabel>
      <div className="space-y-1">
        {items.map((item) => (
          <p key={item.id} className="text-xs text-mut leading-relaxed">
            <span className="font-mono text-faint">{item.checked ? '[x]' : '[ ]'}</span> {item.text}
          </p>
        ))}
      </div>
    </div>
  )
}

function VerificationList({ title, checks }: { title: string; checks: NonNullable<Ticket['verificationChecks']> }) {
  if (checks.length === 0) return null
  return (
    <div>
      <SubLabel>{title}</SubLabel>
      <div className="space-y-1.5">
        {checks.map((check) => (
          <div key={check.id} className="text-xs text-mut border border-line/60 rounded-sm bg-paper/50 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-ink">{check.commandOrCheck}</span>
              {check.result && <WorkflowTag>{check.result}</WorkflowTag>}
            </div>
            {check.expected && <p className="text-[11px] text-faint mt-1">Expected: {check.expected}</p>}
            {check.evidenceRef && <p className="text-[10px] font-mono text-faint mt-1">Evidence: {check.evidenceRef}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

function PhaseList({ title, phases }: { title: string; phases: NonNullable<Ticket['expandContractPlan']>['expand'] }) {
  return (
    <div className="border border-line/60 rounded-sm bg-paper/50 px-2.5 py-2">
      <SubLabel>{title}</SubLabel>
      {phases.length === 0 ? (
        <p className="text-xs text-faint">No phases recorded.</p>
      ) : (
        <div className="space-y-1.5">
          {phases.map((phase) => (
            <div key={phase.id}>
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs text-ink">{phase.label}</p>
                <WorkflowTag>{phase.status}</WorkflowTag>
              </div>
              {phase.verificationChecks && phase.verificationChecks.length > 0 && (
                <p className="text-[10px] font-mono text-faint">{phase.verificationChecks.length} checks</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BulletList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <SubLabel>{title}</SubLabel>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="text-xs text-mut leading-relaxed">- {item}</li>
        ))}
      </ul>
    </div>
  )
}

function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <SubLabel>{label}</SubLabel>
      <p className="text-sm text-ink leading-relaxed">{children}</p>
    </div>
  )
}

function SubLabel({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-mono uppercase text-faint mb-1">{children}</p>
}

function WorkflowTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-sm border border-line bg-paper/70 px-1.5 py-0.5 text-[10px] font-mono text-mut">
      {children}
    </span>
  )
}

function kindLabel(kind: string): string {
  return kind.replace(/-/g, ' ')
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
