import { useState } from 'react'

export function PairingDialog({ pending, error, onPair }: {
  pending: boolean
  error?: string
  onPair: (code: string) => void
}) {
  const [code, setCode] = useState('')
  return (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); onPair(code) }}>
      <label className="block text-sm font-medium" htmlFor="pairing-code">One-time pairing code</label>
      <input
        id="pairing-code"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/[^0-9\s]/g, '').slice(0, 9))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="1234 5678"
        className="w-full rounded-sm border border-line bg-mist px-3 py-2 font-mono tracking-[0.2em] text-ink focus:border-sync focus:outline-none"
        aria-describedby={error ? 'pairing-error' : undefined}
      />
      {error && <p id="pairing-error" className="text-xs text-rose-300" role="alert">{pairingErrorMessage(error)}</p>}
      <button type="submit" disabled={pending || code.replaceAll(/\s/g, '').length !== 8} className="rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-50">
        {pending ? 'Connecting...' : 'Connect this computer'}
      </button>
    </form>
  )
}

function pairingErrorMessage(error: string): string {
  if (error === 'PAIRING_CODE_EXPIRED') return 'That code expired. Choose New code in the installed FindMnemo window.'
  if (error === 'PAIRING_CODE_USED') return 'That code was already used. Choose New code in the installed FindMnemo window.'
  if (error === 'PAIRING_RATE_LIMITED') return 'Too many attempts. Wait one minute, then create a new code.'
  if (error === 'PAIRING_CODE_INVALID') return 'That code does not match. Check the installed FindMnemo window and try again.'
  return 'FindMnemo could not connect. Create a new code in the installed app and retry.'
}
