import type { RoutingExecutionProfile } from '../../types'

interface Props {
  profile?: RoutingExecutionProfile
  capabilityLabel: string
  configured: boolean
}

function readinessMessage(profile: RoutingExecutionProfile): string {
  switch (profile.readiness.state) {
    case 'ready': return `Connection checked. This evidence expires ${new Date(profile.readiness.expiresAt ?? '').toLocaleString()}.`
    case 'stale': return 'The previous connection check is stale. Recheck it before automatic delegation can run.'
    case 'auth-required': return 'The selected provider needs authentication in Pi. FindMnemo does not collect that credential.'
    case 'unsupported': return 'This installed version, model, or effort level is unsupported.'
    case 'unavailable': return 'The selected tool or exact model is currently unavailable.'
    default: return 'The exact connection has not been checked yet.'
  }
}

export function RoutingPreview({ profile, capabilityLabel, configured }: Props) {
  if (!profile || !configured) {
    return (
      <section className="rounded-sm border border-chrome-line bg-chrome/40 p-4" aria-labelledby="routing-preview-heading">
        <h3 id="routing-preview-heading" className="text-sm font-semibold text-chrome-ink">What will happen?</h3>
        <p className="mt-2 text-sm text-chrome-mut">Nothing changes until you explicitly save a profile.</p>
      </section>
    )
  }

  const destination = profile.destinationAdapterId === 'pi-rpc'
    ? `Pi using ${profile.providerId ?? 'the selected provider'} / ${profile.modelId}${profile.effort ? ` / ${profile.effort} effort` : ''}`
    : `${profile.displayName} as a manual recommendation`
  const readyForAutomatic = profile.enabled && profile.behavior === 'auto-exact' && profile.readiness.state === 'ready'

  return (
    <section className="rounded-sm border border-sync/40 bg-sync/5 p-4" aria-labelledby="routing-preview-heading" aria-live="polite">
      <h3 id="routing-preview-heading" className="text-sm font-semibold text-chrome-ink">What will happen?</h3>
      <p className="mt-2 text-base text-chrome-ink">
        For <strong>{capabilityLabel.toLowerCase()}</strong>, FindMnemo will use <strong>{destination}</strong>.
      </p>
      {!profile.enabled && <p className="mt-2 text-sm text-memory">This profile is saved but off. It will not be recommended or used.</p>}
      {profile.enabled && profile.behavior === 'recommend' && (
        <p className="mt-2 text-sm text-memory">FindMnemo will recommend it in chat and ask before any handoff. It will not send work automatically.</p>
      )}
      {profile.enabled && profile.behavior === 'auto-exact' && readyForAutomatic && (
        <p className="mt-2 text-sm text-emerald-300">A clear exact match may be delegated from the originating supported chat and its result returned to that same tool call.</p>
      )}
      {profile.enabled && profile.behavior === 'auto-exact' && !readyForAutomatic && (
        <p className="mt-2 text-sm text-memory">Automatic delegation remains blocked until the exact connection is ready. FindMnemo will fall back to an in-chat decision.</p>
      )}
      <p className="mt-2 text-xs text-chrome-mut">{readinessMessage(profile)}</p>
      <p className="mt-2 text-xs text-chrome-mut">If this route cannot be used, FindMnemo checks your next enabled profile; otherwise it asks in the original chat. It never silently picks a partial match.</p>
    </section>
  )
}
