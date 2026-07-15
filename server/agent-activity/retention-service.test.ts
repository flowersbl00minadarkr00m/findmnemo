import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityRetentionService } from './retention-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-activity-retention-')); cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
  const operational = new OperationalRepository(database.db)
  const clock = () => new Date('2026-07-14T19:00:00.000Z')
  const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, clock), Buffer.alloc(32, 9), clock)
  repository.registerIntegration({ id: 'integration-codex-retention', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3' })
  return { database, repository, clock }
}

describe('AgentActivityRetentionService', () => {
  it('retains the newest 10,000 applied events plus current, gap, review, and terminal evidence', async () => {
    const { database, repository, clock } = await fixture()
    const active = repository.ingest(assignmentEventFixture({ integrationId: 'integration-codex-retention', eventId: '00000000-0000-4000-8000-000000000001' }))
    const insert = database.db.prepare(`INSERT INTO agent_assignment_events(event_id,assignment_key,sequence,event_kind,reported_state,observed_at,received_at,evidence_kind,apply_state)
      VALUES(?,?,?,?,?,?,?,?,?)`)
    database.db.exec('BEGIN IMMEDIATE')
    for (let sequence = 2; sequence <= 10_030; sequence += 1) {
      const id = `bulk-${String(sequence).padStart(5, '0')}`
      insert.run(id, active.assignmentKey, sequence, 'heartbeat', 'active', '2026-07-14T18:00:00.000Z', '2026-07-14T18:00:00.000Z', 'codex-hook', 'applied')
    }
    database.db.prepare('UPDATE agent_assignments SET last_applied_sequence=10030,last_event_id=? WHERE assignment_key=?').run('bulk-10030', active.assignmentKey)
    database.db.exec('COMMIT')

    const terminal = repository.ingest(assignmentEventFixture({
      integrationId: 'integration-codex-retention', eventId: '00000000-0000-4000-8000-000000000002',
      assignment: { ...assignmentEventFixture().assignment, originAssignmentId: 'terminal-origin' },
      observation: { ...assignmentEventFixture().observation, kind: 'completed', reportedState: undefined, terminalEvidence: { kind: 'agent-explicit', outcome: 'completed' } },
    }))
    database.db.prepare("UPDATE agent_assignment_events SET received_at='2026-07-14T16:00:00.000Z' WHERE event_id='00000000-0000-4000-8000-000000000002'").run()
    const review = repository.ingest(assignmentEventFixture({
      integrationId: 'integration-codex-retention', eventId: '00000000-0000-4000-8000-000000000003',
      assignment: { ...assignmentEventFixture().assignment, originAssignmentId: 'review-origin' },
    }))
    database.db.prepare("UPDATE agent_assignment_events SET received_at='2026-07-14T16:00:00.000Z' WHERE event_id='00000000-0000-4000-8000-000000000003'").run()
    database.db.prepare(`INSERT INTO agent_project_reviews(review_token,integration_id,assignment_key,state,candidate_count,created_at)
      VALUES('review-retention','integration-codex-retention',?,'pending',2,'2026-07-14T16:00:00.000Z')`).run(review.assignmentKey)
    database.db.prepare(`INSERT INTO agent_assignment_events(event_id,assignment_key,sequence,event_kind,reported_state,observed_at,received_at,evidence_kind,apply_state)
      VALUES('pending-gap-pinned',?,10031,'heartbeat','active','2026-07-14T18:01:00.000Z','2026-07-14T18:01:00.000Z','codex-hook','pending-gap')`).run(active.assignmentKey)

    const service = new AgentActivityRetentionService(database, { maxAppliedEvents: 10_000, clock })
    const result = service.prune()

    expect(result).toMatchObject({ appliedBefore: 10_032, appliedAfter: 10_002, deleted: 30, pendingDepth: 1 })
    expect(database.db.prepare("SELECT event_id FROM agent_assignment_events WHERE event_id IN ('bulk-10030','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','pending-gap-pinned') ORDER BY event_id").all()).toHaveLength(4)
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignment_events').get()).toEqual({ count: 10_003 })
    expect(repository.getAssignment(terminal.assignmentKey)?.terminalOutcome).toBe('completed')
    expect((database.db.prepare("EXPLAIN QUERY PLAN SELECT event_id FROM agent_assignment_events WHERE apply_state='applied' ORDER BY received_at DESC,event_id DESC LIMIT 50").all() as Array<{ detail: string }>).some((row) => row.detail.includes('agent_assignment_events_retention_idx'))).toBe(true)
    expect((database.db.prepare("EXPLAIN QUERY PLAN SELECT assignment_key FROM agent_assignments WHERE terminal_outcome IS NULL ORDER BY last_observed_at DESC,assignment_key DESC LIMIT 50").all() as Array<{ detail: string }>).some((row) => row.detail.includes('agent_assignments_activity_page_idx'))).toBe(true)
    database.close()
  }, 20_000)

  it('rolls back the entire prune when any deletion fails', async () => {
    const { database, repository, clock } = await fixture()
    const assignment = repository.ingest(assignmentEventFixture({ integrationId: 'integration-codex-retention', eventId: '00000000-0000-4000-8000-000000000004' }))
    const insert = database.db.prepare(`INSERT INTO agent_assignment_events(event_id,assignment_key,sequence,event_kind,reported_state,observed_at,received_at,evidence_kind,apply_state)
      VALUES(?,?,?,?,?,?,?,?,?)`)
    for (let sequence = 2; sequence <= 5; sequence += 1) insert.run(`old-${sequence}`, assignment.assignmentKey, sequence, 'heartbeat', 'active', '2026-07-14T17:00:00.000Z', `2026-07-14T17:00:0${sequence}.000Z`, 'codex-hook', 'applied')
    database.db.prepare('UPDATE agent_assignments SET last_applied_sequence=5,last_event_id=? WHERE assignment_key=?').run('old-5', assignment.assignmentKey)
    database.db.exec("CREATE TRIGGER retention_abort BEFORE DELETE ON agent_assignment_events WHEN OLD.event_id='old-2' BEGIN SELECT RAISE(ABORT,'fixture'); END")
    const before = database.db.prepare('SELECT count(*) AS count FROM agent_assignment_events').get()

    expect(() => new AgentActivityRetentionService(database, { maxAppliedEvents: 1, clock }).prune()).toThrow()
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignment_events').get()).toEqual(before)
    expect(database.db.prepare('SELECT last_retention_failure_code FROM agent_activity_runtime WHERE singleton_id=1').get()).toEqual({ last_retention_failure_code: 'ACTIVITY_RETENTION_FAILED' })
    database.close()
  })
})
