import type { CompanionConnectionState } from '../../shared/companion-contract'

const COPY: Record<CompanionConnectionState, { label: string; detail: string }> = {
  'not-installed': { label: 'Companion not detected', detail: 'Start the local FindMnemo companion, then retry.' },
  stopped: { label: 'Companion stopped', detail: 'Restart the companion and retry the identity check.' },
  'permission-required': { label: 'Local network permission required', detail: 'Choose Connect to let this browser contact the loopback companion.' },
  'permission-denied': { label: 'Local network permission denied', detail: 'Reset this site permission in the browser or use the local fallback.' },
  'pairing-required': { label: 'Pairing required', detail: 'Enter the one-time code shown by the local companion.' },
  connected: { label: 'Companion connected', detail: 'Identity, paired session, and authenticated status are verified.' },
  stale: { label: 'Connection stale', detail: 'The last verified status is old. Retry before trusting operational counts.' },
  unsupported: { label: 'Hosted connection unsupported', detail: 'Open the local fallback at 127.0.0.1:3210/app.' },
  error: { label: 'Connection error', detail: 'The cause is not yet verified. Retry or use companion diagnostics.' },
}

export function ConnectionStatus({ state }: { state: CompanionConnectionState }) {
  const copy = COPY[state]
  return (
    <div className="rounded-sm border border-line bg-white/[0.02] p-4" role="status" aria-live="polite">
      <p className="text-sm font-medium text-ink">{copy.label}</p>
      <p className="mt-1 text-xs leading-5 text-faint">{copy.detail}</p>
    </div>
  )
}
