import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityDiagnosticsService } from './diagnostics-service.js'
import { PRECISE_ACTIVITY_CELLS, SurfaceQualificationRegistry, unavailableQualification, type SurfaceQualificationModule } from './qualifications/index.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe('AgentActivityDiagnosticsService', () => {
  it('exports only content-free counts, buckets, versions, and allowlisted failure facts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-activity-diagnostics-')); cleanup.push(root)
    const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
    const clock = () => new Date('2026-07-14T21:00:00.000Z')
    const operational = new OperationalRepository(database.db)
    const repository = new AgentActivityRepository(database.db, operational, new TicketLifecycleService(operational, clock), Buffer.alloc(32, 6), clock)
    repository.registerIntegration({ id: 'auto:codex-cli', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3', supportLevel: 'automatic-partial', freshnessProfile: 'hook-observed', freshnessWindowSeconds: 900 })
    const applied = repository.ingest(assignmentEventFixture({ integrationId: 'auto:codex-cli' }))
    database.db.prepare(`INSERT INTO agent_assignment_events(event_id,assignment_key,sequence,event_kind,reported_state,observed_at,received_at,evidence_kind,apply_state,receipt_code)
      VALUES('pending-safe',?,2,'heartbeat','active','2026-07-14T20:50:00.000Z','2026-07-14T20:50:00.000Z','codex-hook','pending-gap','SEQUENCE_GAP')`).run(applied.assignmentKey)
    database.db.prepare(`INSERT INTO agent_activity_snapshots(request_id,integration_id,mode,requested_at,state,gap_count)
      VALUES('snapshot-safe','auto:codex-cli','next-interaction','2026-07-14T20:00:00.000Z','waiting',1)`).run()
    database.db.prepare(`INSERT INTO agent_project_reviews(review_token,integration_id,assignment_key,state,candidate_count,created_at)
      VALUES('review-safe','auto:codex-cli',?,'pending',2,'2026-07-14T20:00:00.000Z')`).run(applied.assignmentKey)
    database.db.prepare("UPDATE agent_activity_integrations SET last_success_at='2026-07-14T20:30:00.000Z',last_failure_code='REPORTER_UNAVAILABLE' WHERE id='auto:codex-cli'").run()

    const healthy = healthyModule(PRECISE_ACTIVITY_CELLS[4])
    const qualifications = new SurfaceQualificationRegistry(PRECISE_ACTIVITY_CELLS.map((cell) => cell.integrationId === healthy.integrationId ? healthy : unavailableQualification(cell)))
    const snapshot = new AgentActivityDiagnosticsService(database.db, clock, qualifications).snapshot()
    const serialized = JSON.stringify(snapshot)
    expect(snapshot).toMatchObject({
      schema: 'findmnemo.agent-activity-diagnostics.v1',
      events: { retained: 2, applied: 1, pendingDepth: 1, receiptCodes: { SEQUENCE_GAP: 1 }, queueAgeBucket: 'under-1h' },
      snapshots: { WAITING: 1 }, mappingReviewCount: 1,
      integrations: expect.arrayContaining([
        expect.objectContaining({
          agentFamily: 'codex',
          executionSurface: 'codex-cli',
          adapterVersion: 'manual-1.0.0',
          detectedVersion: '1.2.3',
          qualifiedVersions: ['1.2.3'],
          healthState: 'healthy',
        }),
      ]),
    })
    expect(snapshot.integrations).toHaveLength(6)
    for (const kind of ['PROMPT', 'RESPONSE', 'TRANSCRIPT', 'REASONING', 'CREDENTIAL', 'PATH', 'CONFIG', 'RAW_LOG', 'RETRY']) expect(serialized).not.toContain(['AGENT', 'ACTIVITY', kind, 'PRIVATE', 'CANARY'].join('_'))
    expect(snapshot).not.toHaveProperty('assignmentKey')
    expect(serialized).not.toContain('surface:codex-cli')
    expect(serialized).not.toContain('review-safe')
    database.close()
  })
})

function healthyModule(cell: (typeof PRECISE_ACTIVITY_CELLS)[number]): SurfaceQualificationModule {
  return {
    ...unavailableQualification(cell),
    adapterVersion: 'manual-1.0.0',
    detection: { state: 'detected', detectedVersion: '1.2.3', checkedAt: '2026-07-14T21:00:00.000Z' },
    setup: { state: 'verified', mechanism: 'owned-test-binding', credentialState: 'ready', bindingVerified: true },
    reachability: { state: 'reachable', checkedAt: '2026-07-14T21:00:00.000Z' },
    qualification: { qualifiedVersions: ['1.2.3'], manual: true, snapshot: 'next-interaction', automaticEvents: 'none', explicitTerminal: 'explicit', lastQualifiedAt: '2026-07-14T21:00:00.000Z' },
    health: { state: 'healthy', checkedAt: '2026-07-14T21:00:00.000Z', lastSuccessAt: '2026-07-14T20:30:00.000Z', failureCode: null },
  }
}
