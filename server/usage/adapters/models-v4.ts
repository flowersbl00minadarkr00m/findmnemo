import { assertUsageBoundarySafe, type UsageAttributionRecordDto } from '../../../shared/companion-contract.js'
import {
  assertNoProhibitedUpstreamFields,
  assertOpaqueIdentity,
  metricSetFromModelEntry,
  optionalString,
  provenance,
  requireArray,
  requireRecord,
  requireString,
  stableUsageId,
  UsageContractError,
  type UsageAdapterContext,
} from '../usage-normalizer.js'

type AttributionRole = 'session-attribution' | 'workspace-attribution'

export interface ModelsAdapterResult {
  records: UsageAttributionRecordDto[]
  warnings: string[]
}

export function adaptModelsV4(
  input: unknown,
  context: UsageAdapterContext,
  role: AttributionRole,
): ModelsAdapterResult {
  assertNoProhibitedUpstreamFields(input)
  const root = requireRecord(input)
  const expectedGrouping = role === 'session-attribution' ? 'client,session,model' : 'workspace,model'
  if (requireString(root.groupBy) !== expectedGrouping) throw new UsageContractError('TOKSCALE_GROUPING_MISMATCH')

  const records: UsageAttributionRecordDto[] = []
  const warnings: string[] = []
  for (const rawEntry of requireArray(root.entries)) {
    const entry = requireRecord(rawEntry)
    const rawSubject = optionalString(role === 'session-attribution' ? entry.sessionId : entry.workspaceKey)
    if (!rawSubject) {
      warnings.push('attribution-subject-missing')
      continue
    }
    const opaqueSubjectId = assertOpaqueIdentity(rawSubject, context.opaqueIdentity(rawSubject))
    const clientId = optionalString(entry.client)
    const providerId = optionalString(entry.provider)
    const modelId = requireString(entry.model)
    const record: UsageAttributionRecordDto = {
      schema: 'findmnemo.usage-attribution.v1',
      id: stableUsageId([role, opaqueSubjectId, clientId ?? '', providerId ?? '', modelId, context.adapterId]),
      role,
      additive: false,
      clientId,
      providerId,
      modelId,
      opaqueSubjectId,
      localLabel: null,
      metrics: metricSetFromModelEntry(entry),
      provenance: provenance(context, role, ['opaque-attribution-identity', 'sum-all-token-components']),
      joinState: 'unlinked',
    }
    assertUsageBoundarySafe(record)
    records.push(record)
  }
  return { records, warnings }
}
