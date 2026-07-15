import type { DatabaseSync } from 'node:sqlite'

type QueueAgeBucket = 'empty' | 'under-1m' | 'under-5m' | 'under-1h' | 'under-1d' | 'one-day-or-more'

export interface AgentActivityDiagnosticSnapshot {
  schema: 'findmnemo.agent-activity-diagnostics.v1'
  generatedAt: string
  capture: { enabled: boolean; rolloutState: 'disabled' | 'enabled' | 'rolling-back' }
  events: { retained: number; applied: number; pendingDepth: number; receiptCodes: Record<string, number>; queueAgeBucket: QueueAgeBucket }
  staleAssignmentCount: number
  snapshots: Record<string, number>
  mappingReviewCount: number
  retention: { lastRunAt: string | null; failureCode: string | null }
  integrations: Array<{ agent: 'codex-cli' | 'claude-code' | 'pi'; adapterVersion: string; supportLevel: string; enabled: boolean; lastSuccessAt: string | null; lastFailureCode: string | null }>
}

export class AgentActivityDiagnosticsService {
  private readonly db: DatabaseSync
  private readonly clock: () => Date
  constructor(db: DatabaseSync, clock: () => Date = () => new Date()) { this.db = db; this.clock = clock }

  snapshot(): AgentActivityDiagnosticSnapshot {
    const now = this.clock()
    const runtime = this.db.prepare('SELECT capture_enabled,rollout_state,last_retention_at,last_retention_failure_code FROM agent_activity_runtime WHERE singleton_id=1').get() as Record<string, unknown>
    const counts = this.db.prepare(`SELECT COUNT(*) AS retained,
      SUM(CASE WHEN apply_state='applied' THEN 1 ELSE 0 END) AS applied,
      SUM(CASE WHEN apply_state='pending-gap' THEN 1 ELSE 0 END) AS pending FROM agent_assignment_events`).get() as Record<string, unknown>
    const receiptRows = this.db.prepare(`SELECT receipt_code,COUNT(*) AS count FROM agent_assignment_events
      WHERE receipt_code IS NOT NULL GROUP BY receipt_code ORDER BY receipt_code`).all() as Array<Record<string, unknown>>
    const snapshotRows = this.db.prepare('SELECT state,COUNT(*) AS count FROM agent_activity_snapshots GROUP BY state ORDER BY state').all() as Array<Record<string, unknown>>
    const oldestPending = this.db.prepare("SELECT MIN(received_at) AS oldest FROM agent_assignment_events WHERE apply_state='pending-gap'").get() as { oldest?: string | null }
    const integrations = this.db.prepare(`SELECT agent_kind,adapter_version,support_level,enabled,last_success_at,last_failure_code
      FROM agent_activity_integrations WHERE id LIKE 'auto:%' ORDER BY agent_kind`).all() as Array<Record<string, unknown>>
    return {
      schema: 'findmnemo.agent-activity-diagnostics.v1', generatedAt: now.toISOString(),
      capture: { enabled: Boolean(runtime.capture_enabled), rolloutState: String(runtime.rollout_state) as AgentActivityDiagnosticSnapshot['capture']['rolloutState'] },
      events: {
        retained: Number(counts.retained ?? 0), applied: Number(counts.applied ?? 0), pendingDepth: Number(counts.pending ?? 0),
        receiptCodes: Object.fromEntries(receiptRows.map((row) => [safeCode(row.receipt_code), Number(row.count)])),
        queueAgeBucket: ageBucket(oldestPending.oldest ?? null, now),
      },
      staleAssignmentCount: Number((this.db.prepare("SELECT COUNT(*) AS count FROM agent_assignments WHERE terminal_outcome IS NULL AND fresh_until IS NOT NULL AND fresh_until<?").get(now.toISOString()) as { count: number }).count),
      snapshots: Object.fromEntries(snapshotRows.map((row) => [safeCode(row.state), Number(row.count)])),
      mappingReviewCount: Number((this.db.prepare("SELECT COUNT(*) AS count FROM agent_project_reviews WHERE state='pending'").get() as { count: number }).count),
      retention: { lastRunAt: runtime.last_retention_at ? String(runtime.last_retention_at) : null, failureCode: runtime.last_retention_failure_code ? safeCode(runtime.last_retention_failure_code) : null },
      integrations: integrations.map((row) => ({
        agent: String(row.agent_kind) as 'codex-cli' | 'claude-code' | 'pi', adapterVersion: safeVersion(row.adapter_version), supportLevel: safeCode(row.support_level), enabled: Boolean(row.enabled),
        lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null, lastFailureCode: row.last_failure_code ? safeCode(row.last_failure_code) : null,
      })),
    }
  }
}

function ageBucket(oldest: string | null, now: Date): QueueAgeBucket {
  if (!oldest) return 'empty'
  const age = Math.max(0, now.getTime() - Date.parse(oldest))
  if (age < 60_000) return 'under-1m'
  if (age < 5 * 60_000) return 'under-5m'
  if (age < 60 * 60_000) return 'under-1h'
  if (age < 24 * 60 * 60_000) return 'under-1d'
  return 'one-day-or-more'
}
function safeCode(value: unknown): string { const result = String(value ?? '').toUpperCase(); return /^[A-Z0-9_-]{1,64}$/.test(result) ? result : 'REDACTED' }
function safeVersion(value: unknown): string { const result = String(value ?? ''); return /^[A-Za-z0-9._-]{1,32}$/.test(result) ? result : 'redacted' }
