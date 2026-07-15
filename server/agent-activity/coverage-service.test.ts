import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityService } from './agent-activity-service.js'
import { AgentActivityCoverageService } from './coverage-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('AgentActivityCoverageService', () => {
  it('derives stale without mutating lifecycle or completion facts and survives reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-coverage-')); cleanup.push(root)
    const path = join(root, 'findmnemo.db')
    let now = new Date('2026-07-14T17:00:01.000Z')
    const database = await openFindMnemoDatabase({ path })
    const operational = new OperationalRepository(database.db)
    const lifecycle = new TicketLifecycleService(operational, () => now)
    const repository = new AgentActivityRepository(database.db, operational, lifecycle, Buffer.alloc(32, 5), () => now)
    repository.registerIntegration({ id: 'integration-codex-1', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3', freshnessWindowSeconds: 120 })
    const receipt = new AgentActivityService(repository, () => now).ingest(assignmentEventFixture({ assignment: { ...assignmentEventFixture().assignment, originAssignmentId: 'freshness' } }))
    const coverage = new AgentActivityCoverageService(repository, () => now)
    expect(coverage.get(receipt.assignmentKey)).toMatchObject({ effectiveState: 'active', retainedLastReportedState: 'active' })
    now = new Date('2026-07-14T17:02:01.001Z')
    expect(coverage.get(receipt.assignmentKey)).toMatchObject({ effectiveState: 'stale', retainedLastReportedState: 'active' })
    expect(operational.getTicket(receipt.ticketId)).toMatchObject({ status: 'in-progress', completedAt: null })
    expect(operational.listTicketStatusEvents(receipt.ticketId)).toHaveLength(1)
    database.close()

    const reopened = await openFindMnemoDatabase({ path })
    const reopenedOperational = new OperationalRepository(reopened.db)
    const reopenedRepository = new AgentActivityRepository(reopened.db, reopenedOperational, new TicketLifecycleService(reopenedOperational, () => now), Buffer.alloc(32, 5), () => now)
    expect(new AgentActivityCoverageService(reopenedRepository, () => now).get(receipt.assignmentKey)).toMatchObject({ effectiveState: 'stale' })
    reopened.close()
  })

  it('paginates browser-safe active assignments without transferring events and keeps terminal outcomes separate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-coverage-page-')); cleanup.push(root)
    let now = new Date('2026-07-14T18:00:00.000Z')
    const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
    const operational = new OperationalRepository(database.db)
    const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, () => now), Buffer.alloc(32, 5), () => now)
    repository.registerIntegration({ id: 'integration-codex-1', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3', freshnessWindowSeconds: 120 })
    database.db.prepare(`INSERT INTO project_folders(id,label,canonical_path,path_fingerprint,state,detected_kind,sdd_enrichment_enabled,last_checked_at,last_success_at,last_error_code,created_at,updated_at)
      VALUES('project-safe','FindMnemo','C:/safe','fingerprint-safe','active','git',0,?,?,?,?,?)`)
      .run(now.toISOString(), now.toISOString(), null, now.toISOString(), now.toISOString())
    const service = new AgentActivityService(repository, () => now)
    const first = assignmentEventFixture({ eventId: '018f6f7e-6f52-7e54-8aa5-000000000201', assignment: { ...assignmentEventFixture().assignment, originAssignmentId: 'page-1', summary: { text: 'First active assignment', source: 'explicit-user' }, projectRef: { kind: 'approved-project', id: 'project-safe' } }, observation: { ...assignmentEventFixture().observation, observedAt: '2026-07-14T17:59:30.000Z' } })
    const second = assignmentEventFixture({ eventId: '018f6f7e-6f52-7e54-8aa5-000000000202', assignment: { ...assignmentEventFixture().assignment, originAssignmentId: 'page-2', summary: { text: 'Second active assignment', source: 'explicit-user' } }, observation: { ...assignmentEventFixture().observation, observedAt: '2026-07-14T17:59:00.000Z' } })
    const terminal = assignmentEventFixture({ eventId: '018f6f7e-6f52-7e54-8aa5-000000000203', assignment: { ...assignmentEventFixture().assignment, originAssignmentId: 'terminal', summary: { text: 'Failed assignment', source: 'explicit-user' } }, observation: { ...assignmentEventFixture().observation, kind: 'failed', reportedState: undefined, observedAt: '2026-07-14T17:58:00.000Z', terminalEvidence: { kind: 'agent-explicit', outcome: 'failed' } } })
    const firstReceipt = service.ingest(first)
    service.ingest(second)
    service.ingest(terminal)

    const coverage = new AgentActivityCoverageService(repository, () => now)
    const pageOne = coverage.list({ scope: 'active', limit: 1 })
    expect(pageOne).toMatchObject({ total: 2, scope: 'active', items: [{ id: firstReceipt.assignmentKey, project: { kind: 'approved-project', id: 'project-safe', label: 'FindMnemo' }, effectiveState: 'active', sourceUpdatePolicy: 'follow', summaryOwner: 'source', projectOwner: 'source', linkedTicketKind: null }] })
    expect(operational.getTicket(firstReceipt.ticketId)?.payload).toMatchObject({ workNotes: [], artifacts: [], decisionLog: [], description: expect.stringMatching(/lifecycle metadata only/i) })
    expect(pageOne.nextCursor).toEqual(expect.any(String))
    const pageTwo = coverage.list({ scope: 'active', limit: 1, cursor: pageOne.nextCursor })
    expect(pageTwo.items.map((item) => item.summary)).toEqual(['Second active assignment'])
    expect(pageTwo.nextCursor).toBeNull()
    expect(coverage.list({ scope: 'terminal', limit: 10 }).items).toEqual([expect.objectContaining({ summary: 'Failed assignment', effectiveState: 'failed', terminalOutcome: 'failed' })])
    expect(JSON.stringify(pageOne)).not.toMatch(/eventId|originAssignment|canonical_path|C:\/safe/i)
    database.close()
  })

  it('preserves human rename, remap, and pause across later source events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-coverage-override-')); cleanup.push(root)
    let now = new Date('2026-07-14T19:00:00.000Z')
    const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
    const operational = new OperationalRepository(database.db)
    const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, () => now), Buffer.alloc(32, 5), () => now)
    repository.registerIntegration({ id: 'integration-codex-1', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3', freshnessWindowSeconds: 900 })
    database.db.prepare(`INSERT INTO project_folders(id,label,canonical_path,path_fingerprint,state,detected_kind,sdd_enrichment_enabled,last_checked_at,last_success_at,last_error_code,created_at,updated_at)
      VALUES('project-human','Human project','C:/human','fingerprint-human','active','git',0,?,?,?,?,?)`)
      .run(now.toISOString(), now.toISOString(), null, now.toISOString(), now.toISOString())
    const activities = new AgentActivityService(repository, () => now)
    const base = assignmentEventFixture({ eventId: '018f6f7e-6f52-7e54-8aa5-000000000211', assignment: { ...assignmentEventFixture().assignment, originAssignmentId: 'override-work', summary: { text: 'Source title', source: 'explicit-user' } } })
    const receipt = activities.ingest(base)
    const coverage = new AgentActivityCoverageService(repository, () => now)
    const changed = coverage.update(receipt.assignmentKey, { expectedVersion: 1, safeSummary: 'Human title', project: { kind: 'approved-project', id: 'project-human' }, sourceUpdatePolicy: 'paused' })
    expect(changed).toMatchObject({ summary: 'Human title', summaryOwner: 'human', project: { id: 'project-human', label: 'Human project' }, projectOwner: 'human', sourceUpdatePolicy: 'paused' })

    now = new Date('2026-07-14T19:01:00.000Z')
    activities.ingest({ ...base, eventId: '018f6f7e-6f52-7e54-8aa5-000000000212', assignment: { ...base.assignment, summary: { text: 'Source tried to replace title', source: 'explicit-agent-tool' }, projectRef: { kind: 'unassigned' } }, observation: { ...base.observation, sequence: 2, kind: 'waiting', reportedState: 'waiting', observedAt: now.toISOString() } })
    expect(coverage.get(receipt.assignmentKey)).toMatchObject({ safeSummary: 'Human title', projectRef: { kind: 'approved-project', id: 'project-human' }, reportedState: 'waiting', sourceUpdatePolicy: 'paused' })
    expect(operational.getTicket(receipt.ticketId)?.payload).toMatchObject({ title: 'Human title', projectId: 'project-human', activityState: 'active' })
    database.close()
  })
})
