import type { DatabaseSync } from 'node:sqlite'
import { SurfaceQualificationRegistry } from './qualifications/index.js'

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
  integrations: Array<{
    agentFamily: 'claude' | 'codex' | 'pi'
    executionSurface: 'claude-desktop-code' | 'claude-desktop-home' | 'claude-code-cli' | 'codex-desktop' | 'codex-cli' | 'pi-cli'
    adapterVersion: string
    detectedVersion: string | null
    qualifiedVersions: string[]
    lastQualifiedAt: string | null
    healthState: 'unknown' | 'unavailable' | 'healthy' | 'stale'
    healthCheckedAt: string | null
    lastSuccessAt: string | null
    failureCode: string | null
    pendingCount: number
    gapCount: number
  }>
}

export class AgentActivityDiagnosticsService {
  private readonly db: DatabaseSync
  private readonly clock: () => Date
  private readonly qualifications: SurfaceQualificationRegistry
  constructor(db: DatabaseSync, clock: () => Date = () => new Date(), qualifications = new SurfaceQualificationRegistry()) {
    this.db = db
    this.clock = clock
    this.qualifications = qualifications
  }

  snapshot(): AgentActivityDiagnosticSnapshot {
    const now = this.clock()
    const runtime = this.db.prepare('SELECT capture_enabled,rollout_state,last_retention_at,last_retention_failure_code FROM agent_activity_runtime WHERE singleton_id=1').get() as Record<string, unknown>
    const counts = this.db.prepare(`SELECT COUNT(*) AS retained,
      SUM(CASE WHEN apply_state='applied' THEN 1 ELSE 0 END) AS applied,
      SUM(CASE WHEN apply_state='pending-gap' THEN 1 ELSE 0 END) AS pending FROM agent_assignment_events`).get() as Record<string, unknown>
    const receiptRows = this.db.prepare(`SELECT receipt_code,COUNT(*) AS count FROM agent_assignment_events
      WHERE receipt_code IS NOT NULL GROUP BY receipt_code ORDER BY receipt_code LIMIT 100`).all() as Array<Record<string, unknown>>
    const snapshotRows = this.db.prepare('SELECT state,COUNT(*) AS count FROM agent_activity_snapshots GROUP BY state ORDER BY state').all() as Array<Record<string, unknown>>
    const oldestPending = this.db.prepare("SELECT MIN(received_at) AS oldest FROM agent_assignment_events WHERE apply_state='pending-gap'").get() as { oldest?: string | null }
    return {
      schema: 'findmnemo.agent-activity-diagnostics.v1', generatedAt: now.toISOString(),
      capture: { enabled: Boolean(runtime.capture_enabled), rolloutState: String(runtime.rollout_state) as AgentActivityDiagnosticSnapshot['capture']['rolloutState'] },
      events: {
        retained: boundedCount(counts.retained), applied: boundedCount(counts.applied), pendingDepth: boundedCount(counts.pending),
        receiptCodes: Object.fromEntries(receiptRows.map((row) => [safeCode(row.receipt_code), boundedCount(row.count)])),
        queueAgeBucket: ageBucket(oldestPending.oldest ?? null, now),
      },
      staleAssignmentCount: boundedCount((this.db.prepare("SELECT COUNT(*) AS count FROM agent_assignments WHERE terminal_outcome IS NULL AND fresh_until IS NOT NULL AND fresh_until<?").get(now.toISOString()) as { count: number }).count),
      snapshots: Object.fromEntries(snapshotRows.map((row) => [safeCode(row.state), boundedCount(row.count)])),
      mappingReviewCount: boundedCount((this.db.prepare("SELECT COUNT(*) AS count FROM agent_project_reviews WHERE state='pending'").get() as { count: number }).count),
      retention: { lastRunAt: runtime.last_retention_at ? String(runtime.last_retention_at) : null, failureCode: runtime.last_retention_failure_code ? safeCode(runtime.last_retention_failure_code) : null },
      integrations: this.qualifications.list().map((module) => {
        const pendingCount = boundedCount((this.db.prepare(`SELECT COUNT(*) AS count FROM agent_assignment_events e
          JOIN agent_assignments a ON a.assignment_key=e.assignment_key
          WHERE a.integration_id=? AND e.apply_state='pending-gap'`).get(module.integrationId) as { count: number }).count)
        const gapCount = boundedCount((this.db.prepare('SELECT COALESCE(SUM(gap_count),0) AS count FROM agent_activity_snapshots WHERE integration_id=?').get(module.integrationId) as { count: number }).count)
        return {
          agentFamily: module.agentFamily,
          executionSurface: module.executionSurface,
          adapterVersion: safeVersion(module.adapterVersion),
          detectedVersion: module.detection.detectedVersion ? safeVersion(module.detection.detectedVersion) : null,
          qualifiedVersions: module.qualification.qualifiedVersions.map(safeVersion),
          lastQualifiedAt: module.qualification.lastQualifiedAt,
          healthState: module.health.state,
          healthCheckedAt: module.health.checkedAt,
          lastSuccessAt: module.health.lastSuccessAt,
          failureCode: module.health.failureCode ? safeCode(module.health.failureCode) : null,
          pendingCount,
          gapCount,
        }
      }),
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
function boundedCount(value: unknown): number { return Math.min(10_000, Math.max(0, Number(value ?? 0))) }
