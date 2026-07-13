export function WorkspaceLanding({ operationalEnabled = true }: { operationalEnabled?: boolean }) {
  return (
    <main className="min-h-screen bg-mist text-ink grid place-items-center px-5 py-10">
      <section className="panel hud-corners relative w-full max-w-4xl overflow-hidden rounded-sm p-7 sm:p-10">
        <i /><i /><i /><i />
        <p className="hud-label">FindMnemo · choose a workspace</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          See what your agents are doing without mistaking a product tour for live work.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-mut sm:text-base">
          Connect the private local companion for operational data, or explore a separate fictional Sample workspace that never accesses Gmail, agents, or operational storage.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {operationalEnabled ? (
            <a href="/app" className="rounded-sm bg-sync px-5 py-3 text-center text-sm font-semibold text-chrome hover:bg-[#E8641C]">
              Connect FindMnemo
            </a>
          ) : (
            <span className="rounded-sm border border-line bg-white/[0.03] px-5 py-3 text-center text-sm font-semibold text-faint">
              Operational workspace temporarily unavailable
            </span>
          )}
          <a href="/demo" className="rounded-sm border border-line bg-white/[0.03] px-5 py-3 text-center text-sm font-semibold text-ink hover:border-sync/60">
            Explore sample workspace
          </a>
        </div>
        <p className="mt-5 text-xs text-faint">Sample data is fictional, tab-scoped, and reset when the tab closes.</p>
      </section>
    </main>
  )
}
