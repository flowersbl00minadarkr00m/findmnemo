import { assertUsageBoundarySafe, type NormalizedUsageRecordDto } from '../../../shared/companion-contract.js'
import {
  assertNoProhibitedUpstreamFields,
  freshness,
  metricSetFromTokenRecord,
  optionalString,
  provenance,
  requireArray,
  requireIsoDate,
  requireRecord,
  requireString,
  requireTimestamp,
  stableUsageId,
  UsageContractError,
  type UsageAdapterContext,
} from '../usage-normalizer.js'

export interface GraphAdapterResult {
  records: NormalizedUsageRecordDto[]
  warnings: string[]
  generatedAt: string
  dateRange: { start: string; end: string }
}

export function adaptGraphV4(input: unknown, context: UsageAdapterContext): GraphAdapterResult {
  assertNoProhibitedUpstreamFields(input)
  const root = requireRecord(input)
  const meta = requireRecord(root.meta)
  const version = requireString(meta.version)
  if (version !== context.tokscaleVersion) throw new UsageContractError('TOKSCALE_VERSION_MISMATCH')
  const generatedAt = requireTimestamp(meta.generatedAt)
  const rawRange = requireRecord(meta.dateRange)
  const dateRange = { start: requireIsoDate(rawRange.start), end: requireIsoDate(rawRange.end) }
  const records: NormalizedUsageRecordDto[] = []

  for (const rawContribution of requireArray(root.contributions)) {
    const contribution = requireRecord(rawContribution)
    const date = requireIsoDate(contribution.date)
    for (const rawClient of requireArray(contribution.clients)) {
      const client = requireRecord(rawClient)
      const clientId = requireString(client.client)
      const modelId = requireString(client.modelId)
      const providerId = optionalString(client.providerId)
      const metrics = metricSetFromTokenRecord(requireRecord(client.tokens), client)
      const record: NormalizedUsageRecordDto = {
        schema: 'findmnemo.usage.v1',
        id: stableUsageId([date, clientId, providerId ?? '', modelId, context.adapterId, 'canonical-daily']),
        role: 'canonical-daily',
        periodStart: date,
        periodEnd: date,
        clientId,
        providerId,
        modelId,
        ...metrics,
        routeMapping: { state: 'unmapped', profileId: null, source: 'none', mappedAt: null },
        provenance: provenance(context, 'canonical-graph', ['tokscale-graph-client-contribution', 'sum-all-token-components']),
        freshness: freshness(context, generatedAt),
      }
      assertUsageBoundarySafe(record)
      records.push(record)
    }
  }

  return { records, warnings: [], generatedAt, dateRange }
}
