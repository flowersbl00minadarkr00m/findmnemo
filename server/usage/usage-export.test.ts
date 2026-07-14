import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adaptGraphV4 } from './adapters/graph-v4.js'
import { adaptModelsV4 } from './adapters/models-v4.js'
import { serializeUsageCsv, serializeUsageJson, type UsageExportSnapshot } from './usage-export.js'

async function snapshot(): Promise<UsageExportSnapshot> {
  const root = join(process.cwd(), 'server', 'usage', 'fixtures', 'v4.5.2')
  const context = { adapterId: 'tokscale-v4.4-v4.5', tokscaleVersion: '4.5.2', refreshRunId: 'run-export', refreshedAt: '2026-07-13T12:00:00.000Z', opaqueIdentity: (raw: string) => `usage_${Buffer.from(raw).toString('hex')}` }
  const graph = adaptGraphV4(JSON.parse(await readFile(join(root, 'graph.json'), 'utf8')) as unknown, context)
  const attribution = adaptModelsV4(JSON.parse(await readFile(join(root, 'models-session.json'), 'utf8')) as unknown, context, 'session-attribution')
  graph.records[0] = { ...graph.records[0], modelId: '=FORMULA', reasoningTokens: { value: null, state: 'unknown', reason: 'field-absent' }, cacheWriteTokens: { value: 0, state: 'reported', reason: 'upstream-reported' } }
  return { filters: { start: null, end: null, clientId: null, providerId: null, modelId: null, profileId: null, mappingState: null }, bounds: { periodStart: '2026-07-13', periodEnd: '2026-07-13', lastSuccessfulRefreshAt: context.refreshedAt, lastSuccessRunId: 'run-export' }, coverage: null, records: graph.records, attribution: attribution.records, mappings: [] }
}

describe('privacy-safe usage export', () => {
  it('round-trips the normalized JSON envelope without prohibited raw categories', async () => {
    const json = serializeUsageJson(await snapshot())
    const parsed = JSON.parse(json) as { schema: string; records: unknown[]; attribution: unknown[]; privacy: { excludedCategories: string[] } }
    expect(parsed).toMatchObject({ schema: 'findmnemo.usage-export.v1', records: { length: 1 }, attribution: { length: 1 } })
    expect(parsed.privacy.excludedCategories).toContain('prompts and responses')
    expect(json).not.toMatch(/stdout|stderr|C:\\Users|accessToken|cookie|transcript/i)
  })

  it('keeps explicit zero, blanks unknown numbers, and neutralizes spreadsheet formulas', async () => {
    const csv = serializeUsageCsv(await snapshot())
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    expect(csv).toContain('"0","reported","upstream-reported"')
    expect(csv).toContain('"","unknown","field-absent"')
    expect(csv).toContain("\"'=FORMULA\"")
    expect(csv.split('\r\n')[0]).toContain('duplicate_state')
  })
})
