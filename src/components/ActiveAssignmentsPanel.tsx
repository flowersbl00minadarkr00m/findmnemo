import { useEffect, useRef, useState } from 'react'
import type {
  AgentActivityAssignmentSummaryDto,
  AgentActivityAssignmentUpdateDto,
  AgentActivityIntegrationDto,
  ProjectFolderSummaryDto,
} from '../../shared/companion-contract'

const STATE_ICON: Record<AgentActivityAssignmentSummaryDto['effectiveState'], string> = {
  active: '▶', waiting: '◷', blocked: '!', 'needs-action': '!', completed: '✓', failed: '×', cancelled: '–', stale: '◌',
}

export function ActiveAssignmentsPanel({
  assignments,
  projects,
  integrations,
  onUpdate,
  onLoadMore,
  hasMore = false,
  loading = false,
  error,
  onOpenPrivacy,
}: {
  assignments: readonly AgentActivityAssignmentSummaryDto[]
  projects: readonly ProjectFolderSummaryDto[]
  integrations: readonly AgentActivityIntegrationDto[]
  onUpdate?: (assignmentId: string, input: AgentActivityAssignmentUpdateDto) => Promise<AgentActivityAssignmentSummaryDto>
  onLoadMore?: () => void
  hasMore?: boolean
  loading?: boolean
  error?: string
  onOpenPrivacy?: () => void
}) {
  const [editingId, setEditingId] = useState<string>()
  const [summaryDraft, setSummaryDraft] = useState('')
  const [busyId, setBusyId] = useState<string>()
  const [confirmCloseId, setConfirmCloseId] = useState<string>()
  const [receipt, setReceipt] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const receiptRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => { if (receipt) receiptRef.current?.focus() }, [receipt])

  async function update(record: AgentActivityAssignmentSummaryDto, change: Omit<AgentActivityAssignmentUpdateDto, 'expectedVersion'>, message: string) {
    if (!onUpdate || busyId) return
    setBusyId(record.id); setActionError(undefined); setReceipt(undefined)
    try {
      await onUpdate(record.id, { expectedVersion: record.recordVersion, ...change })
      setReceipt(message); setEditingId(undefined); setConfirmCloseId(undefined)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The assignment could not be updated.')
    } finally { setBusyId(undefined) }
  }

  const emptyMessage = integrations.every((item) => !item.configured || !item.enabled)
    ? 'Agent tracking is not connected. Set it up in Data & Privacy to observe current work.'
    : integrations.some((item) => item.coverageState === 'stale' || item.coverageState === 'unavailable')
      ? 'Coverage is stale or unavailable. Last successful states remain visible; review agent tracking to recover.'
      : 'No active observed assignments in the current coverage window. This does not prove that no agent work exists.'

  return (
    <section aria-label="Active agent assignments" className="panel min-w-0 max-w-full overflow-hidden rounded-sm p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="hud-label">Current work</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">Active agent assignments</h2>
          <p className="mt-1 text-sm text-mut">One card per assignment. Silence becomes stale, never completed.</p>
        </div>
        {onOpenPrivacy && <button type="button" onClick={onOpenPrivacy} className="rounded-sm border border-line px-3 py-2 text-xs">Manage tracking</button>}
      </div>

      {(error || actionError) && <p role="alert" className="mt-3 rounded-sm border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">{actionError ?? error}</p>}
      {receipt && <p ref={receiptRef} tabIndex={-1} role="status" className="mt-3 rounded-sm border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok outline-none">{receipt}</p>}
      {loading && assignments.length === 0 && <p role="status" className="mt-4 text-sm text-mut">Loading active assignments…</p>}
      {!loading && assignments.length === 0 && <p className="mt-4 rounded-sm border border-dashed border-line p-4 text-sm text-mut">{emptyMessage}</p>}

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        {assignments.map((record) => {
          const busy = busyId === record.id
          const projectValue = record.project.kind === 'approved-project' ? record.project.id : record.project.kind === 'unassigned' ? '__unassigned' : '__review'
          return (
            <article key={record.id} className="min-w-0 max-w-full rounded-sm border border-line bg-paper/70 p-4" aria-labelledby={`assignment-${record.id}`}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 id={`assignment-${record.id}`} className="break-words font-semibold text-ink">{record.summary}</h3>
                  <p className="mt-1 text-xs text-mut">{record.agentLabel} · {projectLabel(record)}</p>
                </div>
                <span className="inline-flex w-fit items-center gap-1 rounded-sm border border-line px-2 py-1 text-xs font-medium text-ink" aria-label={`Assignment state: ${stateText(record)}`}>
                  <span aria-hidden="true">{STATE_ICON[record.effectiveState]}</span>{stateText(record)}
                </span>
              </div>
              <dl className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-faint">Last observed</dt><dd className="break-words text-mut">{new Date(record.lastObservedAt).toLocaleString()}</dd></div>
                <div><dt className="text-faint">Update policy</dt><dd className="capitalize text-mut">{record.sourceUpdatePolicy}</dd></div>
                {record.terminalEvidence && <div><dt className="text-faint">Terminal evidence</dt><dd className="break-words text-mut">{record.terminalEvidence}</dd></div>}
                {record.modelLabel && <div><dt className="text-faint">Model label</dt><dd className="break-words text-mut">{record.modelLabel}</dd></div>}
              </dl>
              {record.linkedTicketKind && <p className="mt-3 rounded-sm border border-memory/40 bg-memory/10 px-2 py-1.5 text-xs text-memory">Linked to existing SDD task ticket</p>}

              <details className="mt-3 rounded-sm border border-line/70 px-3 py-2 text-xs text-mut">
                <summary className="cursor-pointer font-medium text-ink">Automation and your changes</summary>
                <p className="mt-2 leading-relaxed">Agent updates may change lifecycle, freshness, and agent evidence. Your summary and project choices stay yours. Pause keeps receiving evidence without changing the ticket; detach stops ticket updates; close requires confirmation and later events cannot reopen this assignment.</p>
              </details>

              {editingId === record.id ? (
                <form className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void update(record, { safeSummary: summaryDraft }, 'Assignment summary saved.') }}>
                  <label className="min-w-0 flex-1 text-xs text-mut">Safe assignment summary
                    <input value={summaryDraft} maxLength={160} onChange={(event) => setSummaryDraft(event.target.value)} className="mt-1 w-full min-w-0 rounded-sm border border-line bg-mist px-2 py-2 text-sm text-ink" />
                  </label>
                  <div className="flex flex-wrap items-end gap-2"><button type="submit" disabled={busy || !summaryDraft.trim()} className="rounded-sm border border-sync/50 px-3 py-2 text-xs text-sync disabled:opacity-50">Save summary</button><button type="button" onClick={() => setEditingId(undefined)} className="rounded-sm border border-line px-3 py-2 text-xs">Cancel</button></div>
                </form>
              ) : <button type="button" disabled={!onUpdate || busy} onClick={() => { setEditingId(record.id); setSummaryDraft(record.summary) }} className="mt-3 rounded-sm border border-line px-3 py-2 text-xs disabled:opacity-50">Rename assignment</button>}

              <div className="mt-3 min-w-0">
                <label className="text-xs text-mut">Project
                  <select value={projectValue} disabled={!onUpdate || busy} onChange={(event) => {
                    if (event.target.value === '__review') return
                    const project = event.target.value === '__unassigned' ? { kind: 'unassigned' as const } : { kind: 'approved-project' as const, id: event.target.value }
                    void update(record, { project }, 'Project choice saved.')
                  }} className="mt-1 w-full min-w-0 rounded-sm border border-line bg-mist px-2 py-2 text-sm text-ink disabled:opacity-50">
                    {record.project.kind === 'needs-review' && <option value="__review">Needs review</option>}
                    <option value="__unassigned">Unassigned</option>
                    {projects.filter((item) => item.state === 'active').map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                {record.project.kind === 'needs-review' && onOpenPrivacy && <button type="button" onClick={onOpenPrivacy} className="mt-2 text-xs text-warn underline">Review ambiguous project</button>}
              </div>

              <div className="mt-4 flex min-w-0 flex-wrap gap-2">
                <button type="button" disabled={!onUpdate || busy} onClick={() => void update(record, { sourceUpdatePolicy: record.sourceUpdatePolicy === 'paused' ? 'follow' : 'paused' }, record.sourceUpdatePolicy === 'paused' ? 'Agent updates resumed.' : 'Agent updates paused.')} className="rounded-sm border border-line px-3 py-2 text-xs disabled:opacity-50">{record.sourceUpdatePolicy === 'paused' ? 'Resume updates' : 'Pause updates'}</button>
                <button type="button" disabled={!onUpdate || busy || record.sourceUpdatePolicy === 'detached'} onClick={() => void update(record, { sourceUpdatePolicy: 'detached' }, 'Agent source detached; the ticket was kept.')} className="rounded-sm border border-line px-3 py-2 text-xs disabled:opacity-50">Detach source</button>
                {confirmCloseId === record.id ? <><button type="button" disabled={busy} onClick={() => void update(record, { sourceUpdatePolicy: 'closed' }, 'Assignment closed with explicit human evidence.')} className="rounded-sm border border-alert/50 px-3 py-2 text-xs text-alert disabled:opacity-50">Confirm close assignment</button><button type="button" onClick={() => setConfirmCloseId(undefined)} className="rounded-sm border border-line px-3 py-2 text-xs">Keep open</button></> : <button type="button" disabled={!onUpdate || busy} onClick={() => setConfirmCloseId(record.id)} className="rounded-sm border border-alert/40 px-3 py-2 text-xs text-alert disabled:opacity-50">Close assignment</button>}
              </div>
            </article>
          )
        })}
      </div>
      {hasMore && <button type="button" onClick={onLoadMore} disabled={loading} className="mt-4 rounded-sm border border-line px-3 py-2 text-xs disabled:opacity-50">{loading ? 'Loading…' : 'Load more assignments'}</button>}
    </section>
  )
}

function projectLabel(record: AgentActivityAssignmentSummaryDto): string {
  if (record.project.kind === 'approved-project') return record.project.label
  return record.project.kind === 'needs-review' ? 'Needs review' : 'Unassigned'
}

function stateText(record: AgentActivityAssignmentSummaryDto): string {
  const label = (state: AgentActivityAssignmentSummaryDto['effectiveState']) => state === 'needs-action' ? 'Needs action' : `${state.charAt(0).toUpperCase()}${state.slice(1)}`
  return record.effectiveState === 'stale' ? `Stale — last reported ${label(record.retainedLastState)}` : label(record.effectiveState)
}
