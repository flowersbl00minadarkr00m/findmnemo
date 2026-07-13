interface Props {
  onReset: () => void
  status?: string
}

export function SampleWorkspaceBanner({ onReset, status }: Props) {
  return (
    <aside className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/35 bg-amber-400/10 px-4 py-2 text-xs text-amber-200" aria-label="Sample workspace notice">
      <p><strong>FindMnemo Sample Workspace:</strong> all tickets, agents, and emails are fictional and remain in this browser tab only.</p>
      {status && <p role="status" className="text-amber-100">{status}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onReset} className="rounded-sm border border-amber-300/40 px-2 py-1 hover:bg-amber-300/10">Reset sample</button>
        <a href="/" className="rounded-sm border border-amber-300/40 px-2 py-1 hover:bg-amber-300/10">Exit sample</a>
      </div>
    </aside>
  )
}
