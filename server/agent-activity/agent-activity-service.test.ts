import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import type { AssignmentEventV1 } from '../../shared/agent-activity-contract.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityService } from './agent-activity-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-activity-service-'))
  cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
  const operational = new OperationalRepository(database.db)
  let now = new Date('2026-07-14T17:00:01.000Z')
  const clock = () => now
  const lifecycle = new TicketLifecycleService(operational, clock)
  const repository = new AgentActivityRepository(database.db, operational, lifecycle, Buffer.alloc(32, 9), clock)
  repository.registerIntegration({ id: 'integration-codex-1', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3', freshnessWindowSeconds: 120 })
  return { database, operational, repository, service: new AgentActivityService(repository, clock), setNow: (value: string) => { now = new Date(value) } }
}

function event(sequence: number, kind: AssignmentEventV1['observation']['kind'], options: { id?: string; assignmentId?: string; summary?: string; projectRef?: AssignmentEventV1['assignment']['projectRef'] } = {}): AssignmentEventV1 {
  const terminal = kind === 'completed' || kind === 'failed' || kind === 'cancelled'
  return assignmentEventFixture({
    eventId: options.id ?? `018f6f7e-6f52-7e54-8aa5-${String(sequence).padStart(12, '0')}`,
    assignment: {
      ...assignmentEventFixture().assignment,
      originAssignmentId: options.assignmentId ?? 'assignment-ordering',
      summary: { text: options.summary ?? 'Lifecycle work', source: 'explicit-user' },
      projectRef: options.projectRef ?? { kind: 'unassigned' },
    },
    observation: {
      ...assignmentEventFixture().observation,
      sequence,
      kind,
      observedAt: `2026-07-14T17:00:${String(sequence).padStart(2, '0')}.000Z`,
      ...(terminal ? { reportedState: undefined, terminalEvidence: { kind: 'agent-explicit', outcome: kind } } : {}),
    },
  })
}

describe('AgentActivityService lifecycle ordering', () => {
  it('quarantines a gap, applies the missing event, and drains contiguous pending work atomically', async () => {
    const { database, operational, repository, service } = await fixture()
    const started = service.ingest(event(1, 'started'))
    expect(service.ingest(event(3, 'waiting')).outcome).toBe('gap')
    expect(repository.getAssignment(started.assignmentKey)).toMatchObject({ lastAppliedSequence: 1, reportedState: 'active' })
    expect(operational.getTicket(started.ticketId)?.status).toBe('in-progress')

    expect(service.ingest(event(2, 'blocked'))).toMatchObject({ outcome: 'applied', appliedCount: 2 })
    expect(repository.getAssignment(started.assignmentKey)).toMatchObject({ lastAppliedSequence: 3, reportedState: 'waiting' })
    expect(database.db.prepare("SELECT sequence,apply_state FROM agent_assignment_events ORDER BY sequence").all()).toEqual([
      { sequence: 1, apply_state: 'applied' }, { sequence: 2, apply_state: 'applied' }, { sequence: 3, apply_state: 'applied' },
    ])
    expect(operational.getTicket(started.ticketId)?.status).toBe('in-progress')
    database.close()
  })

  it('classifies duplicate, same-sequence conflict, replay, first-event gap, and future clock skew without ticket mutation', async () => {
    const { database, operational, service } = await fixture()
    const firstEvent = event(1, 'started')
    const first = service.ingest(firstEvent)
    const before = JSON.stringify(operational.getTicket(first.ticketId))
    expect(service.ingest(firstEvent).outcome).toBe('duplicate')
    expect(service.ingest(event(1, 'waiting', { id: '018f6f7e-6f52-7e54-8aa5-999999999991' }))).toMatchObject({ outcome: 'conflict', expectedSequence: 2 })
    database.db.prepare('DELETE FROM agent_assignment_events WHERE assignment_key=? AND sequence=1').run(first.assignmentKey)
    expect(service.ingest(event(1, 'waiting', { id: '018f6f7e-6f52-7e54-8aa5-999999999992' }))).toMatchObject({ outcome: 'replay', expectedSequence: 2 })
    expect(service.ingest(event(2, 'heartbeat', { assignmentId: 'new-with-gap' }))).toMatchObject({ outcome: 'rejected', reasonCode: 'FIRST_SEQUENCE_REQUIRED' })
    const future = event(1, 'started', { assignmentId: 'future', id: '018f6f7e-6f52-7e54-8aa5-999999999993' })
    future.observation.observedAt = '2026-07-14T17:06:02.000Z'
    expect(service.ingest(future)).toMatchObject({ outcome: 'rejected', reasonCode: 'CLOCK_SKEW' })
    expect(JSON.stringify(operational.getTicket(first.ticketId))).toBe(before)
    database.close()
  })

  it.each(['completed', 'failed', 'cancelled'] as const)('requires explicit %s evidence and never counts failure/cancellation as completed work', async (outcome) => {
    const { database, operational, repository, service } = await fixture()
    const assignmentId = `terminal-${outcome}`
    const first = service.ingest(event(1, 'started', { assignmentId }))
    expect(service.ingest(event(2, outcome, { assignmentId }))).toMatchObject({ outcome: 'applied' })
    const assignment = repository.getAssignment(first.assignmentKey)
    const ticket = operational.getTicket(first.ticketId)
    expect(assignment).toMatchObject({ reportedState: outcome, terminalOutcome: outcome, terminalAt: '2026-07-14T17:00:02.000Z' })
    expect(ticket?.status).toBe(outcome === 'completed' ? 'done' : 'blocked')
    expect(ticket?.completedAt).toBe(outcome === 'completed' ? '2026-07-14T17:00:02.000Z' : null)
    expect(service.ingest(event(3, 'resumed', { assignmentId }))).toMatchObject({ outcome: 'rejected', reasonCode: 'TERMINAL_ASSIGNMENT' })
    database.close()
  })

  it('protects human summary/project ownership and paused, detached, and closed update policies', async () => {
    const { database, operational, repository, service } = await fixture()
    database.db.prepare(`INSERT INTO project_folders(id,label,canonical_path,path_fingerprint,state,detected_kind,sdd_enrichment_enabled,last_checked_at,last_success_at,last_error_code,created_at,updated_at)
      VALUES('project-human','Human project','C:/human','fingerprint-human','active','git',0,NULL,NULL,NULL,'2026-07-14T17:00:00.000Z','2026-07-14T17:00:00.000Z')`).run()
    const first = service.ingest(event(1, 'started'))
    const version = repository.getAssignment(first.assignmentKey)!.recordVersion
    repository.updateHumanOverride(first.assignmentKey, { expectedVersion: version, safeSummary: 'Human title', projectRef: { kind: 'approved-project', id: 'project-human' }, sourceUpdatePolicy: 'paused' })
    service.ingest(event(2, 'blocked', { summary: 'Source title', projectRef: { kind: 'unassigned' } }))
    expect(repository.getAssignment(first.assignmentKey)).toMatchObject({ safeSummary: 'Human title', projectRef: { kind: 'approved-project', id: 'project-human' }, reportedState: 'blocked', sourceUpdatePolicy: 'paused' })
    expect(operational.getTicket(first.ticketId)?.payload).toMatchObject({ title: 'Human title', projectId: 'project-human', activityState: 'active' })

    repository.updateHumanOverride(first.assignmentKey, { expectedVersion: repository.getAssignment(first.assignmentKey)!.recordVersion, sourceUpdatePolicy: 'detached' })
    service.ingest(event(3, 'waiting'))
    expect(operational.getTicket(first.ticketId)?.payload).toMatchObject({ activityState: 'active' })
    repository.updateHumanOverride(first.assignmentKey, { expectedVersion: repository.getAssignment(first.assignmentKey)!.recordVersion, sourceUpdatePolicy: 'closed' })
    expect(service.ingest(event(4, 'resumed'))).toMatchObject({ outcome: 'rejected', reasonCode: 'SOURCE_CLOSED' })
    expect(operational.getTicket(first.ticketId)?.status).toBe('done')
    database.close()
  })

  it('updates ten assignments independently without cross-integration scans', async () => {
    const { database, repository, service } = await fixture()
    const receipts = Array.from({ length: 10 }, (_, index) => service.ingest(event(1, 'started', {
      assignmentId: `concurrent-${index}`,
      id: `018f6f7e-6f52-7e54-8aa5-${String(100 + index).padStart(12, '0')}`,
    })))
    for (let index = 0; index < receipts.length; index += 1) service.ingest(event(2, 'heartbeat', {
      assignmentId: `concurrent-${index}`,
      id: `018f6f7e-6f52-7e54-8aa5-${String(200 + index).padStart(12, '0')}`,
    }))
    expect(receipts.map((receipt) => repository.getAssignment(receipt.assignmentKey)?.lastAppliedSequence)).toEqual(Array(10).fill(2))
    expect(database.db.prepare('SELECT count(*) AS count FROM agent_assignments').get()).toEqual({ count: 10 })
    database.close()
  })
})
