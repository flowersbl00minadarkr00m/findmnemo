import { useEffect, useState } from 'react'
import { getWorkspaceKind } from './lib/settings'
import { WorkspaceLanding } from './components/WorkspaceLanding'
import { OperationalOnboarding } from './components/OperationalOnboarding'
import { SampleWorkspace } from './SampleWorkspace'

export function WorkspaceRouter() {
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const operationalEnabled = import.meta.env.VITE_LOCAL_COMPANION_ENABLED !== 'false'
  const sampleVerificationFixture = import.meta.env.DEV && new URLSearchParams(window.location.search).get('fixture') === 'sample'

  useEffect(() => {
    const update = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  const workspace = sampleVerificationFixture ? 'sample' : getWorkspaceKind(pathname)
  if (workspace === 'landing') return <WorkspaceLanding operationalEnabled={operationalEnabled} />
  if (workspace === 'sample') return <SampleWorkspace />
  if (workspace === 'operational' && operationalEnabled) return <OperationalOnboarding />
  if (workspace === 'operational') {
    return (
      <main className="min-h-screen bg-mist text-ink grid place-items-center px-5 py-10">
        <section className="panel hud-corners relative w-full max-w-2xl rounded-sm p-7 sm:p-10" role="status">
          <i /><i /><i /><i />
          <p className="hud-label">Operational workspace · temporarily unavailable</p>
          <h1 className="mt-4 text-3xl font-semibold">FindMnemo is in rollback mode.</h1>
          <p className="mt-4 text-sm leading-6 text-mut">
            The hosted operational entry is disabled. Your local database and Gmail credential remain on this computer and are not deleted by this rollback.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a href="/demo" className="rounded-sm bg-sync px-5 py-3 text-center text-sm font-semibold text-chrome">Explore fictional sample</a>
            <a href="http://127.0.0.1:3210/app" className="rounded-sm border border-line px-5 py-3 text-center text-sm font-semibold text-ink">Open local app (requires companion running)</a>
          </div>
        </section>
      </main>
    )
  }
  return <main className="min-h-screen bg-mist text-ink grid place-items-center"><div className="text-center"><h1 className="text-3xl font-semibold">Workspace not found</h1><a href="/" className="mt-4 inline-block text-sync">Return to FindMnemo</a></div></main>
}
