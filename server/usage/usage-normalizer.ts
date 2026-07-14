import { createHash } from 'node:crypto'
import type {
  UsageFreshnessDto,
  UsageMetricDto,
  UsageMetricSetDto,
  UsageProvenanceDto,
  UsageValueReason,
} from '../../shared/companion-contract.js'

export class UsageContractError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
    this.name = 'UsageContractError'
  }
}

export interface UsageAdapterContext {
  adapterId: string
  tokscaleVersion: string
  refreshRunId: string
  refreshedAt: string
  opaqueIdentity: (rawIdentity: string) => string
}

const PROHIBITED_UPSTREAM_KEYS = new Set([
  'account',
  'accountemail',
  'accountid',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'prompt',
  'rawlog',
  'response',
  'stderr',
  'stdout',
  'transcript',
])

export function assertNoProhibitedUpstreamFields(input: unknown): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isRecord(value)) return
    for (const [key, nested] of Object.entries(value)) {
      if (PROHIBITED_UPSTREAM_KEYS.has(key.toLowerCase())) throw new UsageContractError('TOKSCALE_PROHIBITED_FIELD')
      visit(nested)
    }
  }
  visit(input)
}

export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

export function requireRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw new UsageContractError('TOKSCALE_SCHEMA_CHANGED')
  return input
}

export function requireArray(input: unknown): unknown[] {
  if (!Array.isArray(input)) throw new UsageContractError('TOKSCALE_SCHEMA_CHANGED')
  return input
}

export function requireString(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 500) {
    throw new UsageContractError('TOKSCALE_SCHEMA_CHANGED')
  }
  return input
}

export function optionalString(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null
  return requireString(input)
}

export function requireIsoDate(input: unknown): string {
  const value = requireString(input)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new UsageContractError('TOKSCALE_DATE_INVALID')
  return value
}

export function requireTimestamp(input: unknown): string {
  const value = requireString(input)
  if (!Number.isFinite(Date.parse(value))) throw new UsageContractError('TOKSCALE_TIMESTAMP_INVALID')
  return value
}

export function requireNonNegativeInteger(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    throw new UsageContractError('TOKSCALE_NUMERIC_INVALID')
  }
  return input
}

export function optionalReportedToken(record: Record<string, unknown>, key: string): UsageMetricDto {
  if (!(key in record) || record[key] === null) return unknownMetric('field-absent')
  return { value: requireNonNegativeInteger(record[key]), state: 'reported', reason: 'upstream-reported' }
}

export function estimatedCost(record: Record<string, unknown>, key = 'cost'): UsageMetricDto {
  if (!(key in record) || record[key] === null) return unknownMetric('field-absent')
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new UsageContractError('TOKSCALE_NUMERIC_INVALID')
  }
  return { value, state: 'estimated', reason: 'upstream-reported' }
}

export function unknownMetric(reason: UsageValueReason): UsageMetricDto {
  return { value: null, state: 'unknown', reason }
}

export function calculatedTotal(metrics: readonly UsageMetricDto[]): UsageMetricDto {
  if (metrics.some((metric) => metric.value === null)) return unknownMetric('semantics-unverified')
  const total = metrics.reduce((sum, metric) => sum + (metric.value ?? 0), 0)
  if (!Number.isSafeInteger(total)) throw new UsageContractError('TOKSCALE_NUMERIC_INVALID')
  return { value: total, state: 'calculated', reason: 'derived-from-reported-components' }
}

export function metricSetFromTokenRecord(
  tokens: Record<string, unknown>,
  costOwner: Record<string, unknown>,
): UsageMetricSetDto {
  const inputTokens = optionalReportedToken(tokens, 'input')
  const outputTokens = optionalReportedToken(tokens, 'output')
  const cacheReadTokens = optionalReportedToken(tokens, 'cacheRead')
  const cacheWriteTokens = optionalReportedToken(tokens, 'cacheWrite')
  const reasoningTokens = optionalReportedToken(tokens, 'reasoning')
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: calculatedTotal([inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens]),
    cost: estimatedCost(costOwner),
    currency: null,
  }
}

export function metricSetFromModelEntry(entry: Record<string, unknown>): UsageMetricSetDto {
  const inputTokens = optionalReportedToken(entry, 'input')
  const outputTokens = optionalReportedToken(entry, 'output')
  const cacheReadTokens = optionalReportedToken(entry, 'cacheRead')
  const cacheWriteTokens = optionalReportedToken(entry, 'cacheWrite')
  const reasoningTokens = optionalReportedToken(entry, 'reasoning')
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: calculatedTotal([inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens]),
    cost: estimatedCost(entry),
    currency: null,
  }
}

export function provenance(
  context: UsageAdapterContext,
  sourceCommandId: UsageProvenanceDto['sourceCommandId'],
  transformations: string[],
): UsageProvenanceDto {
  return {
    sourceCommandId,
    tokscaleVersion: context.tokscaleVersion,
    adapterId: context.adapterId,
    refreshRunId: context.refreshRunId,
    refreshedAt: context.refreshedAt,
    transformations,
    duplicateState: 'unique',
  }
}

export function freshness(context: UsageAdapterContext, upstreamGeneratedAt: string | null): UsageFreshnessDto {
  return {
    state: 'current',
    lastSuccessfulRefreshAt: context.refreshedAt,
    upstreamGeneratedAt,
  }
}

export function stableUsageId(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
}

export function assertOpaqueIdentity(raw: string, opaque: string): string {
  if (!opaque || opaque === raw || opaque.length > 200 || /^[a-zA-Z]:[\\/]/.test(opaque) || opaque.includes('@')) {
    throw new UsageContractError('TOKSCALE_OPAQUE_ID_INVALID')
  }
  return opaque
}
