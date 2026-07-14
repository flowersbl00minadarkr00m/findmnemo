import { assertUsageBoundarySafe, type NormalizedUsageRecordDto, type UsageAttributionRecordDto, type UsageCoverageDto, type UsageManualMappingDto, type UsageQueryDto } from '../../shared/companion-contract.js'

export interface UsageExportSnapshot {
  filters: UsageQueryDto
  bounds: { periodStart: string | null; periodEnd: string | null; lastSuccessfulRefreshAt: string | null; lastSuccessRunId: string | null }
  coverage: UsageCoverageDto | null
  records: NormalizedUsageRecordDto[]
  attribution: UsageAttributionRecordDto[]
  mappings: UsageManualMappingDto[]
}

export function serializeUsageJson(snapshot: UsageExportSnapshot): string {
  const envelope = { schema: 'findmnemo.usage-export.v1', exportedAt: new Date().toISOString(), privacy: { excludedCategories: ['raw logs', 'prompts and responses', 'credentials', 'raw session and workspace identities'] }, ...snapshot }
  assertUsageBoundarySafe(envelope)
  return `${JSON.stringify(envelope, null, 2)}\n`
}

const COLUMNS = [
  'role', 'additive', 'period_start', 'period_end', 'client', 'provider', 'model',
  'input_value', 'input_state', 'input_reason', 'output_value', 'output_state', 'output_reason',
  'cache_read_value', 'cache_read_state', 'cache_read_reason', 'cache_write_value', 'cache_write_state', 'cache_write_reason',
  'reasoning_value', 'reasoning_state', 'reasoning_reason', 'total_value', 'total_state', 'total_reason',
  'cost_value', 'cost_state', 'cost_reason', 'currency', 'mapping_state', 'profile_id', 'mapping_source',
  'tokscale_version', 'adapter_id', 'refresh_run_id', 'refreshed_at', 'freshness_state', 'last_successful_refresh_at', 'duplicate_state',
] as const

export function serializeUsageCsv(snapshot: UsageExportSnapshot): string {
  assertUsageBoundarySafe(snapshot)
  const rows = snapshot.records.map((record) => [
    record.role, 'true', record.periodStart, record.periodEnd, record.clientId, record.providerId, record.modelId,
    value(record.inputTokens.value), record.inputTokens.state, record.inputTokens.reason, value(record.outputTokens.value), record.outputTokens.state, record.outputTokens.reason,
    value(record.cacheReadTokens.value), record.cacheReadTokens.state, record.cacheReadTokens.reason, value(record.cacheWriteTokens.value), record.cacheWriteTokens.state, record.cacheWriteTokens.reason,
    value(record.reasoningTokens.value), record.reasoningTokens.state, record.reasoningTokens.reason, value(record.totalTokens.value), record.totalTokens.state, record.totalTokens.reason,
    value(record.cost.value), record.cost.state, record.cost.reason, record.currency, record.routeMapping.state, record.routeMapping.profileId, record.routeMapping.source,
    record.provenance.tokscaleVersion, record.provenance.adapterId, record.provenance.refreshRunId, record.provenance.refreshedAt, record.freshness.state, record.freshness.lastSuccessfulRefreshAt, record.provenance.duplicateState,
  ])
  const attributionRows = snapshot.attribution.map((record) => [
    record.role, 'false', '', '', record.clientId, record.providerId, record.modelId,
    value(record.metrics.inputTokens.value), record.metrics.inputTokens.state, record.metrics.inputTokens.reason, value(record.metrics.outputTokens.value), record.metrics.outputTokens.state, record.metrics.outputTokens.reason,
    value(record.metrics.cacheReadTokens.value), record.metrics.cacheReadTokens.state, record.metrics.cacheReadTokens.reason, value(record.metrics.cacheWriteTokens.value), record.metrics.cacheWriteTokens.state, record.metrics.cacheWriteTokens.reason,
    value(record.metrics.reasoningTokens.value), record.metrics.reasoningTokens.state, record.metrics.reasoningTokens.reason, value(record.metrics.totalTokens.value), record.metrics.totalTokens.state, record.metrics.totalTokens.reason,
    value(record.metrics.cost.value), record.metrics.cost.state, record.metrics.cost.reason, record.metrics.currency, '', '', '', record.provenance.tokscaleVersion, record.provenance.adapterId, record.provenance.refreshRunId, record.provenance.refreshedAt, '', '', record.provenance.duplicateState,
  ])
  return `\uFEFF${[COLUMNS, ...rows, ...attributionRows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function value(input: number | null): string | number { return input === null ? '' : input }

function csvCell(input: unknown): string {
  let text = input === null || input === undefined ? '' : String(input)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
