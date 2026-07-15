import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-agent-activity-'))
  cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
  const operational = new OperationalRepository(database.db)
  const clock = () => new Date('2026-07-14T17:00:01.000Z')
  const lifecycle = new TicketLifecycleService(operational, clock)
  const activity = new AgentActivityRepository(database.db, operational, lifecycle, Buffer.alloc(32, 7), clock)
  activity.registerIntegration({
    id: 'integration-codex-1',
    agent: 'codex-cli',
    adapterVersion: '1.0.0',
    installedVersion: '0.144.3',
  })
  return { database, operational, activity }
}

describe('AgentActivityRepository tracer', () => {
  it('creates exactly one assignment, ticket, source link, event, and lifecycle transition when a start is retried', async () => {
    const { database, operational, activity } = await fixture()
    const event = assignmentEventFixture()

    const first = activity.ingest(event)
    const repeated = activity.ingest(event)

    expect(first.outcome).toBe('applied')
    expect(repeated).toEqual({ ...first, outcome: 'duplicate' })
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual({ count: 1 })
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignment_events').get()).toEqual({ count: 1 })
    expect(database.db.prepare("SELECT count(*) AS count FROM ticket_source_links WHERE source_id='agent-activity'").get()).toEqual({ count: 1 })
    expect(database.db.prepare('SELECT count(*) AS count FROM tickets').get()).toEqual({ count: 1 })
    expect(database.db.prepare('SELECT count(*) AS count FROM ticket_status_events').get()).toEqual({ count: 1 })
    expect(operational.getTicket(first.ticketId)?.payload).toMatchObject({
      title: 'Implement the activity tracer',
      status: 'in-progress',
      activityState: 'active',
    })
    database.close()
  })

  it('stores only HMAC identities and returns a browser-safe assignment projection', async () => {
    const { database, activity } = await fixture()
    const event = assignmentEventFixture()
    const receipt = activity.ingest(event)
    const row = database.db.prepare('SELECT assignment_key,evidence_key,safe_summary FROM agent_assignment_events').get() as Record<string, unknown>
    const projection = activity.getAssignment(receipt.assignmentKey)

    expect(row.assignment_key).toBe(receipt.assignmentKey)
    expect(row.assignment_key).not.toBe(event.assignment.originAssignmentId)
    expect(row.evidence_key).not.toBe(event.observation.originEvidenceId)
    expect(String(row.assignment_key)).toMatch(/^[a-f0-9]{64}$/)
    expect(String(row.evidence_key)).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify({ row, projection })).not.toContain(event.assignment.originAssignmentId)
    expect(JSON.stringify({ row, projection })).not.toContain(event.observation.originEvidenceId)
    expect(projection).toMatchObject({
      assignmentKey: receipt.assignmentKey,
      agent: 'codex-cli',
      safeSummary: 'Implement the activity tracer',
      reportedState: 'active',
      lastAppliedSequence: 1,
    })
    expect(projection).not.toHaveProperty('evidenceKey')
    expect(projection).not.toHaveProperty('originAssignmentId')
    database.close()
  })

  it('does not mutate any table for structurally unsafe events and discards a minimized summary', async () => {
    const { database, activity } = await fixture()
    const counts = () => database.db.prepare(`SELECT
      (SELECT count(*) FROM agent_assignments) AS assignments,
      (SELECT count(*) FROM agent_assignment_events) AS events,
      (SELECT count(*) FROM tickets) AS tickets,
      (SELECT count(*) FROM ticket_source_links) AS links`).get()
    const before = counts()
    expect(() => activity.ingest({ ...assignmentEventFixture(), response: 'private' })).toThrow()
    expect(counts()).toEqual(before)

    const privateSummary = 'password=super-secret\npasted private block'
    const receipt = activity.ingest(assignmentEventFixture({
      assignment: { ...assignmentEventFixture().assignment, summary: { text: privateSummary, source: 'explicit-user' } },
    }))
    expect(receipt.receiptCodes).toEqual(['SUMMARY_MINIMIZED'])
    expect(activity.getAssignment(receipt.assignmentKey)?.safeSummary).toBe('Codex work — name this assignment')
    expect(JSON.stringify(database.db.prepare('SELECT * FROM agent_assignments').all())).not.toContain('super-secret')
    expect(JSON.stringify(database.db.prepare('SELECT * FROM agent_assignment_events').all())).not.toContain('super-secret')
    database.close()
  })
})
