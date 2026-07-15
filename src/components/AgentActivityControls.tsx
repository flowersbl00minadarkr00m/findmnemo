import { useEffect, useState } from 'react'
import type { AgentActivityIntegrationDto, AgentActivityManagementReceiptDto } from '../../shared/companion-contract'
import type { OperationalRepository } from '../lib/operational-repository'

type ManagementAction = 'enable' | 'test' | 'pause' | 'reconnect' | 'remove' | 'snapshot' | 'clear-history'

export function AgentActivityControls({ integrations, repository, sample = false }: { integrations: AgentActivityIntegrationDto[]; repository?: OperationalRepository; sample?: boolean }) {
  const [items, setItems] = useState(integrations)
  const [busy, setBusy] = useState<string>()
  const [confirmingRemove, setConfirmingRemove] = useState<string>()
  const [receipt, setReceipt] = useState<AgentActivityManagementReceiptDto>()
  const [guidance, setGuidance] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => setItems(integrations), [integrations])

  const run = async (item: AgentActivityIntegrationDto, action: ManagementAction, confirmed = false) => {
    if (sample || !repository?.manageAgentActivity) return
    setBusy(item.id); setError(undefined); setGuidance(undefined)
    try {
      const next = await repository.manageAgentActivity(item.id, action, confirmed)
      setReceipt(next); setConfirmingRemove(undefined)
      if (repository.listAgentActivityIntegrations) setItems(await repository.listAgentActivityIntegrations())
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Agent activity action failed.') }
    finally { setBusy(undefined) }
  }

  const runPrimary = (item: AgentActivityIntegrationDto) => {
    const action = primaryAction(item)
    if (action) { void run(item, action, action !== 'test' && action !== 'snapshot'); return }
    setError(undefined); setReceipt(undefined); setGuidance(primaryGuidance(item))
  }

  return <div className="mt-4 grid gap-3 lg:grid-cols-3" aria-label="Agent activity coverage">
    {items.map((item) => <article key={item.id} className="rounded-sm border border-line bg-chrome/30 p-4">
      <div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-ink">{item.label}</h3><span className="rounded-full border border-line px-2 py-1 text-[10px] font-mono uppercase text-memory">{item.coverageState}</span></div>
      <p className="mt-2 text-sm text-mut">{item.coverageExplanation}</p>
      <p className="mt-2 text-xs text-mut">Version: {item.installedVersion ?? 'not detected'} - Support: {supportText(item)}</p>
      <p className="mt-1 text-xs text-mut">Last event: {item.lastEventAt ? new Date(item.lastEventAt).toLocaleString() : 'none yet'} - Freshness: {item.freshnessWindowSeconds}s</p>
      <dl className="mt-2 space-y-1 text-xs text-mut">
        <div><dt className="inline font-semibold text-ink">Agent account:</dt> <dd className="inline">{agentAuthText(item)}</dd></div>
        <div><dt className="inline font-semibold text-ink">FindMnemo connection:</dt> <dd className="inline">{integrationAuthText(item)}</dd></div>
        <div><dt className="inline font-semibold text-ink">Hook trust:</dt> <dd className="inline">{trustText(item)}</dd></div>
        {item.statusCheckedAt && <div><dt className="inline font-semibold text-ink">Status checked:</dt> <dd className="inline">{new Date(item.statusCheckedAt).toLocaleString()}</dd></div>}
      </dl>
      {item.retainedLastSuccess && <p className="mt-1 text-xs text-amber-300">Last successful state is retained while this connection recovers.</p>}
      {(item.pendingEventCount > 0 || item.gapCount > 0) && <p className="mt-1 text-xs text-amber-300">{item.pendingEventCount} queued event(s) - {item.gapCount} sequence gap(s). Queue contents are never shown.</p>}
      <dl className="mt-3 space-y-1 text-xs text-mut"><div><dt className="font-semibold text-ink">Stored</dt><dd>Assignment status and time, safe agent/model labels, approved project ID, and explicit outcome evidence.</dd></div><div><dt className="font-semibold text-ink">Always excluded</dt><dd>Prompts, responses, reasoning, transcripts, credentials, raw logs, tool details, and file contents.</dd></div></dl>
      {!sample && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy === item.id} onClick={() => runPrimary(item)} className="rounded-sm bg-sync px-3 py-2 text-xs font-semibold text-chrome disabled:opacity-50">{primaryLabel(item)}</button>
        {canSnapshot(item) && <button type="button" disabled={busy === item.id} onClick={() => void run(item, 'snapshot')} className="rounded-sm border border-line px-3 py-2 text-xs">Snapshot current work</button>}
        {item.configured && <button type="button" disabled={busy === item.id} onClick={() => void run(item, item.enabled ? 'pause' : 'reconnect', true)} className="rounded-sm border border-line px-3 py-2 text-xs">{item.enabled ? 'Pause' : 'Resume'}</button>}
        {item.configured && (confirmingRemove === item.id ? <button type="button" onClick={() => void run(item, 'remove', true)} className="rounded-sm border border-alert px-3 py-2 text-xs text-alert">Confirm remove FindMnemo setup</button> : <button type="button" onClick={() => setConfirmingRemove(item.id)} className="rounded-sm border border-alert/40 px-3 py-2 text-xs text-alert">Remove integration</button>)}
        {item.configured && <button type="button" onClick={() => void run(item, 'clear-history', true)} className="rounded-sm border border-line px-3 py-2 text-xs">Clear source history</button>}
      </div>}
    </article>)}
    {!items.length && <p className="text-sm text-mut">Agent detection is unavailable. Manual reporting remains available from the installed app.</p>}
    {error && <p role="alert" className="text-sm text-alert">{error}</p>}
    {guidance && <p role="status" aria-live="polite" className="text-sm text-sync">{guidance}</p>}
    {receipt && <p role="status" aria-live="polite" className="text-sm text-sync">{receipt.nextAction}</p>}
  </div>
}

function primaryAction(item: AgentActivityIntegrationDto): Extract<ManagementAction, 'enable' | 'test' | 'reconnect' | 'snapshot'> | null {
  if (item.primaryAction === 'enable') return 'enable'
  if (item.primaryAction === 'reconnect' || item.primaryAction === 'resume') return 'reconnect'
  if (item.primaryAction === 'review-gap') return 'snapshot'
  if (item.primaryAction === 'test') return 'test'
  return null
}
function primaryLabel(item: AgentActivityIntegrationDto): string { return item.primaryAction === 'enable' ? 'Enable tracking' : item.primaryAction === 'reconnect' ? 'Reconnect' : item.primaryAction === 'resume' ? 'Resume' : item.primaryAction === 'review-gap' ? 'Review coverage gap' : item.primaryAction === 'manual-report' ? 'Check manual reporting' : item.primaryAction === 'sign-in' ? `Sign in to ${item.label}` : item.primaryAction === 'check-status' ? item.agentAuthState === 'unavailable' ? 'Check agent status' : 'Verify hook delivery' : 'Run safe test' }
function supportText(item: AgentActivityIntegrationDto): string { return `detection ${item.capabilities.detection ? 'yes' : 'no'}, manual yes, snapshot ${item.capabilities.snapshot}, automatic events ${item.capabilities.automaticEvents}, automatic terminal ${item.capabilities.automaticTerminal}` }
function primaryGuidance(item: AgentActivityIntegrationDto): string {
  if (item.primaryAction === 'manual-report') return `Use the FindMnemo MCP activity tools, or run npm run report:activity -- --agent=${item.agent} --action=start --assignment=<safe-id> --summary="<safe summary>". Automatic snapshots remain off for this version.`
  if (item.primaryAction === 'sign-in') return `Sign in from a terminal with ${item.agent === 'claude-code' ? 'claude login' : item.agent === 'codex-cli' ? 'codex login' : item.label}, then choose Reconnect. FindMnemo never receives the account credential.`
  if (item.agentAuthState === 'unavailable') return `Open ${item.label} and verify its account status, then return here. FindMnemo did not retain command output or account details.`
  return `Continue work in ${item.label}. Hook trust becomes verified only after the next privacy-minimized event reaches FindMnemo; no transcript is inspected.`
}
function agentAuthText(item: AgentActivityIntegrationDto): string { return ({ authenticated: 'Signed in', 'signed-out': 'Sign-in required', unknown: 'Unknown', unavailable: 'Check unavailable', 'not-applicable': 'Not applicable to this activity adapter' })[item.agentAuthState] }
function integrationAuthText(item: AgentActivityIntegrationDto): string { return ({ ready: 'Ready', missing: 'Credential missing', unavailable: 'Credential check unavailable', 'not-configured': 'Not configured' })[item.integrationAuthState] }
function trustText(item: AgentActivityIntegrationDto): string { return ({ trusted: 'Verified by a received event', untrusted: 'Owned setup missing or invalid', unknown: 'Waiting for the first safe event', unavailable: 'Setup check unavailable', 'not-applicable': 'Not applicable' })[item.trustState] }
function canSnapshot(item: AgentActivityIntegrationDto): boolean { return item.configured && item.capabilities.snapshot !== 'none' && item.agentAuthState !== 'signed-out' && item.agentAuthState !== 'unavailable' && item.integrationAuthState === 'ready' && item.trustState !== 'untrusted' && item.trustState !== 'unavailable' }
