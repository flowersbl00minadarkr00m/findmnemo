import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type SnapshotMode = 'current-session' | 'next-interaction' | 'explicit-report'
export type SnapshotState = 'requested' | 'waiting' | 'complete' | 'failed'

export interface SnapshotReceipt {
  requestId: string
  integrationId: string
  mode: SnapshotMode
  requestedAt: string
  coverageStartedAt: string | null
  coverageEndedAt: string | null
  assignmentsObserved: number
  gapCount: number
  state: SnapshotState
  completedAt: string | null
  failureCode: string | null
  limitation: string
}

interface CompleteSnapshotInput {
  requestId: string
  coverageStartedAt: string
  coverageEndedAt: string
  assignmentsObserved: number
  gapCount: number
}

export class SnapshotService {
  private readonly db: DatabaseSync
  private readonly clock: () => Date
  private readonly requestId: () => string

  constructor(db: DatabaseSync, clock: () => Date = () => new Date(), requestId: () => string = randomUUID) {
    this.db = db
    this.clock = clock
    this.requestId = requestId
  }

  request(input: { integrationId: string; mode: SnapshotMode }): SnapshotReceipt {
    const integration = this.db.prepare('SELECT enabled,configured FROM agent_activity_integrations WHERE id=?').get(input.integrationId) as { enabled?: number; configured?: number } | undefined
    if (!integration?.enabled || !integration.configured || !isMode(input.mode)) throw new Error('SNAPSHOT_INTEGRATION_UNAVAILABLE')
    const requestId = this.requestId()
    const requestedAt = this.clock().toISOString()
    const state: SnapshotState = input.mode === 'next-interaction' ? 'waiting' : 'requested'
    this.db.prepare(`INSERT INTO agent_activity_snapshots(request_id,integration_id,mode,requested_at,state)
      VALUES(?,?,?,?,?)`).run(requestId, input.integrationId, input.mode, requestedAt, state)
    return this.getRequired(requestId)
  }

  complete(input: CompleteSnapshotInput): SnapshotReceipt {
    if (!validTimestamp(input.coverageStartedAt) || !validTimestamp(input.coverageEndedAt) || Date.parse(input.coverageEndedAt) < Date.parse(input.coverageStartedAt)) throw new Error('SNAPSHOT_WINDOW_INVALID')
    if (!Number.isSafeInteger(input.assignmentsObserved) || input.assignmentsObserved < 0 || !Number.isSafeInteger(input.gapCount) || input.gapCount < 0) throw new Error('SNAPSHOT_COUNT_INVALID')
    const result = this.db.prepare(`UPDATE agent_activity_snapshots SET coverage_started_at=?,coverage_ended_at=?,
      assignments_observed=?,gap_count=?,state='complete',completed_at=?,failure_code=NULL WHERE request_id=?`)
      .run(input.coverageStartedAt, input.coverageEndedAt, input.assignmentsObserved, input.gapCount, this.clock().toISOString(), input.requestId)
    if (Number(result.changes) !== 1) throw new Error('SNAPSHOT_NOT_FOUND')
    return this.getRequired(input.requestId)
  }

  recordEvent(input: { integrationId: string; requestId: string; mode: SnapshotMode; coverageStartedAt: string }, outcome: string, reasonCode?: string): SnapshotReceipt {
    let current = this.get(input.requestId)
    if (!current) {
      if (!isMode(input.mode) || !validTimestamp(input.coverageStartedAt)) throw new Error('SNAPSHOT_INVALID')
      this.db.prepare(`INSERT INTO agent_activity_snapshots(request_id,integration_id,mode,requested_at,coverage_started_at,state)
        VALUES(?,?,?,?,?,'requested')`).run(input.requestId, input.integrationId, input.mode, this.clock().toISOString(), input.coverageStartedAt)
      current = this.getRequired(input.requestId)
    }
    if (current.integrationId !== input.integrationId || current.mode !== input.mode) throw new Error('SNAPSHOT_MISMATCH')
    if (current.state === 'complete') return current
    if (outcome === 'applied' || outcome === 'duplicate') {
      const observed = Math.max(1, current.assignmentsObserved)
      this.db.prepare(`UPDATE agent_activity_snapshots SET coverage_started_at=COALESCE(coverage_started_at,?),coverage_ended_at=?,
        assignments_observed=?,state='complete',completed_at=?,failure_code=NULL WHERE request_id=?`)
        .run(input.coverageStartedAt, this.clock().toISOString(), observed, this.clock().toISOString(), input.requestId)
    } else if (outcome === 'gap') {
      this.db.prepare(`UPDATE agent_activity_snapshots SET coverage_started_at=COALESCE(coverage_started_at,?),gap_count=gap_count+1,state='waiting',failure_code='SEQUENCE_GAP' WHERE request_id=?`)
        .run(input.coverageStartedAt, input.requestId)
    } else {
      this.db.prepare(`UPDATE agent_activity_snapshots SET state='failed',completed_at=?,failure_code=? WHERE request_id=?`)
        .run(this.clock().toISOString(), safeFailure(reasonCode), input.requestId)
    }
    return this.getRequired(input.requestId)
  }

  get(requestId: string): SnapshotReceipt | undefined {
    const row = this.db.prepare(`SELECT request_id,integration_id,mode,requested_at,coverage_started_at,coverage_ended_at,
      assignments_observed,gap_count,state,completed_at,failure_code FROM agent_activity_snapshots WHERE request_id=?`).get(requestId) as Record<string, unknown> | undefined
    return row ? receipt(row) : undefined
  }

  private getRequired(requestId: string): SnapshotReceipt {
    const result = this.get(requestId)
    if (!result) throw new Error('SNAPSHOT_NOT_FOUND')
    return result
  }
}

function receipt(row: Record<string, unknown>): SnapshotReceipt {
  const mode = String(row.mode) as SnapshotMode
  const count = Number(row.assignments_observed)
  return {
    requestId: String(row.request_id), integrationId: String(row.integration_id), mode,
    requestedAt: String(row.requested_at), coverageStartedAt: row.coverage_started_at ? String(row.coverage_started_at) : null,
    coverageEndedAt: row.coverage_ended_at ? String(row.coverage_ended_at) : null, assignmentsObserved: count,
    gapCount: Number(row.gap_count), state: String(row.state) as SnapshotState,
    completedAt: row.completed_at ? String(row.completed_at) : null, failureCode: row.failure_code ? String(row.failure_code) : null,
    limitation: `${count} assignment${count === 1 ? '' : 's'} observed in this ${mode} snapshot; this does not establish that no other work exists on this computer.`,
  }
}

function isMode(value: unknown): value is SnapshotMode { return value === 'current-session' || value === 'next-interaction' || value === 'explicit-report' }
function validTimestamp(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) }
function safeFailure(value: string | undefined): string { return value && /^[A-Z0-9_:-]{1,64}$/.test(value) ? value : 'SNAPSHOT_REJECTED' }
