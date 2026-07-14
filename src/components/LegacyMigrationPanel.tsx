import { useEffect, useState } from 'react'
import type { LegacyMigrationRecord, LegacyMigrationResult, OperationalRepository } from '../lib/operational-repository'
import { commitLegacyMigration, previewLegacyMigration } from '../lib/legacy-migration'

export function LegacyMigrationPanel({ repository, onImported }: { repository: OperationalRepository; onImported: () => void }) {
  const [records, setRecords] = useState<LegacyMigrationRecord[]>([])
  const [result, setResult] = useState<LegacyMigrationResult>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => { void previewLegacyMigration(repository).then((preview) => { setRecords(preview.records); setResult(preview.result) }).catch(() => undefined) }, [repository])
  if (!result || records.length === 0 || (result.eligible === 0 && result.conflicts === 0)) return null
  return <section className="mb-4 rounded-sm border border-memory/40 bg-memory/10 px-4 py-3 text-sm" aria-label="Legacy ticket migration">
    <p className="font-semibold text-ink">Legacy browser tickets found</p>
    <p className="mt-1 text-mut">Preview: {result.eligible} eligible, {result.conflicts} conflicts, {result.excluded} excluded. Demo/sample and private unsupported records are never imported. Original browser storage remains untouched.</p>
    {error && <p role="alert" className="mt-2 text-alert">{error}</p>}
    <button type="button" disabled={pending || result.eligible === 0} onClick={() => { setPending(true); setError(undefined); void commitLegacyMigration(repository, records).then((next) => { setResult(next); onImported() }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Migration failed.')).finally(() => setPending(false)) }} className="mt-3 rounded-sm bg-sync px-3 py-1.5 text-xs font-semibold text-chrome disabled:opacity-50">{pending ? 'Importing...' : 'Import eligible tickets'}</button>
  </section>
}
