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
          Explore a complete fictional product tour in this browser, or connect the operational workspace after installing and starting the private local companion.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href="/demo" className="rounded-sm bg-sync px-5 py-3 text-center text-sm font-semibold text-chrome hover:bg-[#E8641C]">
            Explore sample workspace
          </a>
          {operationalEnabled ? (
            <a href="/app" className="rounded-sm border border-line bg-white/[0.03] px-5 py-3 text-center text-sm font-semibold text-ink hover:border-sync/60">
              Connect operational workspace
            </a>
          ) : (
            <span className="rounded-sm border border-line bg-white/[0.03] px-5 py-3 text-center text-sm font-semibold text-faint">
              Operational workspace temporarily unavailable
            </span>
          )}
        </div>
        <div className="mt-5 grid gap-2 text-xs leading-5 text-faint sm:grid-cols-2"><p><span className="font-medium text-ink">Sample:</span> fictional, tab-scoped, and requires no installation.</p><p><span className="font-medium text-ink">Operational:</span> requires the Windows companion installed and running on this computer.</p></div>
      </section>
    </main>
  )
}
