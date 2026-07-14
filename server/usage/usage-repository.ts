import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  assertNormalizedUsageRecordDto,
  assertUsageBoundarySafe,
  type NormalizedUsageRecordDto,
  type UsageAttributionRecordDto,
  type UsageCoverageDto,
  type UsageRefreshRunDto,
  type OperationalRoutingPolicy,
  type UsageAggregateMetricDto,
  type UsageBreakdownDto,
  type UsageManualMappingDto,
  type UsageQueryDto,
  type UsageRecordsPageDto,
  type UsageRouteObservationDto,
  type UsageSummaryDto,
} from '../../shared/companion-contract.js'
import { opaqueUsageIdentity, usageIdentityKey } from './usage-mapping.js'

export interface UsageCommandEvidence {
  recipeId: string
  state: 'complete' | 'failed' | 'skipped'
  durationMs: number
  recordCount: number | null
  errorCode: string | null
}

export interface CommitUsageSnapshotInput {
  runId: string
  requestedAt: string
  finishedAt: string
  state: 'complete' | 'partial'
  coverageStart: string
  coverageEnd: string
  tokscaleVersion: string
  adapterId: string
  records: NormalizedUsageRecordDto[]
  attribution: UsageAttributionRecordDto[]
  coverage: UsageCoverageDto
  commands: UsageCommandEvidence[]
  conflictIds: string[]
}

export interface UsageStoredBounds {
  periodStart: string | null
  periodEnd: string | null
  lastSuccessfulRefreshAt: string | null
  lastSuccessRunId: string | null
}

export class UsageRepository {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) { this.db = db }

  opaqueIdentity(rawIdentity: string): string {
    return opaqueUsageIdentity(rawIdentity, this.identitySalt())
  }

  recordStart(run: Pick<UsageRefreshRunDto, 'id' | 'requestedAt' | 'coverageStart' | 'coverageEnd'>): void {
    assertUsageBoundarySafe(run)
    this.db.prepare(`INSERT INTO usage_refresh_runs(id,requested_at,state,coverage_start,coverage_end) VALUES(?,?,'requested',?,?)`)
      .run(run.id, run.requestedAt, run.coverageStart, run.coverageEnd)
  }

  updateRunStage(runId: string, state: Extract<UsageRefreshRunDto['state'], 'detecting' | 'collecting' | 'normalizing' | 'committing'>): void {
    this.db.prepare('UPDATE usage_refresh_runs SET state=? WHERE id=?').run(state, runId)
  }

  getRefreshRun(runId: string): UsageRefreshRunDto | null {
    const row = this.db.prepare('SELECT * FROM usage_refresh_runs WHERE id=?').get(runId) as Record<string, unknown> | undefined
    if (!row) return null
    const state = String(row.state) as UsageRefreshRunDto['state']
    const lastSuccess = this.bounds().lastSuccessfulRefreshAt
    const commandRows = this.db.prepare('SELECT * FROM usage_command_outcomes WHERE run_id=? ORDER BY rowid').all(runId) as Array<Record<string, unknown>>
    return {
      schema: 'findmnemo.usage-refresh.v1', id: String(row.id), state,
      stage: ['complete', 'partial', 'failed', 'cancelled'].includes(state) ? 'finished' : state === 'detecting' ? 'capability-check' : state === 'normalizing' ? 'normalization' : state === 'committing' ? 'commit' : state === 'collecting' ? 'canonical-usage' : 'requested',
      requestedAt: String(row.requested_at), finishedAt: row.finished_at === null ? null : String(row.finished_at), coverageStart: String(row.coverage_start), coverageEnd: String(row.coverage_end),
      commands: commandRows.map((command) => ({ recipeId: String(command.recipe_id) as UsageRefreshRunDto['commands'][number]['recipeId'], state: String(command.state) as UsageRefreshRunDto['commands'][number]['state'], durationMs: Number(command.duration_ms), recordCount: command.record_count === null ? null : Number(command.record_count), errorCode: command.error_code === null ? null : String(command.error_code) })),
      canonicalCount: Number(row.canonical_count), attributionCount: Number(row.attribution_count), warningCodes: JSON.parse(String(row.warnings_json)) as string[], errorCode: row.error_code === null ? null : String(row.error_code),
      lastSuccessfulRefreshAt: lastSuccess, retainedPreviousSuccess: (state === 'failed' || state === 'cancelled') && lastSuccess !== null,
    }
  }

  commitSnapshot(input: CommitUsageSnapshotInput): { canonicalCount: number; attributionCount: number; replayed: boolean } {
    validateSnapshot(input)
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT state,canonical_count,attribution_count FROM usage_refresh_runs WHERE id=?').get(input.runId) as Record<string, unknown> | undefined
      if (existing && (existing.state === 'complete' || existing.state === 'partial')) {
        return { canonicalCount: Number(existing.canonical_count), attributionCount: Number(existing.attribution_count), replayed: true }
      }
      if (existing) this.db.prepare('DELETE FROM usage_refresh_runs WHERE id=?').run(input.runId)
      this.db.prepare(`INSERT INTO usage_refresh_runs(id,requested_at,finished_at,state,coverage_start,coverage_end,tokscale_version,adapter_id,canonical_count,attribution_count,warning_count,warnings_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.runId, input.requestedAt, input.finishedAt, input.state, input.coverageStart, input.coverageEnd, input.tokscaleVersion, input.adapterId, input.records.length, input.attribution.length, input.coverage.warnings.length, JSON.stringify(input.coverage.warnings))

      this.db.prepare('DELETE FROM usage_canonical_records WHERE period_start<=? AND period_end>=?').run(input.coverageEnd, input.coverageStart)
      this.db.prepare('DELETE FROM usage_attribution_records WHERE coverage_start<=? AND coverage_end>=?').run(input.coverageEnd, input.coverageStart)
      const insertCanonical = this.db.prepare(`INSERT INTO usage_canonical_records(id,refresh_run_id,period_start,period_end,client_id,provider_id,model_id,profile_id,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,total_tokens,cost,currency,record_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for (const record of input.records) {
        insertCanonical.run(record.id, input.runId, record.periodStart, record.periodEnd, record.clientId, record.providerId, record.modelId, record.routeMapping.profileId, record.inputTokens.value, record.outputTokens.value, record.cacheReadTokens.value, record.cacheWriteTokens.value, record.reasoningTokens.value, record.totalTokens.value, record.cost.value, record.currency, JSON.stringify(record))
      }
      const insertAttribution = this.db.prepare(`INSERT INTO usage_attribution_records(id,refresh_run_id,role,coverage_start,coverage_end,client_id,provider_id,model_id,opaque_subject_id,record_json) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      for (const record of input.attribution) {
        insertAttribution.run(record.id, input.runId, record.role, input.coverageStart, input.coverageEnd, record.clientId, record.providerId, record.modelId, record.opaqueSubjectId, JSON.stringify(record))
      }
      const insertCoverage = this.db.prepare('INSERT INTO usage_source_coverage(run_id,client_id,state,message_count,diagnostic_codes_json) VALUES(?,?,?,?,?)')
      for (const source of input.coverage.sources) insertCoverage.run(input.runId, source.clientId, source.state, source.messageCount, JSON.stringify(source.diagnosticCodes))
      const insertCommand = this.db.prepare('INSERT INTO usage_command_outcomes(run_id,recipe_id,state,duration_ms,record_count,error_code) VALUES(?,?,?,?,?,?)')
      for (const command of input.commands) insertCommand.run(input.runId, command.recipeId, command.state, command.durationMs, command.recordCount, command.errorCode)
      const insertConflict = this.db.prepare('INSERT INTO usage_duplicate_conflicts(run_id,record_id) VALUES(?,?)')
      for (const conflictId of input.conflictIds) insertConflict.run(input.runId, conflictId)
      this.db.prepare('UPDATE usage_state SET last_success_run_id=?,last_success_at=? WHERE singleton_id=1').run(input.runId, input.finishedAt)
      this.prune(input.finishedAt)
      return { canonicalCount: input.records.length, attributionCount: input.attribution.length, replayed: false }
    })
  }

  recordFailure(input: { runId: string; requestedAt: string; finishedAt: string; coverageStart: string; coverageEnd: string; errorCode: string; state?: 'failed' | 'cancelled'; commands?: UsageCommandEvidence[]; warningCodes?: string[] }): void {
    assertUsageBoundarySafe(input)
    const state = input.state ?? 'failed'
    this.transaction(() => {
      this.db.prepare(`INSERT INTO usage_refresh_runs(id,requested_at,finished_at,state,coverage_start,coverage_end,error_code,warning_count,warnings_json)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at,state=excluded.state,error_code=excluded.error_code,warning_count=excluded.warning_count,warnings_json=excluded.warnings_json`)
        .run(input.runId, input.requestedAt, input.finishedAt, state, input.coverageStart, input.coverageEnd, input.errorCode, input.warningCodes?.length ?? 0, JSON.stringify(input.warningCodes ?? []))
      this.db.prepare('DELETE FROM usage_command_outcomes WHERE run_id=?').run(input.runId)
      const insert = this.db.prepare('INSERT INTO usage_command_outcomes(run_id,recipe_id,state,duration_ms,record_count,error_code) VALUES(?,?,?,?,?,?)')
      for (const command of input.commands ?? []) insert.run(input.runId, command.recipeId, command.state, command.durationMs, command.recordCount, command.errorCode)
    })
  }

  listCanonicalRecords(input: { start?: string; end?: string; limit?: number } = {}): NormalizedUsageRecordDto[] {
    const limit = Math.max(1, Math.min(5_000, input.limit ?? 1_000))
    const rows = this.db.prepare(`SELECT record_json FROM usage_canonical_records
      WHERE (? IS NULL OR period_end>=?) AND (? IS NULL OR period_start<=?) ORDER BY period_start DESC,id LIMIT ?`)
      .all(input.start ?? null, input.start ?? null, input.end ?? null, input.end ?? null, limit) as Array<{ record_json: string }>
    return rows.map((row) => {
      const record: unknown = JSON.parse(row.record_json)
      assertNormalizedUsageRecordDto(record)
      return record
    })
  }

  queryRecords(filters: UsageQueryDto, policy: OperationalRoutingPolicy | null, cursor = '0', limit = 100): UsageRecordsPageDto {
    const records = this.filteredMappedRecords(filters, policy)
    const offset = /^\d+$/.test(cursor) ? Number(cursor) : 0
    const boundedLimit = Math.max(1, Math.min(500, limit))
    return { schema: 'findmnemo.usage-records.v1', records: records.slice(offset, offset + boundedLimit), nextCursor: offset + boundedLimit < records.length ? String(offset + boundedLimit) : null, totalCount: records.length }
  }

  summary(filters: UsageQueryDto, policy: OperationalRoutingPolicy | null): UsageSummaryDto {
    const records = this.filteredMappedRecords(filters, policy)
    const coverage = this.latestCoverage()
    const bounds = this.bounds()
    const conflicts = this.db.prepare('SELECT count(*) AS count FROM usage_duplicate_conflicts').get() as { count: number }
    return {
      schema: 'findmnemo.usage-summary.v1', filters, recordCount: records.length,
      totalTokens: aggregate(records.map((record) => record.totalTokens.value)), inputTokens: aggregate(records.map((record) => record.inputTokens.value)), outputTokens: aggregate(records.map((record) => record.outputTokens.value)),
      cacheReadTokens: aggregate(records.map((record) => record.cacheReadTokens.value)), cacheWriteTokens: aggregate(records.map((record) => record.cacheWriteTokens.value)), reasoningTokens: aggregate(records.map((record) => record.reasoningTokens.value)), cost: aggregate(records.map((record) => record.cost.value)),
      currencies: [...new Set(records.flatMap((record) => record.currency ? [record.currency] : []))].sort(),
      trends: { day: trend(records, 'day'), week: trend(records, 'week'), month: trend(records, 'month') },
      breakdowns: { clients: breakdown(records, (record) => record.clientId), providers: breakdown(records, (record) => record.providerId ?? 'unknown-provider'), models: breakdown(records, (record) => record.modelId) },
      coverage, freshness: { state: bounds.lastSuccessfulRefreshAt ? 'current' : 'never-refreshed', lastSuccessfulRefreshAt: bounds.lastSuccessfulRefreshAt, upstreamGeneratedAt: null },
      duplicateConflictCount: Number(conflicts.count), warnings: [...(coverage?.warnings ?? []), ...(conflicts.count > 0 ? ['duplicate-conflict'] : [])],
    }
  }

  listManualMappings(policy: OperationalRoutingPolicy | null): UsageManualMappingDto[] {
    const profiles = new Set(policy?.profiles.map((profile) => profile.id) ?? [])
    const rows = this.db.prepare('SELECT * FROM usage_route_mappings ORDER BY updated_at DESC,identity_key').all() as Array<Record<string, unknown>>
    return rows.map((row) => ({ identityKey: String(row.identity_key), clientId: String(row.client_id), providerId: row.provider_id === null ? null : String(row.provider_id), modelId: String(row.model_id), profileId: String(row.profile_id), state: profiles.has(String(row.profile_id)) ? 'manual' : 'target-missing', createdAt: String(row.created_at), updatedAt: String(row.updated_at) }))
  }

  saveManualMapping(identity: { clientId: string; providerId: string | null; modelId: string }, profileId: string, policy: OperationalRoutingPolicy, timestamp: string): UsageManualMappingDto {
    if (!policy.profiles.some((profile) => profile.id === profileId)) throw new Error('USAGE_MAPPING_TARGET_MISSING')
    const identityKey = usageIdentityKey(identity)
    assertUsageBoundarySafe({ ...identity, profileId, timestamp })
    this.db.prepare(`INSERT INTO usage_route_mappings(identity_key,client_id,provider_id,model_id,profile_id,source,created_at,updated_at) VALUES(?,?,?,?,?,'manual',?,?)
      ON CONFLICT(identity_key) DO UPDATE SET client_id=excluded.client_id,provider_id=excluded.provider_id,model_id=excluded.model_id,profile_id=excluded.profile_id,source='manual',updated_at=excluded.updated_at`)
      .run(identityKey, identity.clientId, identity.providerId, identity.modelId, profileId, timestamp, timestamp)
    return this.listManualMappings(policy).find((mapping) => mapping.identityKey === identityKey) as UsageManualMappingDto
  }

  removeManualMapping(identityKey: string): boolean {
    if (!/^model_[a-f0-9]{64}$/.test(identityKey)) throw new Error('USAGE_MAPPING_INVALID')
    return Number(this.db.prepare('DELETE FROM usage_route_mappings WHERE identity_key=?').run(identityKey).changes) > 0
  }

  routeObservations(filters: UsageQueryDto, policy: OperationalRoutingPolicy): UsageRouteObservationDto[] {
    const records = this.filteredMappedRecords(filters, policy)
    const coverageComplete = this.latestCoverage()?.complete ?? false
    const bounds = this.bounds()
    const byProfile = new Map(policy.profiles.map((profile) => [profile.id, records.filter((record) => record.routeMapping.profileId === profile.id)]))
    const maxTokens = Math.max(0, ...[...byProfile.values()].map((items) => items.reduce((sum, item) => sum + (item.totalTokens.value ?? 0), 0)))
    const totalCost = records.reduce((sum, item) => sum + (item.cost.value ?? 0), 0)
    return policy.profiles.flatMap((profile): UsageRouteObservationDto[] => {
      const items = byProfile.get(profile.id) ?? []
      const configuredButUnmapped = records.filter((record) => record.routeMapping.state === 'unmapped' && record.providerId === profile.providerId && record.modelId === profile.modelId)
      const tokens = items.some((item) => item.totalTokens.value !== null) ? items.reduce((sum, item) => sum + (item.totalTokens.value ?? 0), 0) : null
      const cost = items.some((item) => item.cost.value !== null) ? items.reduce((sum, item) => sum + (item.cost.value ?? 0), 0) : null
      const observation: UsageRouteObservationDto['observation'] | null = !coverageComplete ? 'usage-evidence-incomplete'
        : items.length === 0 ? (configuredButUnmapped.length > 0 ? 'configured-but-unmapped' : 'no-observed-usage')
          : tokens !== null && tokens === maxTokens ? 'most-used-route'
            : cost !== null && totalCost > 0 && cost / totalCost >= 0.5 ? 'high-estimated-cost-concentration' : null
      if (!observation) return []
      return [{ profileId: profile.id, observation, recordCount: items.length, totalTokens: tokens, estimatedCost: cost, coverageComplete, periodStart: bounds.periodStart, periodEnd: bounds.periodEnd }]
    })
  }

  listAttribution(limit = 1_000): UsageAttributionRecordDto[] {
    const rows = this.db.prepare('SELECT record_json FROM usage_attribution_records ORDER BY coverage_end DESC,id LIMIT ?').all(Math.max(1, Math.min(5_000, limit))) as Array<{ record_json: string }>
    return rows.map((row) => JSON.parse(row.record_json) as UsageAttributionRecordDto)
  }

  latestCoverage(): UsageCoverageDto | null {
    const state = this.db.prepare('SELECT last_success_run_id FROM usage_state WHERE singleton_id=1').get() as { last_success_run_id?: string | null } | undefined
    if (!state?.last_success_run_id) return null
    const run = this.db.prepare('SELECT * FROM usage_refresh_runs WHERE id=?').get(state.last_success_run_id) as Record<string, unknown>
    const sources = this.db.prepare('SELECT * FROM usage_source_coverage WHERE run_id=? ORDER BY client_id').all(state.last_success_run_id) as Array<Record<string, unknown>>
    return {
      schema: 'findmnemo.usage-coverage.v1', tokscaleVersion: String(run.tokscale_version), adapterId: String(run.adapter_id), refreshedAt: String(run.finished_at),
      sources: sources.map((source) => ({ clientId: String(source.client_id), state: String(source.state) as 'available' | 'unavailable' | 'failed', messageCount: source.message_count === null ? null : Number(source.message_count), diagnosticCodes: JSON.parse(String(source.diagnostic_codes_json)) as string[] })),
      complete: String(run.state) === 'complete', warnings: JSON.parse(String(run.warnings_json)) as string[],
    }
  }

  bounds(): UsageStoredBounds {
    const periods = this.db.prepare('SELECT min(period_start) AS period_start,max(period_end) AS period_end FROM usage_canonical_records').get() as Record<string, unknown>
    const state = this.db.prepare('SELECT last_success_run_id,last_success_at FROM usage_state WHERE singleton_id=1').get() as Record<string, unknown>
    return {
      periodStart: periods.period_start === null ? null : String(periods.period_start),
      periodEnd: periods.period_end === null ? null : String(periods.period_end),
      lastSuccessfulRefreshAt: state.last_success_at === null ? null : String(state.last_success_at),
      lastSuccessRunId: state.last_success_run_id === null ? null : String(state.last_success_run_id),
    }
  }

  clearHistory(): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM usage_refresh_runs').run()
      this.db.prepare('UPDATE usage_state SET last_success_run_id=NULL,last_success_at=NULL WHERE singleton_id=1').run()
    })
  }

  clearMappings(): void {
    this.db.prepare('DELETE FROM usage_route_mappings').run()
  }

  exportSnapshot(filters: UsageQueryDto, policy: OperationalRoutingPolicy | null, includeAttribution: boolean) {
    return { filters, bounds: this.bounds(), coverage: this.latestCoverage(), records: this.filteredMappedRecords(filters, policy), attribution: includeAttribution ? this.listAttribution(5_000) : [], mappings: this.listManualMappings(policy) }
  }

  private filteredMappedRecords(filters: UsageQueryDto, policy: OperationalRoutingPolicy | null): NormalizedUsageRecordDto[] {
    const clauses: string[] = []
    const parameters: Array<string | null> = []
    if (filters.start) { clauses.push('period_end>=?'); parameters.push(filters.start) }
    if (filters.end) { clauses.push('period_start<=?'); parameters.push(filters.end) }
    if (filters.clientId) { clauses.push('client_id=?'); parameters.push(filters.clientId) }
    if (filters.providerId) { clauses.push('provider_id=?'); parameters.push(filters.providerId) }
    if (filters.modelId) { clauses.push('model_id=?'); parameters.push(filters.modelId) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.prepare(`SELECT record_json FROM usage_canonical_records ${where} ORDER BY period_start DESC,id LIMIT 50000`).all(...parameters) as Array<{ record_json: string }>
    const manual = new Map(this.listManualMappings(policy).map((mapping) => [mapping.identityKey, mapping]))
    const profiles = policy?.profiles ?? []
    const mapped = rows.map((row) => {
      const record = JSON.parse(row.record_json) as NormalizedUsageRecordDto
      const key = usageIdentityKey(record)
      const explicit = manual.get(key)
      if (explicit) return { ...record, routeMapping: { state: explicit.state === 'manual' ? 'manual' as const : 'target-missing' as const, profileId: explicit.profileId, source: 'manual' as const, mappedAt: explicit.updatedAt } }
      const exact = profiles.filter((profile) => profile.providerId === record.providerId && profile.modelId === record.modelId)
      const disambiguated = exact.length > 1 ? exact.filter((profile) => profile.destinationAdapterId === record.clientId) : exact
      if (disambiguated.length === 1) return { ...record, routeMapping: { state: 'automatic' as const, profileId: disambiguated[0].id, source: 'exact' as const, mappedAt: null } }
      return record
    })
    return mapped.filter((record) => (!filters.profileId || record.routeMapping.profileId === filters.profileId) && (!filters.mappingState || record.routeMapping.state === filters.mappingState))
  }

  private identitySalt(): Buffer {
    const existing = this.db.prepare('SELECT hmac_salt_hex FROM usage_identity_config WHERE singleton_id=1').get() as { hmac_salt_hex?: string } | undefined
    if (existing?.hmac_salt_hex) return Buffer.from(existing.hmac_salt_hex, 'hex')
    const salt = randomBytes(32)
    this.db.prepare('INSERT INTO usage_identity_config(singleton_id,hmac_salt_hex) VALUES(1,?)').run(salt.toString('hex'))
    return salt
  }

  private prune(referenceTimestamp: string): void {
    const cutoff = new Date(referenceTimestamp)
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 12)
    const cutoffDate = cutoff.toISOString().slice(0, 10)
    this.db.prepare('DELETE FROM usage_canonical_records WHERE period_end<?').run(cutoffDate)
    this.db.prepare('DELETE FROM usage_attribution_records WHERE coverage_end<?').run(cutoffDate)
    this.db.prepare(`DELETE FROM usage_refresh_runs WHERE finished_at<? AND id<>(SELECT last_success_run_id FROM usage_state WHERE singleton_id=1)
      AND NOT EXISTS(SELECT 1 FROM usage_canonical_records WHERE refresh_run_id=usage_refresh_runs.id)
      AND NOT EXISTS(SELECT 1 FROM usage_attribution_records WHERE refresh_run_id=usage_refresh_runs.id)`).run(cutoff.toISOString())
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result } catch (cause) { this.db.exec('ROLLBACK'); throw cause }
  }
}

function validateSnapshot(input: CommitUsageSnapshotInput): void {
  assertUsageBoundarySafe(input)
  if (!input.runId || !input.adapterId || !input.tokscaleVersion || !Number.isFinite(Date.parse(input.finishedAt))) throw new Error('USAGE_SNAPSHOT_INVALID')
  for (const record of input.records) assertNormalizedUsageRecordDto(record)
  for (const record of input.attribution) {
    if (record.additive !== false || !record.opaqueSubjectId || record.localLabel !== null) throw new Error('USAGE_ATTRIBUTION_INVALID')
  }
}

function aggregate(values: Array<number | null>): UsageAggregateMetricDto {
  const known = values.filter((value): value is number => value !== null)
  const unknownRecordCount = values.length - known.length
  return {
    value: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    knownRecordCount: known.length,
    unknownRecordCount,
    state: known.length === 0 ? 'unknown' : unknownRecordCount > 0 ? 'partial' : 'complete',
  }
}

function breakdown(records: NormalizedUsageRecordDto[], keyFor: (record: NormalizedUsageRecordDto) => string): UsageBreakdownDto[] {
  const groups = new Map<string, NormalizedUsageRecordDto[]>()
  for (const record of records) groups.set(keyFor(record), [...(groups.get(keyFor(record)) ?? []), record])
  return [...groups.entries()].map(([key, items]) => ({ key, label: key, recordCount: items.length, totalTokens: aggregate(items.map((item) => item.totalTokens.value)), cost: aggregate(items.map((item) => item.cost.value)) }))
    .sort((left, right) => (right.totalTokens.value ?? -1) - (left.totalTokens.value ?? -1) || left.key.localeCompare(right.key))
}

function trend(records: NormalizedUsageRecordDto[], granularity: 'day' | 'week' | 'month') {
  const period = (date: string) => {
    if (granularity === 'day') return date
    if (granularity === 'month') return date.slice(0, 7)
    const value = new Date(`${date}T00:00:00.000Z`)
    const day = value.getUTCDay() || 7
    value.setUTCDate(value.getUTCDate() - day + 1)
    return value.toISOString().slice(0, 10)
  }
  return breakdown(records, (record) => period(record.periodStart)).map((item) => ({ ...item, periodStart: item.key }))
}
