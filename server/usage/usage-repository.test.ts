import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { NormalizedUsageRecordDto, UsageAttributionRecordDto, UsageCoverageDto, UsageMetricDto } from '../../shared/companion-contract.js'
import { DATABASE_SCHEMA_VERSION, openFindMnemoDatabase } from '../db/database.js'
import { UsageRepository, type CommitUsageSnapshotInput } from './usage-repository.js'
import type { OperationalRoutingPolicy, UsageQueryDto } from '../../shared/companion-contract.js'
import { RoutingRepository } from '../routing/routing-repository.js'
import { usageIdentityKey } from './usage-mapping.js'

const cleanup: string[] = []
const timestamp = '2026-07-13T12:00:00.000Z'
const reported = (value: number): UsageMetricDto => ({ value, state: 'reported', reason: 'upstream-reported' })
const unknown = (): UsageMetricDto => ({ value: null, state: 'unknown', reason: 'field-absent' })

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function database() {
  const directory = await mkdtemp(join(tmpdir(), 'findmnemo-usage-repository-'))
  cleanup.push(directory)
  const path = join(directory, 'findmnemo.db')
  return { path, database: await openFindMnemoDatabase({ path }) }
}

function canonical(id: string, periodStart: string, tokens = 100): NormalizedUsageRecordDto {
  return {
    schema: 'findmnemo.usage.v1', id, role: 'canonical-daily', periodStart, periodEnd: periodStart,
    clientId: 'codex', providerId: 'openai', modelId: 'gpt-5', routeMapping: { state: 'unmapped', profileId: null, source: 'none', mappedAt: null },
    inputTokens: reported(tokens), outputTokens: reported(20), cacheReadTokens: reported(0), cacheWriteTokens: reported(0), reasoningTokens: unknown(),
    totalTokens: { value: null, state: 'unknown', reason: 'semantics-unverified' }, cost: { value: 0.25, state: 'estimated', reason: 'upstream-reported' }, currency: null,
    provenance: { sourceCommandId: 'canonical-graph', tokscaleVersion: '4.5.2', adapterId: 'tokscale-v4.4-v4.5', refreshRunId: id, refreshedAt: timestamp, transformations: ['fixture'], duplicateState: 'unique' },
    freshness: { state: 'current', lastSuccessfulRefreshAt: timestamp, upstreamGeneratedAt: null },
  }
}

function attribution(id: string, opaqueSubjectId: string): UsageAttributionRecordDto {
  const metrics = canonical('metrics', '2026-07-13')
  return {
    schema: 'findmnemo.usage-attribution.v1', id, role: 'session-attribution', additive: false, clientId: 'codex', providerId: 'openai', modelId: 'gpt-5',
    opaqueSubjectId, localLabel: null,
    metrics: { inputTokens: metrics.inputTokens, outputTokens: metrics.outputTokens, cacheReadTokens: metrics.cacheReadTokens, cacheWriteTokens: metrics.cacheWriteTokens, reasoningTokens: metrics.reasoningTokens, totalTokens: metrics.totalTokens, cost: metrics.cost, currency: metrics.currency },
    provenance: { ...metrics.provenance, sourceCommandId: 'session-attribution' }, joinState: 'unlinked',
  }
}

function coverage(warnings: string[] = []): UsageCoverageDto {
  return { schema: 'findmnemo.usage-coverage.v1', tokscaleVersion: '4.5.2', adapterId: 'tokscale-v4.4-v4.5', refreshedAt: timestamp, sources: [{ clientId: 'codex', state: 'available', messageCount: 2, diagnosticCodes: [] }], complete: warnings.length === 0, warnings }
}

function snapshot(runId: string, records: NormalizedUsageRecordDto[], opaqueSubjectId = 'usage_opaque'): CommitUsageSnapshotInput {
  return {
    runId, requestedAt: '2026-07-13T11:59:00.000Z', finishedAt: timestamp, state: 'complete', coverageStart: '2026-07-01', coverageEnd: '2026-07-13', tokscaleVersion: '4.5.2', adapterId: 'tokscale-v4.4-v4.5', records,
    attribution: [attribution(`${runId}-attribution`, opaqueSubjectId)], coverage: coverage(), commands: [{ recipeId: 'canonical-graph', state: 'complete', durationMs: 10, recordCount: records.length, errorCode: null }], conflictIds: [],
  }
}

const emptyFilters: UsageQueryDto = { start: null, end: null, clientId: null, providerId: null, modelId: null, profileId: null, mappingState: null }

function policy(): OperationalRoutingPolicy {
  return {
    schemaVersion: '2.0.0', policyProfile: 'findmnemo.model-routing.v2', policyVersion: 1, updatedAt: timestamp,
    capabilities: [{ id: 'writing', family: 'creation', label: 'Writing', description: 'Draft', origin: 'built-in' }],
    profiles: [
      { id: 'route:exact', displayName: 'Exact', destinationAdapterId: 'codex', destinationInstanceId: 'codex:default', providerId: 'openai', modelId: 'gpt-5', effort: null, capabilityIds: ['writing'], enabled: true, behavior: 'recommend', fallbackOrder: 0, readiness: { state: 'unchecked', checkedAt: null, expiresAt: null, adapterVersion: null, installedVersion: null, reasonCode: null } },
      { id: 'route:manual', displayName: 'Manual', destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default', providerId: 'openrouter', modelId: 'anthropic/claude', effort: null, capabilityIds: ['writing'], enabled: true, behavior: 'recommend', fallbackOrder: 1, readiness: { state: 'unchecked', checkedAt: null, expiresAt: null, adapterVersion: null, installedVersion: null, reasonCode: null } },
    ], defaultProfileOrder: ['route:exact', 'route:manual'], capabilityOverrides: [],
  }
}

describe('local usage repository', () => {
  it('atomically stores canonical and non-additive evidence and replaces an overlapping window', async () => {
    const { database: opened } = await database()
    const repository = new UsageRepository(opened.db)
    const first = snapshot('run-1', [canonical('old-overlap', '2026-07-02')])
    expect(repository.commitSnapshot(first)).toEqual({ canonicalCount: 1, attributionCount: 1, replayed: false })
    expect(repository.commitSnapshot(first)).toEqual({ canonicalCount: 1, attributionCount: 1, replayed: true })
    repository.commitSnapshot(snapshot('run-2', [canonical('replacement', '2026-07-02', 250)]))
    expect(repository.listCanonicalRecords().map((record) => record.id)).toEqual(['replacement'])
    expect(repository.listAttribution()).toHaveLength(1)
    expect(repository.latestCoverage()).toEqual(coverage())
    expect(repository.bounds()).toMatchObject({ periodStart: '2026-07-02', periodEnd: '2026-07-02', lastSuccessRunId: 'run-2', lastSuccessfulRefreshAt: timestamp })
    opened.close()
  })

  it('hashes raw attribution identities before persistence and keeps the salt stable across restart', async () => {
    const { path, database: opened } = await database()
    const repository = new UsageRepository(opened.db)
    const rawIdentity = 'C:\\Users\\private\\workspace-secret'
    const opaque = repository.opaqueIdentity(rawIdentity)
    expect(opaque).toMatch(/^usage_[a-f0-9]{64}$/)
    repository.commitSnapshot(snapshot('opaque-run', [canonical('opaque-record', '2026-07-13')], opaque))
    opened.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    opened.close()
    expect((await readFile(path)).toString('latin1')).not.toContain('workspace-secret')
    const reopened = await openFindMnemoDatabase({ path })
    expect(new UsageRepository(reopened.db).opaqueIdentity(rawIdentity)).toBe(opaque)
    reopened.close()
  })

  it('retains the last successful snapshot after failure and rollback', async () => {
    const { database: opened } = await database()
    const repository = new UsageRepository(opened.db)
    repository.commitSnapshot(snapshot('good-run', [canonical('good-record', '2026-07-13')]))
    repository.recordFailure({ runId: 'failed-run', requestedAt: timestamp, finishedAt: timestamp, coverageStart: '2026-07-01', coverageEnd: '2026-07-13', errorCode: 'TOKSCALE_TIMEOUT' })
    const duplicate = snapshot('rollback-run', [canonical('duplicate', '2026-07-13'), canonical('duplicate', '2026-07-13')])
    expect(() => repository.commitSnapshot(duplicate)).toThrow()
    expect(repository.listCanonicalRecords().map((record) => record.id)).toEqual(['good-record'])
    expect(repository.bounds().lastSuccessRunId).toBe('good-run')
    opened.close()
  })

  it('prunes records older than 12 rolling months and clear preserves local mapping configuration', async () => {
    const { database: opened } = await database()
    const repository = new UsageRepository(opened.db)
    opened.db.prepare("INSERT INTO usage_route_mappings(identity_key,client_id,provider_id,model_id,profile_id,source,created_at,updated_at) VALUES('model_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','codex','openai','gpt-5','route:writer','manual',?,?)").run(timestamp, timestamp)
    const input = snapshot('retention-run', [canonical('expired', '2025-06-01'), canonical('retained', '2025-08-01')])
    input.coverageStart = '2025-06-01'
    expect(repository.commitSnapshot(input).canonicalCount).toBe(2)
    expect(repository.listCanonicalRecords().map((record) => record.id)).toEqual(['retained'])
    repository.clearHistory()
    expect(repository.listCanonicalRecords()).toEqual([])
    expect(opened.db.prepare('SELECT profile_id FROM usage_route_mappings').get()).toEqual({ profile_id: 'route:writer' })
    opened.close()
  })

  it('migrates a schema-v5 database without changing prior operational data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-v5-usage-'))
    cleanup.push(directory)
    const path = join(directory, 'findmnemo.db')
    const legacy = new DatabaseSync(path)
    legacy.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO app_meta VALUES('schema_version','5'); CREATE TABLE legacy_fixture(id TEXT PRIMARY KEY); INSERT INTO legacy_fixture VALUES('preserved');")
    legacy.close()
    const migrated = await openFindMnemoDatabase({ path })
    expect(migrated.db.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get()).toEqual({ value: String(DATABASE_SCHEMA_VERSION) })
    expect(migrated.db.prepare('SELECT id FROM legacy_fixture').get()).toEqual({ id: 'preserved' })
    expect(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usage_canonical_records'").get()).toEqual({ name: 'usage_canonical_records' })
    migrated.close()
  })

  it('recovers an abandoned refresh as a stable interrupted failure after restart', async () => {
    const { path, database: opened } = await database()
    const repository = new UsageRepository(opened.db)
    repository.recordStart({ id: 'interrupted-run', requestedAt: timestamp, coverageStart: '2026-07-01', coverageEnd: '2026-07-13' })
    repository.updateRunStage('interrupted-run', 'collecting')
    opened.close()
    const reopened = await openFindMnemoDatabase({ path })
    expect(new UsageRepository(reopened.db).getRefreshRun('interrupted-run')).toMatchObject({ state: 'failed', stage: 'finished', errorCode: 'USAGE_REFRESH_INTERRUPTED' })
    reopened.close()
  })

  it('filters, aggregates unknowns, maps conservatively, and never mutates routing state', async () => {
    const { path, database: opened } = await database()
    const usage = new UsageRepository(opened.db)
    const routing = new RoutingRepository(opened.db)
    expect(routing.compareAndSetPolicy({ ...policy(), policyVersion: 0 }, null).status).toBe('saved')
    usage.commitSnapshot(snapshot('analytics-run', [canonical('mapped-record', '2026-07-13', 0)]))
    const beforePolicy = JSON.stringify(routing.readPolicy()); const beforeReceipts = JSON.stringify(routing.listDispatchReceipts())
    const automatic = usage.queryRecords(emptyFilters, routing.readPolicy())
    expect(automatic.records[0].routeMapping).toMatchObject({ state: 'automatic', profileId: 'route:exact', source: 'exact' })
    const summary = usage.summary({ ...emptyFilters, profileId: 'route:exact' }, routing.readPolicy())
    expect(summary).toMatchObject({ recordCount: 1, inputTokens: { value: 0, state: 'complete' }, reasoningTokens: { value: null, state: 'unknown' } })
    const identity = { clientId: 'codex', providerId: 'openai', modelId: 'gpt-5' }
    const saved = usage.saveManualMapping(identity, 'route:manual', routing.readPolicy() as OperationalRoutingPolicy, timestamp)
    expect(saved).toMatchObject({ identityKey: usageIdentityKey(identity), state: 'manual', profileId: 'route:manual' })
    expect(usage.queryRecords({ ...emptyFilters, mappingState: 'manual' }, routing.readPolicy()).records).toHaveLength(1)
    opened.close()
    const reopened = await openFindMnemoDatabase({ path })
    const reopenedUsage = new UsageRepository(reopened.db); const reopenedRouting = new RoutingRepository(reopened.db)
    expect(reopenedUsage.listManualMappings(reopenedRouting.readPolicy())).toEqual([expect.objectContaining({ profileId: 'route:manual', state: 'manual' })])
    expect(reopenedUsage.removeManualMapping(saved.identityKey)).toBe(true)
    expect(JSON.stringify(reopenedRouting.readPolicy())).toBe(beforePolicy)
    expect(JSON.stringify(reopenedRouting.listDispatchReceipts())).toBe(beforeReceipts)
    reopened.close()
  })

  it('keeps deleted targets and ambiguous exact identities visibly unmapped', async () => {
    const { database: opened } = await database(); const usage = new UsageRepository(opened.db)
    usage.commitSnapshot(snapshot('ambiguous-run', [canonical('ambiguous', '2026-07-13')]))
    const ambiguousPolicy = policy(); ambiguousPolicy.profiles.push({ ...ambiguousPolicy.profiles[0], id: 'route:duplicate', destinationAdapterId: 'other' })
    expect(usage.queryRecords(emptyFilters, ambiguousPolicy).records[0].routeMapping.profileId).toBe('route:exact')
    const identity = { clientId: 'codex', providerId: 'openai', modelId: 'gpt-5' }
    usage.saveManualMapping(identity, 'route:manual', ambiguousPolicy, timestamp)
    const missingPolicy = { ...ambiguousPolicy, profiles: ambiguousPolicy.profiles.filter((profile) => profile.id !== 'route:manual') }
    expect(usage.listManualMappings(missingPolicy)).toEqual([expect.objectContaining({ state: 'target-missing' })])
    expect(usage.queryRecords(emptyFilters, missingPolicy).records[0].routeMapping.state).toBe('target-missing')
    opened.close()
  })
})
