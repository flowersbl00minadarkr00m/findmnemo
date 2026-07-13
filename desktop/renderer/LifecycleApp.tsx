import { useEffect, useState } from 'react'
import type { AdoptionSnapshot, LifecycleDiagnosticReport, LifecycleState, SupportBundlePreview, UninstallChoice, UninstallPreview } from '../../shared/lifecycle-contract'

export function LifecycleApp() {
  const [state, setState] = useState<LifecycleState>()
  const [pending, setPending] = useState(false)
  const [startAtLogin, setStartAtLogin] = useState(false)
  const [diagnosticReport, setDiagnosticReport] = useState<LifecycleDiagnosticReport>()
  const [supportPreview, setSupportPreview] = useState<SupportBundlePreview>()
  const [supportResult, setSupportResult] = useState<string>()
  const [adoption, setAdoption] = useState<AdoptionSnapshot>()
  const [uninstallChoice, setUninstallChoice] = useState<UninstallChoice>('preserve-data')
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [uninstallPreview, setUninstallPreview] = useState<UninstallPreview>()
  const [uninstallResult, setUninstallResult] = useState<string>()

  useEffect(() => {
    void window.findMnemoLifecycle.snapshot().then(setState)
    void window.findMnemoLifecycle.inspectExistingState().then(setAdoption)
    return window.findMnemoLifecycle.subscribe(setState)
  }, [])

  async function command(action: 'start' | 'stop' | 'restart') {
    setPending(true)
    try {
      const result = action === 'start'
        ? await window.findMnemoLifecycle.startCompanion()
        : action === 'stop'
          ? await window.findMnemoLifecycle.stopCompanion()
          : await window.findMnemoLifecycle.restartCompanion()
      setState(result.state)
    } finally { setPending(false) }
  }

  async function acceptDisclosure() {
    setPending(true)
    try { setState((await window.findMnemoLifecycle.acceptDisclosure(startAtLogin)).state) }
    finally { setPending(false) }
  }

  async function changeStartup(enabled: boolean) {
    setPending(true)
    try { setState((await window.findMnemoLifecycle.setStartAtLogin(enabled)).state) }
    finally { setPending(false) }
  }

  async function runDiagnostics() {
    setPending(true)
    try { setDiagnosticReport(await window.findMnemoLifecycle.runDiagnostics()) }
    finally { setPending(false) }
  }

  async function previewSupport() {
    setPending(true)
    try { setSupportPreview(await window.findMnemoLifecycle.previewSupportBundle()) }
    finally { setPending(false) }
  }

  async function saveSupport() {
    if (!supportPreview) return
    const destination = await window.findMnemoLifecycle.chooseSupportDestination()
    if (!destination) return
    const result = await window.findMnemoLifecycle.saveSupportBundle(supportPreview.previewId, destination)
    setSupportResult(result.ok ? `Saved ${result.fileName}.` : `Save failed: ${result.errorCode}.`)
  }

  async function update(action: 'check' | 'download' | 'cancel' | 'activate') {
    setPending(true)
    try {
      const next = action === 'check' ? await window.findMnemoLifecycle.checkForUpdates()
        : action === 'download' ? await window.findMnemoLifecycle.downloadUpdate()
          : action === 'cancel' ? await window.findMnemoLifecycle.cancelUpdateDownload()
            : await window.findMnemoLifecycle.activateUpdate()
      setState(next)
    } finally { setPending(false) }
  }

  async function adoptExistingState() {
    setPending(true)
    try {
      setAdoption(await window.findMnemoLifecycle.adoptExistingState())
      setState(await window.findMnemoLifecycle.snapshot())
    } finally { setPending(false) }
  }

  async function prepareUninstall() {
    setPending(true)
    try { setUninstallPreview(await window.findMnemoLifecycle.prepareUninstall(uninstallChoice, deleteConfirmed)) }
    finally { setPending(false) }
  }

  async function launchUninstaller() {
    const result = await window.findMnemoLifecycle.launchUninstaller()
    if (!result.ok) setUninstallResult('The standard installed uninstaller is unavailable in this development package.')
  }

  if (state?.phase === 'first-run') return <main>
    <header><span className="fish">◀◉▶</span><div><p className="eyebrow">FINDMNEMO</p><h1>Set up your private companion</h1></div></header>
    <section className="status disclosure" aria-labelledby="privacy-heading">
      <p className="label">BEFORE THE COMPANION STARTS</p>
      <h2 id="privacy-heading">Your operational data stays on this computer.</h2>
      <ul>
        <li>Tickets, Gmail metadata, audit history, and credentials remain under the local companion boundary.</li>
        <li>The hosted app may request normalized operational records only after local pairing.</li>
        <li>Provider credentials, raw email bodies, prompts, and responses are not exposed to this control window.</li>
      </ul>
      <label className="choice"><input type="checkbox" checked={startAtLogin} onChange={(event) => setStartAtLogin(event.target.checked)} /> Start FindMnemo when I sign in to Windows <span>(optional; off by default)</span></label>
      <button className="primary" disabled={pending} onClick={() => void acceptDisclosure()}>{pending ? 'Starting…' : 'Accept and start companion'}</button>
    </section>
    <footer>Disclosure version {state.disclosure.version}. You can change startup behavior later.</footer>
  </main>

  return <main>
    <header><span className="fish">◀◉▶</span><div><p className="eyebrow">FINDMNEMO</p><h1>Private companion</h1></div></header>
    <section className="status" aria-live="polite">
      <p className="label">COMPANION STATUS</p>
      <h2>{state?.phase ?? 'Loading…'}</h2>
      <p>{state?.phase === 'healthy' ? 'The verified local companion owns operational data on this computer.' : 'FindMnemo is checking the local runtime boundary.'}</p>
      {state?.companion.errorCode && <p className="error">{state.companion.errorCode}: the companion was not reported healthy.</p>}
      <dl><div><dt>App</dt><dd>{state?.appVersion ?? '—'}</dd></div><div><dt>Protocol</dt><dd>{state?.protocolVersion ?? '—'}</dd></div><div><dt>Listener</dt><dd>{state?.companion.host ? `${state.companion.host}:${state.companion.port}` : 'stopped'}</dd></div></dl>
    </section>
    {adoption && !['already-adopted', 'adopted', 'fresh'].includes(adoption.state) && <section className="status disclosure" aria-labelledby="adoption-heading">
      <p className="label">EXISTING LOCAL STATE</p><h2 id="adoption-heading">Adopt your current FindMnemo workspace</h2>
      <p>Operational data stays in {adoption.retainedLocation}; it is not moved or duplicated.</p>
      <ul><li>Database: {adoption.databasePresent ? `schema ${adoption.schemaVersion ?? 'unknown'}` : 'not present'}</li><li>Gmail credential: {adoption.credentialPresent ? 'present (value not inspected)' : 'not present'}</li><li>Listener: {adoption.listener}</li></ul>
      {adoption.backupRequired && <p>A pre-adoption backup will be created before the schema is updated.</p>}
      {adoption.errorCode && <p className="error">{adoption.errorCode}</p>}
      {adoption.state === 'requires-stop' && <p>Close the compatible developer-run companion, then retry. FindMnemo will never terminate an unknown process.</p>}
      {adoption.state === 'ready' && <button className="primary" disabled={pending} onClick={() => void adoptExistingState()}>Adopt and start</button>}
      {adoption.state === 'requires-stop' && <button disabled={pending} onClick={() => void window.findMnemoLifecycle.inspectExistingState().then(setAdoption)}>Retry inspection</button>}
    </section>}
    <section className="actions" aria-label="Companion controls">
      <button disabled={pending || state?.companion.state === 'healthy'} onClick={() => void command('start')}>Start</button>
      <button disabled={pending || state?.companion.state !== 'healthy'} onClick={() => void command('stop')}>Stop</button>
      <button disabled={pending || state?.companion.state !== 'healthy'} onClick={() => void command('restart')}>Restart</button>
    </section>
    <section className="links">
      <button onClick={() => void window.findMnemoLifecycle.openTrustedTarget('hosted-app')}>Open FindMnemo</button>
      <button onClick={() => void window.findMnemoLifecycle.openTrustedTarget('local-app')}>Open local workspace</button>
    </section>
    {state?.disclosure.acceptedAt && <section className="preference">
      <label className="choice"><input type="checkbox" checked={state.startup.enabled} disabled={pending} onChange={(event) => void changeStartup(event.target.checked)} /> Start FindMnemo when I sign in to Windows</label>
      <p>Startup is user-controlled and currently <strong>{state.startup.enabled ? 'on' : 'off'}</strong>.</p>
    </section>}
    {state?.disclosure.acceptedAt && <section className="diagnostics" aria-labelledby="diagnostics-heading">
      <p className="label">LOCAL HEALTH</p><h2 id="diagnostics-heading">Diagnostics</h2>
      <div className="links"><button disabled={pending} onClick={() => void runDiagnostics()}>Run diagnostics</button><button disabled={pending} onClick={() => void previewSupport()}>Preview support bundle</button></div>
      {diagnosticReport && <ul>{diagnosticReport.checks.map((check) => <li key={check.id}><strong>{check.state}: {check.code}</strong><span>{check.message}</span></li>)}</ul>}
      {supportPreview && <div className="preview"><p>This bundle contains only:</p><ul>{supportPreview.fields.map((field) => <li key={field}>{field}</li>)}</ul><button className="primary" onClick={() => void saveSupport()}>Choose location and save</button></div>}
      {supportResult && <p aria-live="polite">{supportResult}</p>}
    </section>}
    {state?.disclosure.acceptedAt && <section className="diagnostics" aria-labelledby="updates-heading">
      <p className="label">SIGNED RELEASE CHANNEL</p><h2 id="updates-heading">Updates</h2>
      <p aria-live="polite">State: <strong>{state.update.state}</strong>{state.update.targetVersion ? ` — version ${state.update.targetVersion}` : ''}{state.update.progress !== undefined ? ` — ${Math.round(state.update.progress)}%` : ''}</p>
      {state.update.releaseNotes && <p>{state.update.releaseNotes}</p>}
      {state.update.permissionChanges && state.update.permissionChanges.length > 0 && <div className="preview"><p>This update declares permission changes:</p><ul>{state.update.permissionChanges.map((change) => <li key={change}>{change}</li>)}</ul></div>}
      {state.update.errorCode && <p className="error">{state.update.errorCode}. The current companion remains unchanged.</p>}
      <div className="links">
        <button disabled={pending || ['checking', 'downloading', 'activating'].includes(state.update.state)} onClick={() => void update('check')}>Check for updates</button>
        {state.update.state === 'available' && <button className="primary" disabled={pending} onClick={() => void update('download')}>Download update</button>}
        {state.update.state === 'downloading' && <button disabled={pending} onClick={() => void update('cancel')}>Cancel download</button>}
        {state.update.state === 'ready' && <button className="primary" disabled={pending} onClick={() => void update('activate')}>Install and restart</button>}
      </div>
      <p>Download never activates automatically. Install and restart first stops local work and backs up operational state.</p>
    </section>}
    {state?.disclosure.acceptedAt && <section className="diagnostics" aria-labelledby="uninstall-heading">
      <p className="label">DATA CONTROL</p><h2 id="uninstall-heading">Uninstall FindMnemo</h2>
      <fieldset><legend>Choose what happens to local data</legend>
        <label className="choice"><input type="radio" name="uninstall-choice" checked={uninstallChoice === 'preserve-data'} onChange={() => { setUninstallChoice('preserve-data'); setDeleteConfirmed(false); setUninstallPreview(undefined) }} /> Remove application; preserve tickets, settings, logs, and Gmail credential (default)</label>
        <label className="choice"><input type="radio" name="uninstall-choice" checked={uninstallChoice === 'remove-credentials'} onChange={() => { setUninstallChoice('remove-credentials'); setDeleteConfirmed(false); setUninstallPreview(undefined) }} /> Remove application and Gmail credential; preserve tickets, settings, and logs</label>
        <label className="choice"><input type="radio" name="uninstall-choice" checked={uninstallChoice === 'delete-all-data'} onChange={() => { setUninstallChoice('delete-all-data'); setUninstallPreview(undefined) }} /> Remove application and delete all local FindMnemo data</label>
      </fieldset>
      {uninstallChoice === 'delete-all-data' && <label className="choice"><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} /> I understand this permanently deletes tickets, audit history, settings, logs, and credentials.</label>}
      <button disabled={pending || (uninstallChoice === 'delete-all-data' && !deleteConfirmed)} onClick={() => void prepareUninstall()}>Preview uninstall</button>
      {uninstallPreview && !uninstallPreview.secondConfirmationRequired && <div className="preview"><p>Removes:</p><ul>{uninstallPreview.removes.map((item) => <li key={item}>{item}</li>)}</ul><p>Retains:</p>{uninstallPreview.retains.length ? <ul>{uninstallPreview.retains.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nothing under the local FindMnemo data root.</p>}<button className="primary" onClick={() => void launchUninstaller()}>Continue to standard uninstaller</button></div>}
      {uninstallResult && <p className="error">{uninstallResult}</p>}
    </section>}
    <footer>Operational data, Gmail credentials, and pairing sessions remain local. This control window cannot access provider credentials or arbitrary files.</footer>
  </main>
}
