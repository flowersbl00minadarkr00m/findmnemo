import type { FindMnemoDatabase } from '../db/database.js'

export interface AgentActivityRetentionResult {
  appliedBefore: number
  appliedAfter: number
  deleted: number
  pendingDepth: number
  retainedTotal: number
  completedAt: string
}

interface RetentionOptions {
  maxAppliedEvents?: number
  clock?: () => Date
}

export class AgentActivityRetentionService {
  private readonly database: FindMnemoDatabase
  private readonly maxAppliedEvents: number
  private readonly clock: () => Date

  constructor(database: FindMnemoDatabase, options: RetentionOptions = {}) {
    this.database = database
    this.maxAppliedEvents = Math.max(1, Math.floor(options.maxAppliedEvents ?? 10_000))
    this.clock = options.clock ?? (() => new Date())
  }

  prune(): AgentActivityRetentionResult {
    const completedAt = this.clock().toISOString()
    try {
      return this.database.transaction(() => {
        const appliedBefore = this.count("apply_state='applied'")
        const deleted = Number(this.database.db.prepare(`DELETE FROM agent_assignment_events
          WHERE apply_state='applied'
            AND event_id NOT IN (
              SELECT event_id FROM agent_assignment_events WHERE apply_state='applied'
              ORDER BY received_at DESC,event_id DESC LIMIT ?
            )
            AND event_id NOT IN (SELECT last_event_id FROM agent_assignments)
            AND event_id NOT IN (
              SELECT a.last_event_id FROM agent_assignments a
              JOIN agent_project_reviews r ON r.assignment_key=a.assignment_key
              WHERE r.state='pending'
            )
            AND event_id NOT IN (
              SELECT last_event_id FROM agent_assignments
              WHERE terminal_outcome IS NOT NULL AND terminal_evidence_kind IS NOT NULL
            )`).run(this.maxAppliedEvents).changes)
        const appliedAfter = this.count("apply_state='applied'")
        const pendingDepth = this.count("apply_state='pending-gap'")
        const retainedTotal = this.count('1=1')
        this.database.db.prepare(`UPDATE agent_activity_runtime SET last_retention_at=?,last_retention_failure_code=NULL,updated_at=? WHERE singleton_id=1`).run(completedAt, completedAt)
        return { appliedBefore, appliedAfter, deleted, pendingDepth, retainedTotal, completedAt }
      })
    } catch (cause) {
      this.database.db.prepare(`UPDATE agent_activity_runtime SET last_retention_failure_code='ACTIVITY_RETENTION_FAILED',updated_at=? WHERE singleton_id=1`).run(completedAt)
      throw cause
    }
  }

  private count(where: string): number {
    return Number((this.database.db.prepare(`SELECT COUNT(*) AS count FROM agent_assignment_events WHERE ${where}`).get() as { count: number }).count)
  }
}
