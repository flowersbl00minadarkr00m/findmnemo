import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture, assignmentEventV2Fixture } from '../../shared/agent-activity-contract.test.js'
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
  activity.registerIntegration({
    id: 'integration-codex-desktop-1',
    agentFamily: 'codex',
    executionSurface: 'codex-desktop',
    adapterVersion: '2.0.0',
    installedVersion: '1.2.3',
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

  it('keeps the v1 assignment identity golden vector and domain-separates v2 identity', async () => {
    const { database, activity } = await fixture()
    expect(activity.assignmentKeyFor(assignmentEventFixture()))
      .toBe('f150038ba2c01238297d909369f2dde97a826a5eb9b983268996feadde075da9')
    expect(activity.assignmentKeyFor(assignmentEventV2Fixture()))
      .toBe('fd79a8436937da7dc105a3dabab6eca4f50a2f219af7bb666ba8c9033f9a833b')
    expect(activity.assignmentKeyFor(assignmentEventV2Fixture())).not.toBe(activity.assignmentKeyFor(assignmentEventFixture()))
    database.close()
  })

  it('binds v2 family and surface to immutable integration metadata and projects safe attribution', async () => {
    const { database, activity } = await fixture()
    const event = assignmentEventV2Fixture()
    const receipt = activity.ingest(event)

    expect(receipt.outcome).toBe('applied')
    expect(activity.getAssignment(receipt.assignmentKey)).toMatchObject({
      agent: 'codex-cli',
      agentFamily: 'codex',
      executionSurface: 'codex-desktop',
      modelLabel: 'openai/gpt-5-codex',
      modelSource: 'host-reported',
      modelConfidence: 'reported',
    })
    expect(database.db.prepare(`SELECT agent_family,execution_surface,model_label,model_source,model_confidence
      FROM agent_assignments WHERE assignment_key=?`).get(receipt.assignmentKey)).toEqual({
      agent_family: 'codex',
      execution_surface: 'codex-desktop',
      model_label: 'openai/gpt-5-codex',
      model_source: 'host-reported',
      model_confidence: 'reported',
    })

    expect(() => activity.ingest({
      ...event,
      eventId: '028f6f7e-6f52-7e54-8aa5-000000000099',
      executionSurface: 'codex-cli',
    })).toThrow('ACTIVITY_INTEGRATION_MISMATCH')
    expect(() => activity.registerIntegration({
      id: 'integration-codex-desktop-1',
      agentFamily: 'codex',
      executionSurface: 'codex-cli',
      adapterVersion: '2.0.0',
      installedVersion: '1.2.3',
    })).toThrow('ACTIVITY_INTEGRATION_REBIND')
    database.close()
  })

  it('ignores rejected v2 model labels without persisting them or clearing an earlier valid label', async () => {
    const { database, activity } = await fixture()
    const first = assignmentEventV2Fixture()
    const started = activity.ingest(first)
    const rejectedLabel = 'password=never-store-this'
    const ignored = activity.ingest({
      ...first,
      eventId: '028f6f7e-6f52-7e54-8aa5-000000000002',
      observation: { ...first.observation, sequence: 2, kind: 'heartbeat', observedAt: '2026-07-14T17:00:01.000Z' },
      model: { label: rejectedLabel, source: 'host-reported', confidence: 'reported' },
    })
    const absent = activity.ingest({
      ...first,
      eventId: '028f6f7e-6f52-7e54-8aa5-000000000003',
      observation: { ...first.observation, sequence: 3, kind: 'waiting', reportedState: 'waiting', observedAt: '2026-07-14T17:00:02.000Z' },
      model: null,
    })

    expect(ignored).toMatchObject({ outcome: 'applied', receiptCodes: ['MODEL_LABEL_IGNORED'] })
    expect(absent.outcome).toBe('applied')
    expect(activity.getAssignment(started.assignmentKey)).toMatchObject({
      modelLabel: 'openai/gpt-5-codex',
      modelSource: 'host-reported',
      modelConfidence: 'reported',
      lastAppliedSequence: 3,
    })
    expect(JSON.stringify(database.db.prepare('SELECT * FROM agent_assignments').all())).not.toContain(rejectedLabel)
    expect(JSON.stringify(database.db.prepare('SELECT * FROM agent_assignment_events').all())).not.toContain(rejectedLabel)
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
