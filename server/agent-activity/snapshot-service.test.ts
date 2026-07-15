import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityService } from './agent-activity-service.js'
import { ActivityCapabilityRegistry, manualActivityRegistration } from './capability-manifests.js'
import { ManualReportingService, manualReportDraft, type ManualReportInput } from './manual-reporting-service.js'
import { SnapshotService } from './snapshot-service.js'
import { ReporterSanitizer } from './reporter/sanitizer.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-snapshot-')); cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'test.db'), backupBeforeMigration: false })
  const operational = new OperationalRepository(database.db)
  let now = new Date('2026-07-14T22:00:00.000Z'); let event = 0; let request = 0
  const clock = () => now
  const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, clock), Buffer.alloc(32, 6), clock)
  repository.registerIntegration(manualActivityRegistration('manual:codex-cli', 'codex-cli'))
  const activities = new AgentActivityService(repository, clock)
  const snapshots = new SnapshotService(database.db, clock, () => `snapshot-${++request}`)
  const manual = new ManualReportingService({ repository, activities, capabilities: new ActivityCapabilityRegistry(database.db), snapshots, clock, eventId: () => `018f6f7e-6f52-7e54-8aa5-${String(++event).padStart(12, '0')}` })
  return { database, repository, activities, snapshots, manual, setNow: (value: string) => { now = new Date(value) } }
}

const base: Omit<ManualReportInput, 'action'> = { integrationId: 'manual:codex-cli', agent: 'codex-cli', assignmentId: 'snapshot-work-1', generation: 1, summary: 'Current work snapshot', projectRef: { kind: 'unassigned' }, evidenceKind: 'manual-command' }

describe('SnapshotService', () => {
  it.each(['current-session', 'next-interaction', 'explicit-report'] as const)('records exact zero-result %s mode/window without claiming there is no work on the computer', async (mode) => {
    const { database, snapshots } = await fixture()
    const requested = snapshots.request({ integrationId: 'manual:codex-cli', mode })
    const complete = snapshots.complete({ requestId: requested.requestId, coverageStartedAt: '2026-07-14T22:00:00.000Z', coverageEndedAt: '2026-07-14T22:05:00.000Z', assignmentsObserved: 0, gapCount: 0 })
    expect(complete).toMatchObject({ mode, assignmentsObserved: 0, coverageStartedAt: '2026-07-14T22:00:00.000Z', coverageEndedAt: '2026-07-14T22:05:00.000Z', state: 'complete' })
    expect(complete.limitation).toMatch(/does not establish.*other work/i)
    database.close()
  })

  it('applies an explicit-report snapshot at the expected sequence and cannot reopen terminal work', async () => {
    const { database, repository, snapshots, manual, setNow } = await fixture()
    const first = manual.report({ ...base, action: 'start' })
    const request = snapshots.request({ integrationId: 'manual:codex-cli', mode: 'explicit-report' })
    setNow('2026-07-14T22:00:01.000Z')
    expect(manual.report({ ...base, action: 'snapshot', snapshot: { requestId: request.requestId, mode: 'explicit-report', coverageStartedAt: '2026-07-14T22:00:00.000Z' } })).toMatchObject({ outcome: 'applied' })
    expect(snapshots.get(request.requestId)).toMatchObject({ state: 'complete', assignmentsObserved: 1, gapCount: 0 })
    setNow('2026-07-14T22:00:02.000Z'); expect(manual.report({ ...base, action: 'complete' }).outcome).toBe('applied')
    setNow('2026-07-14T22:00:03.000Z'); expect(manual.report({ ...base, action: 'snapshot', snapshot: { requestId: request.requestId, mode: 'explicit-report', coverageStartedAt: '2026-07-14T22:00:03.000Z' } })).toMatchObject({ outcome: 'rejected', reasonCode: 'TERMINAL_ASSIGNMENT' })
    expect(repository.getAssignment(first.assignmentKey)).toMatchObject({ reportedState: 'completed', lastAppliedSequence: 3 })
    database.close()
  })

  it('uses a bounded snapshot at the expected sequence to drain a quarantined gap', async () => {
    const { database, repository, activities, snapshots, manual, setNow } = await fixture()
    const first = manual.report({ ...base, action: 'start' })
    const sanitizer = new ReporterSanitizer()
    sanitizer.sanitizeDraft(manualReportDraft({ ...base, action: 'start' }, '018f6f7e-6f52-7e54-8aa5-000000000090', '2026-07-14T22:00:00.000Z'))
    const waiting = sanitizer.sanitizeDraft(manualReportDraft({ ...base, action: 'wait' }, '018f6f7e-6f52-7e54-8aa5-000000000091', '2026-07-14T22:00:03.000Z'))
    expect(activities.ingest({ ...waiting, observation: { ...waiting.observation, sequence: 3 } })).toMatchObject({ outcome: 'gap', expectedSequence: 2 })
    const request = snapshots.request({ integrationId: 'manual:codex-cli', mode: 'explicit-report' })
    setNow('2026-07-14T22:00:02.000Z')
    const snapshot = sanitizer.sanitizeDraft(manualReportDraft({ ...base, action: 'snapshot', snapshot: { requestId: request.requestId, mode: 'explicit-report', coverageStartedAt: '2026-07-14T22:00:00.000Z' } }, '018f6f7e-6f52-7e54-8aa5-000000000092', '2026-07-14T22:00:02.000Z'))
    const recovered = activities.ingest({ ...snapshot, observation: { ...snapshot.observation, sequence: 2 } })
    snapshots.recordEvent({ integrationId: snapshot.integrationId, ...snapshot.snapshot! }, recovered.outcome, recovered.reasonCode)
    expect(recovered).toMatchObject({ outcome: 'applied', appliedCount: 2, expectedSequence: 4 })
    expect(repository.getAssignment(first.assignmentKey)).toMatchObject({ lastAppliedSequence: 3, reportedState: 'waiting' })
    expect(snapshots.get(request.requestId)).toMatchObject({ state: 'complete', assignmentsObserved: 1 })
    database.close()
  })
})
