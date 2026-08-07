import type { AgentActivityIntegrationDto } from '../../shared/companion-contract'

interface CoverageNoticeCopy {
  title: string
  detail: string
  action: string
  tone: 'neutral' | 'warning'
}

export function AgentActivityCoverageNotice({
  integrations,
  assignmentCount,
  loading = false,
  error,
  onOpenPrivacy,
}: {
  integrations: readonly AgentActivityIntegrationDto[]
  assignmentCount: number
  loading?: boolean
  error?: string
  onOpenPrivacy?: () => void
}) {
  if (assignmentCount > 0 && !error && integrations.every((item) => item.coverageState === 'connected' || item.coverageState === 'empty')) return null
  if (loading && integrations.length === 0) return <p role="status" className="rounded-sm border border-line px-4 py-3 text-sm text-mut">Checking agent tracking coverage…</p>

  const copy = coverageNoticeCopy(integrations, error)
  return (
    <section
      aria-label="Agent tracking coverage"
      className={`rounded-sm border px-4 py-4 ${copy.tone === 'warning' ? 'border-warn/50 bg-warn/10' : 'border-line bg-paper/60'}`}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <p className="hud-label">Agent ticket coverage</p>
          <h3 className="mt-1 text-base font-semibold text-ink">{copy.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-mut">{copy.detail}</p>
          {error && <p role="alert" className="mt-2 text-xs text-alert">Coverage check failed: {error}</p>}
        </div>
        {onOpenPrivacy && <button type="button" onClick={onOpenPrivacy} className="rounded-sm border border-sync/50 px-3 py-2 text-xs font-semibold text-sync hover:bg-sync/10">{copy.action}</button>}
      </div>
    </section>
  )
}

function coverageNoticeCopy(integrations: readonly AgentActivityIntegrationDto[], error?: string): CoverageNoticeCopy {
  if (error) return {
    title: 'Agent tracking is unavailable',
    detail: 'FindMnemo could not verify current coverage. Existing tickets and the last successful states are retained; review tracking before relying on automatic capture.',
    action: 'Review agent tracking',
    tone: 'warning',
  }

  if (integrations.length > 0 && integrations.every((item) => !item.supported || item.coverageState === 'unsupported')) return {
    title: 'Automatic tracking is unsupported for these agent versions',
    detail: 'FindMnemo detected the agents but cannot claim automatic lifecycle coverage for these versions. Use the privacy-minimized manual reporting action instead.',
    action: 'Review manual options',
    tone: 'warning',
  }

  if (integrations.length === 0 || integrations.every((item) => !item.configured || !item.enabled)) return {
    title: 'Automatic agent tracking is off',
    detail: 'Installing or using Codex, Claude Code, or Pi does not connect it to FindMnemo. Tickets are created only after an enabled integration reports an assignment; FindMnemo never scans private sessions or transcripts.',
    action: 'Set up agent tracking',
    tone: 'warning',
  }

  if (integrations.some((item) => item.coverageState === 'stale' || item.coverageState === 'unavailable')) return {
    title: 'Agent tracking needs attention',
    detail: 'Coverage is stale or unavailable. FindMnemo retains the last successful state but will not infer completion or claim that current work is observed.',
    action: 'Recover agent tracking',
    tone: 'warning',
  }

  if (integrations.some((item) => item.coverageState === 'partial' || item.gapCount > 0)) return {
    title: 'Agent tracking coverage is partial',
    detail: 'Some agents, projects, or event windows are not covered. Reported assignments remain valid, but unobserved work may not have a ticket.',
    action: 'Review coverage gaps',
    tone: 'warning',
  }

  return {
    title: 'Tracking is connected; no assignment observed',
    detail: 'No active assignment was reported in the current coverage window. This does not prove that no agent work exists; use a supported next interaction, snapshot, or manual report for work already underway.',
    action: 'Review agent tracking',
    tone: 'neutral',
  }
}
