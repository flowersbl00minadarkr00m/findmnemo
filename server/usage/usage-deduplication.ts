import type { NormalizedUsageRecordDto } from '../../shared/companion-contract.js'

export interface UsageDeduplicationResult {
  records: NormalizedUsageRecordDto[]
  conflictIds: string[]
  warnings: string[]
}

function comparable(record: NormalizedUsageRecordDto): string {
  return JSON.stringify({
    ...record,
    provenance: { ...record.provenance, duplicateState: 'unique' },
  })
}

export function deduplicateCanonicalUsageRecords(
  input: readonly NormalizedUsageRecordDto[],
): UsageDeduplicationResult {
  const accepted = new Map<string, NormalizedUsageRecordDto>()
  const conflicts = new Set<string>()
  let collapsed = false

  for (const record of input) {
    if (conflicts.has(record.id)) continue
    const existing = accepted.get(record.id)
    if (!existing) {
      accepted.set(record.id, record)
      continue
    }
    if (comparable(existing) === comparable(record)) {
      collapsed = true
      accepted.set(record.id, {
        ...existing,
        provenance: { ...existing.provenance, duplicateState: 'identical-collapsed' },
      })
      continue
    }
    accepted.delete(record.id)
    conflicts.add(record.id)
  }

  const warnings: string[] = []
  if (collapsed) warnings.push('identical-duplicate-collapsed')
  if (conflicts.size > 0) warnings.push('duplicate-conflict')
  return {
    records: [...accepted.values()],
    conflictIds: [...conflicts].sort(),
    warnings,
  }
}
