import { useEffect, useRef, useState } from 'react'
import type { DataCategoryId, DataExportPreviewDto, DataImportPreviewDto, DataPortabilityReceiptDto, ProjectFolderSummaryDto, UsageQueryDto } from '../../shared/companion-contract'
import type { OperationalRepository } from '../lib/operational-repository'
import { downloadTelemetry, importTelemetryJSONL, loadTelemetry } from '../lib/telemetry'
import type { View } from '../types'
import type { AgentActivityIntegrationDto } from '../../shared/companion-contract'
import { AgentActivityControls } from './AgentActivityControls'

const EMPTY_USAGE_FILTERS: UsageQueryDto = { start: null, end: null, clientId: null, providerId: null, modelId: null, profileId: null, mappingState: null }
const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export function DataPrivacyView({ repository, sample = false, onImported, onNavigate }: { repository?: OperationalRepository; sample?: boolean; onImported?: () => void; onNavigate?: (view: View) => void }) {
  const [agentActivity, setAgentActivity] = useState<AgentActivityIntegrationDto[]>([])
  const [preview, setPreview] = useState<DataExportPreviewDto>()
  const [selected, setSelected] = useState<DataCategoryId[]>([])
  const [importPreview, setImportPreview] = useState<DataImportPreviewDto>()
  const [importSelected, setImportSelected] = useState<DataCategoryId[]>([])
  const [receipt, setReceipt] = useState<DataPortabilityReceiptDto>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [legacyCount, setLegacyCount] = useState(() => typeof window === 'undefined' ? 0 : loadTelemetry().length)
  const [folders, setFolders] = useState<ProjectFolderSummaryDto[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const receiptRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (sample || !repository?.getDataExportPreview) return
    let active = true
    setBusy(true)
    repository.getDataExportPreview().then((next) => {
      if (!active) return
      setPreview(next)
      setSelected(next.categories.filter((category) => category.selectedByDefault && category.exportable).map((category) => category.id))
      setError(undefined)
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : 'Data preview is unavailable.')).finally(() => active && setBusy(false))
    return () => { active = false }
  }, [repository, sample])

  useEffect(() => { if (!sample) void repository?.listProjectFolders?.().then(setFolders).catch(() => undefined) }, [repository, sample])
  useEffect(() => { if (!sample) void repository?.listAgentActivityIntegrations?.().then(setAgentActivity).catch(() => undefined) }, [repository, sample])

  const updateFolder = async (folder: ProjectFolderSummaryDto, input: { state?: 'active' | 'paused'; sddEnrichmentEnabled?: boolean }) => {
    if (!repository?.updateProjectFolder) return
    try { const updated = await repository.updateProjectFolder(folder.id, input); setFolders((current) => current.map((value) => value.id === folder.id ? updated : value)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Project folder could not be updated.') }
  }

  const removeFolder = async (folder: ProjectFolderSummaryDto) => {
    if (!repository?.removeProjectFolder) return
    try { if (await repository.removeProjectFolder(folder.id)) setFolders((current) => current.filter((value) => value.id !== folder.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Project folder could not be removed.') }
  }

  useEffect(() => {
    if (receipt) receiptRef.current?.focus()
  }, [receipt])

  if (sample) return <section className="panel rounded-sm p-6" aria-labelledby="sample-data-title"><p className="hud-label">Sample workspace</p><h2 id="sample-data-title" className="mt-2 text-xl font-semibold">Data & Privacy</h2><p className="mt-2 text-sm text-mut">This fictional workspace cannot access, download, restore, or change private companion data. Open the Operational workspace for your own local records.</p></section>

  const download = async () => {
    if (!repository?.downloadDataBundle || selected.length === 0) return
    setBusy(true); setError(undefined); setReceipt(undefined)
    try {
      await repository.downloadDataBundle(selected)
      setReceipt({ schema: 'findmnemo.data-portability-receipt.v1', operation: 'export', outcome: 'complete', completedAt: new Date().toISOString(), artifactName: null, categories: selected.map((id) => ({ id, added: 0, skipped: 0, conflicts: 0, excluded: 0, failed: 0 })), nextAction: 'Store the downloaded file somewhere private.' })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Data download failed.') } finally { setBusy(false) }
  }

  const chooseFile = () => fileRef.current?.click()
  const readFile = async (file: File) => {
    if (!repository?.previewDataImport) return
    setBusy(true); setError(undefined); setReceipt(undefined); setImportPreview(undefined); setImportSelected([])
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose a FindMnemo bundle smaller than 10 MB.')
      const parsed: unknown = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Choose a FindMnemo JSON bundle.')
      const next = await repository.previewDataImport(parsed as Record<string, unknown>)
      setImportPreview(next)
      setImportSelected(next.categories.filter((category) => category.importable && category.counts.add > 0).map((category) => category.id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import preview failed.') } finally { setBusy(false) }
  }

  const commit = async () => {
    if (!repository?.commitDataImport || !importPreview || importSelected.length === 0) return
    setBusy(true); setError(undefined)
    try {
      const next = await repository.commitDataImport({ planId: importPreview.planId, categoryIds: importSelected, idempotencyKey: crypto.randomUUID() })
      setReceipt(next); setImportPreview(undefined); setImportSelected([]); onImported?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import failed. Current records were preserved.') } finally { setBusy(false) }
  }

  const downloadUsage = async (format: 'json' | 'csv') => {
    if (!repository?.downloadUsageExport) return
    setBusy(true); setError(undefined)
    try { await repository.downloadUsageExport(EMPTY_USAGE_FILTERS, format, true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Usage download failed.') }
    finally { setBusy(false) }
  }

  const downloadObservedWork = async () => {
    setBusy(true); setError(undefined)
    try {
      const { downloadObservedWorkExport } = await import('../lib/ontology')
      downloadObservedWorkExport()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Observed-work download failed.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <section className="panel rounded-sm p-5" aria-labelledby="sources-title">
      <p className="hud-label">What FindMnemo reads</p><h2 id="sources-title" className="mt-2 text-xl font-semibold">Sources and project folders</h2>
      <p className="mt-1 text-sm text-mut">Sources are optional. Project folders stay on this computer; the browser receives only a label, type, freshness, and private ID.</p>
      <div className="mt-4 flex flex-wrap gap-2">{onNavigate && <><button type="button" onClick={() => onNavigate('emails')} className="rounded-sm border border-line px-3 py-2 text-sm">Set up Gmail follow-up</button><button type="button" onClick={() => onNavigate('routing')} className="rounded-sm border border-line px-3 py-2 text-sm">Set up AI engines</button><button type="button" onClick={() => onNavigate('usage')} className="rounded-sm border border-line px-3 py-2 text-sm">Refresh model usage</button></>}<button type="button" onClick={() => void repository?.listProjectFolders?.().then(setFolders)} className="rounded-sm border border-sync/50 px-3 py-2 text-sm text-sync">Refresh folder list</button></div>
      <p className="mt-3 text-xs text-mut">To add one or several folders, open the installed FindMnemo window and choose <strong className="text-ink">Connect project folders</strong>. If you do not use project folders or SDD, you can leave this empty.</p>
      {folders.length ? <ul className="mt-4 grid gap-3 md:grid-cols-2">{folders.map((folder) => <li key={folder.id} className="rounded-sm border border-line p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-medium text-ink">{folder.label}</p><p className="text-xs text-mut">{folder.detectedKind === 'sdd' ? 'Project with SDD enrichment available' : folder.detectedKind === 'git' ? 'Git project' : folder.detectedKind === 'generic' ? 'General project folder' : 'Folder unavailable'} · {folder.lastSuccessAt ? `checked ${new Date(folder.lastSuccessAt).toLocaleString()}` : 'not checked successfully'}</p></div><span className="text-[10px] font-mono uppercase text-memory">{folder.state}</span></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void updateFolder(folder, { state: folder.state === 'active' ? 'paused' : 'active' })} className="rounded-sm border border-line px-3 py-2 text-xs">{folder.state === 'active' ? 'Pause' : 'Resume'}</button>{folder.detectedKind === 'sdd' && <button type="button" onClick={() => void updateFolder(folder, { sddEnrichmentEnabled: !folder.sddEnrichmentEnabled })} className="rounded-sm border border-line px-3 py-2 text-xs">{folder.sddEnrichmentEnabled ? 'Turn off SDD details' : 'Use SDD details'}</button>}<button type="button" onClick={() => void removeFolder(folder)} className="rounded-sm border border-alert/40 px-3 py-2 text-xs text-alert">Remove from FindMnemo</button></div></li>)}</ul> : <p className="mt-4 rounded-sm border border-dashed border-line p-4 text-sm text-mut">No project folders are connected. That is a valid setup.</p>}
    </section>
    <section className="panel rounded-sm p-5" aria-labelledby="agent-activity-privacy-title"><p className="hud-label">Agent activity</p><h2 id="agent-activity-privacy-title" className="mt-2 text-xl font-semibold">Manage Codex, Claude Code, and Pi tracking</h2><p className="mt-1 text-sm text-mut">Each agent is independent. Detection, support, setup, enablement, freshness, and failures are shown separately. Removing tracking never deletes tickets, folders, files, or SDD work.</p><AgentActivityControls integrations={agentActivity} repository={repository} sample={sample} /></section>
    <section className="panel rounded-sm p-5" aria-labelledby="download-data-title">
      <p className="hud-label">Local operational data</p>
      <h2 id="download-data-title" className="mt-2 text-xl font-semibold">Download my data</h2>
      <p className="mt-1 text-sm text-mut">Choose what to include. The local companion creates one readable bundle with a manifest and compatible category artifacts.</p>
      {busy && !preview && <p className="mt-4 text-sm text-mut" role="status">Checking available local data…</p>}
      {preview && <fieldset className="mt-4 space-y-2"><legend className="sr-only">Export categories</legend>{preview.categories.map((category) => <label key={category.id} className={`block rounded-sm border border-line p-3 ${category.exportable ? 'cursor-pointer' : 'opacity-60'}`}>
        <span className="flex items-start gap-3"><input type="checkbox" checked={selected.includes(category.id)} disabled={!category.exportable || category.state === 'unavailable'} onChange={(event) => setSelected((current) => event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id))} className="mt-1" /><span className="min-w-0"><span className="font-medium text-ink">{category.label}</span><span className="ml-2 text-xs font-mono uppercase text-memory">{category.state}</span><span className="block text-sm text-mut">{category.description}</span><span className="block text-xs text-mut">{category.recordCount === null ? 'Count unknown' : `${category.recordCount} record${category.recordCount === 1 ? '' : 's'}`} · {category.coverage}</span>{category.id === 'email-metadata' && <span className="block text-xs text-amber-300">Off by default because email metadata is more sensitive.</span>}</span></span>
      </label>)}</fieldset>}
      {preview && <div className="mt-4 rounded-sm border border-line bg-chrome/40 p-3 text-xs text-mut"><p className="font-medium text-ink">Always excluded</p>{preview.exclusions.map((item) => <p key={item}>• {item}</p>)}</div>}
      <button type="button" onClick={() => void download()} disabled={busy || selected.length === 0} className="mt-4 rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-50">{busy ? 'Working…' : 'Download selected data'}</button>
    </section>

    <section className="panel rounded-sm p-5" aria-labelledby="restore-data-title">
      <p className="hud-label">Preview first</p><h2 id="restore-data-title" className="mt-2 text-xl font-semibold">Restore or move data</h2>
      <p className="mt-1 text-sm text-mut">Choose a FindMnemo bundle. Nothing changes until you review the result and confirm.</p>
      <input ref={fileRef} type="file" accept=".json,.findmnemo.json,application/json" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = '' }} />
      <button type="button" onClick={chooseFile} disabled={busy} className="mt-4 rounded-sm border border-memory/50 px-4 py-2 text-sm text-memory disabled:opacity-50">Choose bundle</button>
      {importPreview && <div className="mt-4 space-y-2" role="region" aria-label="Import preview"><p className="font-medium text-ink">Import preview</p><p className="text-xs text-mut">This preview expires at {new Date(importPreview.expiresAt).toLocaleTimeString()} or when the companion restarts.</p>{importPreview.categories.map((category) => { const selectable = category.importable && category.counts.add > 0; return <label key={category.id} className="block rounded-sm border border-line p-3 text-sm"><span className="flex items-start gap-3">{selectable && <input type="checkbox" checked={importSelected.includes(category.id)} onChange={(event) => setImportSelected((current) => event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id))} className="mt-1" />}<span><span className="font-medium text-ink">{category.id}</span><span className="block text-mut">{category.counts.add} add · {category.counts.duplicate} duplicate · {category.counts.conflict} conflict · {category.counts.excluded} excluded · {category.counts.unsupported} unsupported</span><span className="block text-xs text-mut">{category.note}</span></span></span></label>})}<button type="button" onClick={() => void commit()} disabled={busy || !importPreview.safeToCommit || importSelected.length === 0} className="rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-50">Confirm selected safe additions</button><p className="text-xs text-mut">Existing ticket IDs are preserved. Export-only evidence is never imported as locally observed truth.</p></div>}
    </section>

    <section className="panel rounded-sm p-5" aria-labelledby="local-controls-title"><p className="hud-label">Existing local controls</p><h2 id="local-controls-title" className="mt-2 text-xl font-semibold">Manage local data</h2><p className="mt-1 text-sm text-mut">Use the owning feature for replacement, clear, disconnect, and re-authorization confirmations.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !repository?.downloadUsageExport} onClick={() => void downloadUsage('json')} className="rounded-sm border border-line px-3 py-2 text-sm disabled:opacity-50">Download Usage JSON</button><button type="button" disabled={busy || !repository?.downloadUsageExport} onClick={() => void downloadUsage('csv')} className="rounded-sm border border-line px-3 py-2 text-sm disabled:opacity-50">Download Usage CSV</button>{onNavigate && <><button type="button" onClick={() => onNavigate('routing')} className="rounded-sm border border-line px-3 py-2 text-sm">Open routing portability</button><button type="button" onClick={() => onNavigate('usage')} className="rounded-sm border border-line px-3 py-2 text-sm">Open Usage data controls</button><button type="button" onClick={() => onNavigate('emails')} className="rounded-sm border border-line px-3 py-2 text-sm">Open Gmail controls</button></>}</div></section>

    <details className="panel rounded-sm p-5"><summary className="cursor-pointer font-semibold text-ink">Advanced compatibility</summary><div className="mt-4 space-y-4 text-sm text-mut"><div><p className="font-medium text-ink">Current and legacy identity</p><p>Current product: FindMnemo. Legacy identifiers remain readable: <code>mnemosync</code>, <code>mnemosync://</code>, and existing local storage keys.</p></div><div><p className="font-medium text-ink">Observed-work compatibility</p><button type="button" disabled={busy} onClick={() => void downloadObservedWork()} className="mt-2 rounded-sm border border-line px-3 py-2 text-sm disabled:opacity-50">Download legacy-compatible observed work</button></div><div><p className="font-medium text-ink">Legacy activity from this browser — not your complete operational data</p><p>{legacyCount} browser-local event{legacyCount === 1 ? '' : 's'} found. This temporary compatibility tool will be reviewed after one release.</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy || legacyCount === 0} onClick={() => downloadTelemetry()} className="rounded-sm border border-line px-3 py-2 disabled:opacity-50">Download legacy activity</button><label className="cursor-pointer rounded-sm border border-line px-3 py-2">Import legacy activity<input type="file" accept=".json,.jsonl,.txt" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; void file.text().then((text) => { importTelemetryJSONL(text); setLegacyCount(loadTelemetry().length) }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Legacy activity import failed.')); event.target.value = '' }} /></label></div></div></div></details>

    {error && <p role="alert" className="rounded-sm border border-alert/50 bg-alert/10 p-3 text-sm text-alert">{error}</p>}
    {receipt && <section ref={receiptRef} tabIndex={-1} className="rounded-sm border border-sync/40 bg-sync/10 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sync" aria-label="Data operation receipt" aria-live="polite"><p className="font-semibold text-ink">{receipt.operation === 'export' ? 'Download prepared' : `Import ${receipt.outcome}`}</p><p className="text-sm text-mut">{receipt.nextAction}</p></section>}
  </div>
}
