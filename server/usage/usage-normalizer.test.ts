import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertUsageBoundarySafe } from '../../shared/companion-contract.js'
import { adaptClientsV4 } from './adapters/clients-v4.js'
import { adaptGraphV4 } from './adapters/graph-v4.js'
import { adaptModelsV4 } from './adapters/models-v4.js'
import { deduplicateCanonicalUsageRecords } from './usage-deduplication.js'
import { resolveTokscaleCompatibility } from './tokscale-compatibility.js'
import type { UsageAdapterContext } from './usage-normalizer.js'

function fixture(version: 'v4.4.1' | 'v4.5.2', name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${version}/${name}.json`, import.meta.url), 'utf8'))
}

function context(version: '4.4.1' | '4.5.2'): UsageAdapterContext {
  return {
    adapterId: 'tokscale-v4.4-v4.5',
    tokscaleVersion: version,
    refreshRunId: 'refresh-1',
    refreshedAt: '2026-07-13T12:00:00.000Z',
    opaqueIdentity: (raw) => `opaque-${createHash('sha256').update(raw).digest('hex').slice(0, 20)}`,
  }
}

describe('Tokscale v4 usage contract', () => {
  it('qualifies only the fixture-backed v4.4-v4.5 candidate interval', () => {
    expect(resolveTokscaleCompatibility('4.4.1').state).toBe('supported')
    expect(resolveTokscaleCompatibility('4.4.2').state).toBe('unsupported')
    expect(resolveTokscaleCompatibility('4.5.2').state).toBe('supported')
    expect(resolveTokscaleCompatibility('4.3.9').state).toBe('unsupported')
    expect(resolveTokscaleCompatibility('4.6.0').state).toBe('unsupported')
    expect(resolveTokscaleCompatibility('not-a-version').state).toBe('unverified')
  })

  it('keeps graph facts additive and session/workspace observations non-additive', () => {
    const graph = adaptGraphV4(fixture('v4.5.2', 'graph'), context('4.5.2'))
    const sessions = adaptModelsV4(
      fixture('v4.5.2', 'models-session'),
      context('4.5.2'),
      'session-attribution',
    )
    const workspaces = adaptModelsV4(
      fixture('v4.5.2', 'models-workspace'),
      context('4.5.2'),
      'workspace-attribution',
    )

    expect(graph.records).toHaveLength(1)
    expect(graph.records[0]).toMatchObject({
      role: 'canonical-daily',
      clientId: 'codex',
      providerId: 'openrouter',
      modelId: 'openai/gpt-5',
      totalTokens: { value: 190, state: 'calculated' },
      cost: { value: 0.42, state: 'estimated' },
      currency: null,
    })
    expect(sessions.records[0]).toMatchObject({ role: 'session-attribution', additive: false })
    expect(workspaces.records[0]).toMatchObject({ role: 'workspace-attribution', additive: false })
    expect(JSON.stringify(workspaces.records)).not.toContain('SANITIZED_PATH')
    expect(JSON.stringify(workspaces.records)).not.toContain('workspace-secret')

    const canonicalTotal = graph.records.reduce((sum, record) => sum + (record.totalTokens.value ?? 0), 0)
    expect(canonicalTotal).toBe(190)
    expect(sessions.records.reduce((sum, record) => sum + (record.metrics.totalTokens.value ?? 0), 0)).toBe(190)
  })

  it('preserves a missing metric as unknown and a fixture-reported zero as zero', () => {
    const missing = adaptGraphV4(fixture('v4.5.2', 'graph-missing-reasoning'), context('4.5.2'))
    const explicitZero = adaptGraphV4(fixture('v4.4.1', 'graph'), context('4.4.1'))

    expect(missing.records[0].reasoningTokens).toEqual({
      value: null,
      state: 'unknown',
      reason: 'field-absent',
    })
    expect(missing.records[0].totalTokens).toEqual({
      value: null,
      state: 'unknown',
      reason: 'semantics-unverified',
    })
    expect(explicitZero.records[0].reasoningTokens).toEqual({
      value: 0,
      state: 'reported',
      reason: 'upstream-reported',
    })
  })

  it('collapses identical duplicates and quarantines conflicting duplicates', () => {
    const { records } = adaptGraphV4(fixture('v4.5.2', 'graph'), context('4.5.2'))
    const identical = deduplicateCanonicalUsageRecords([records[0], structuredClone(records[0])])
    expect(identical.records).toHaveLength(1)
    expect(identical.warnings).toContain('identical-duplicate-collapsed')

    const conflict = structuredClone(records[0])
    conflict.inputTokens.value = 999
    const quarantined = deduplicateCanonicalUsageRecords([records[0], conflict])
    expect(quarantined.records).toEqual([])
    expect(quarantined.conflictIds).toEqual([records[0].id])
    expect(quarantined.warnings).toContain('duplicate-conflict')
  })

  it('reduces client diagnostics to path-free coverage facts', () => {
    const coverage = adaptClientsV4(fixture('v4.5.2', 'clients'), context('4.5.2'))
    expect(coverage.sources).toEqual([
      {
        clientId: 'codex',
        state: 'available',
        messageCount: 7,
        diagnosticCodes: ['INDEX_PARTIAL'],
      },
    ])
    expect(JSON.stringify(coverage)).not.toContain('SANITIZED_PATH')
  })

  it('rejects prohibited upstream fields and unsafe browser DTOs', () => {
    const raw = structuredClone(fixture('v4.5.2', 'graph')) as Record<string, unknown>
    raw.prompt = 'do not retain this'
    expect(() => adaptGraphV4(raw, context('4.5.2'))).toThrowError('TOKSCALE_PROHIBITED_FIELD')

    const record = adaptGraphV4(fixture('v4.5.2', 'graph'), context('4.5.2')).records[0]
    const unsafe = { ...record, rawLog: 'C:\\Users\\private\\agent.log' }
    expect(() => assertUsageBoundarySafe(unsafe)).toThrowError('USAGE_BOUNDARY_PROHIBITED_FIELD')
  })
})
