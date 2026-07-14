import { useState } from 'react'
import type { NormalizedUsageRecordDto, RoutingExecutionProfile, UsageManualMappingDto } from '../../shared/companion-contract'

interface UsageMappingPanelProps {
  unmapped: NormalizedUsageRecordDto[]
  mappings: UsageManualMappingDto[]
  profiles: RoutingExecutionProfile[]
  onSave: (mapping: { clientId: string; providerId: string | null; modelId: string; profileId: string }) => Promise<void>
  onRemove: (identityKey: string) => Promise<void>
}

export function UsageMappingPanel({ unmapped, mappings, profiles, onSave, onRemove }: UsageMappingPanelProps) {
  const [selections, setSelections] = useState<Record<string, string>>({})
  const unique = [...new Map(unmapped.map((record) => [JSON.stringify([record.clientId, record.providerId, record.modelId]), record])).entries()]
  return (
    <section className="panel rounded-sm p-4" aria-labelledby="usage-mapping-title">
      <h2 id="usage-mapping-title" className="hud-label">Unmapped models</h2>
      <p className="mt-2 text-sm text-mut">Connect an observed model to a configured route. This never changes route order or sends work.</p>
      {unique.length === 0 && mappings.length === 0 && <p className="mt-3 text-sm text-mut">No unmapped models are stored.</p>}
      <div className="mt-3 space-y-2">
        {unique.map(([identityKey, record]) => <div key={identityKey} className="grid items-center gap-2 rounded-sm border border-line p-3 md:grid-cols-[1fr_1fr_auto]">
          <p className="text-sm text-ink"><span className="font-medium">{record.modelId}</span><span className="block text-xs text-mut">{record.clientId} · {record.providerId ?? 'provider unknown'}</span></p>
          <select aria-label={`Route target for ${record.modelId}`} value={selections[identityKey] ?? ''} onChange={(event) => setSelections((current) => ({ ...current, [identityKey]: event.target.value }))} className="rounded-sm border border-line bg-abyss px-3 py-2 text-sm text-ink">
            <option value="">Choose a configured route</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}
          </select>
          <button type="button" disabled={!selections[identityKey]} onClick={() => void onSave({ clientId: record.clientId, providerId: record.providerId, modelId: record.modelId, profileId: selections[identityKey] })} className="rounded-sm bg-sync px-3 py-2 text-sm font-medium text-chrome disabled:opacity-40">Save mapping</button>
        </div>)}
        {mappings.map((mapping) => <div key={mapping.identityKey} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line p-3"><p className="text-sm"><span className="text-ink">{mapping.modelId}</span><span className="ml-2 text-xs text-mut">→ {mapping.profileId} · {mapping.state}</span></p><button type="button" onClick={() => void onRemove(mapping.identityKey)} className="text-xs text-sync underline">Remove mapping</button></div>)}
      </div>
    </section>
  )
}
