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
      {error && <p id="pairing-error" className="text-xs text-rose-300" role="alert">{error}</p>}
      <button type="submit" disabled={pending || code.replaceAll(/\s/g, '').length !== 8} className="rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-50">
        {pending ? 'Pairing...' : 'Pair companion'}
      </button>
    </form>
  )
}
