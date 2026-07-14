import { assertUsageBoundarySafe, type UsageCoverageDto, type UsageSourceCoverageDto } from '../../../shared/companion-contract.js'
import {
  assertNoProhibitedUpstreamFields,
  optionalString,
  requireArray,
  requireNonNegativeInteger,
  requireRecord,
  requireString,
  type UsageAdapterContext,
} from '../usage-normalizer.js'

function diagnosticCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((raw): string[] => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    const code = optionalString((raw as Record<string, unknown>).code)
    return code && /^[A-Z0-9_:-]{1,80}$/.test(code) ? [code] : []
  })
}

export function adaptClientsV4(input: unknown, context: UsageAdapterContext): UsageCoverageDto {
  assertNoProhibitedUpstreamFields(input)
  const root = requireRecord(input)
  const sources: UsageSourceCoverageDto[] = requireArray(root.clients).map((raw) => {
    const client = requireRecord(raw)
    const messageCount = requireNonNegativeInteger(client.messageCount)
    const available = client.sessionsPathExists === true || messageCount > 0
    return {
      clientId: requireString(client.client),
      state: available ? 'available' : 'unavailable',
      messageCount,
      diagnosticCodes: diagnosticCodes(client.diagnostics),
    }
  })
  const coverage: UsageCoverageDto = {
    schema: 'findmnemo.usage-coverage.v1',
    tokscaleVersion: context.tokscaleVersion,
    adapterId: context.adapterId,
    refreshedAt: context.refreshedAt,
    sources,
    complete: sources.every((source) => source.state === 'available' && source.diagnosticCodes.length === 0),
    warnings: sources.some((source) => source.diagnosticCodes.length > 0) ? ['source-diagnostics-present'] : [],
  }
  assertUsageBoundarySafe(coverage)
  return coverage
}
