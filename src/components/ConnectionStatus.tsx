import type { CompanionConnectionState } from '../../shared/companion-contract'

const COPY: Record<CompanionConnectionState, { label: string; detail: string }> = {
  'not-installed': { label: 'Local companion not detected', detail: 'It may not be installed or it may be stopped. Install or open FindMnemo on this computer, then retry.' },
  stopped: { label: 'FindMnemo is stopped', detail: 'Open the installed app and choose Start, then try again.' },
  'permission-required': { label: 'Permission needed to connect this computer', detail: 'Choose Connect this computer. Your browser may ask to contact an app on this device.' },
  'permission-denied': { label: 'Local network permission denied', detail: 'Reset this site permission in the browser or use the local fallback.' },
  'pairing-required': { label: 'Enter the one-time code', detail: 'Find the current code in the installed FindMnemo window. It works once and expires after five minutes.' },
  connected: { label: 'Companion connected', detail: 'Identity, paired session, and authenticated status are verified.' },
  stale: { label: 'Connection stale', detail: 'The last verified status is old. Retry before trusting operational counts.' },
  unsupported: { label: 'Hosted connection unsupported', detail: 'Open the local fallback at 127.0.0.1:3210/app.' },
  error: { label: 'Connection could not be verified', detail: 'FindMnemo reached the local boundary but could not confirm a healthy companion. Review the diagnostic code and recovery steps.' },
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
