import type { OnboardingSnapshotDto, OnboardingSourceDefinitionDto, ReconciliationRunDto, SourceId } from '../../shared/companion-contract.js'
import type { GmailServices } from '../gmail/gmail-services.js'
import type { ReconciliationEngine } from '../reconciliation/engine.js'
import type { ProjectFolderService } from './project-folder-service.js'
import type { AgentActivityManagementService } from '../agent-activity/management-service.js'

export class OnboardingService {
  private readonly reconciliation: ReconciliationEngine
  private readonly folders: ProjectFolderService
  private readonly gmail: GmailServices
  private readonly activity: AgentActivityManagementService | undefined

  constructor(
    reconciliation: ReconciliationEngine,
    folders: ProjectFolderService,
    gmail: GmailServices,
    activity?: AgentActivityManagementService,
  ) { this.reconciliation = reconciliation; this.folders = folders; this.gmail = gmail; this.activity = activity }

  async snapshot(): Promise<OnboardingSnapshotDto> {
    const lastRun = this.reconciliation.history(1)[0] ?? null
    const descriptors = this.reconciliation.sources()
    const projectFolders = this.folders.list()
    const gmailConnected = await this.gmail.connected()
    const agentActivity = await this.activity?.listIntegrations() ?? []
    const enabled = (id: SourceId) => descriptors.some((source) => source.id === id && source.enabled)
    const sources: OnboardingSourceDefinitionDto[] = [
      {
        id: 'gmail', label: 'Gmail follow-up',
        description: 'Find messages that appear to need a response from you.',
        privacy: 'Reads Gmail metadata locally after you approve Google access. Message bodies and credentials do not go to the hosted app.',
        produces: 'Follow-up candidates in Outreach; tickets only when you explicitly create or link one.',
        state: gmailConnected ? 'connected' : this.gmail.configured ? 'needs-setup' : 'unavailable',
        reconciliationSourceId: gmailConnected && enabled('gmail-followups') ? 'gmail-followups' : null,
        action: gmailConnected ? 'refresh' : 'set-up',
      },
      {
        id: 'project-folders', label: 'Project folders',
        description: 'Connect one or several folders you choose. SDD is optional.',
        privacy: 'Folder paths and file checks stay in the installed app. The browser receives only private IDs, labels, type, and freshness.',
        produces: 'Project progress when a supported source is present; generic folders remain connected with limited evidence.',
        state: projectFolders.length ? 'connected' : 'available', reconciliationSourceId: projectFolders.length && enabled('project-folders') ? 'project-folders' : null,
        action: projectFolders.length ? 'review' : 'set-up',
      },
      {
        id: 'agent-activity', label: 'Agent activity',
        description: 'Track one current-work ticket per Codex, Claude Code, or Pi assignment.',
        privacy: 'Stores safe assignment status, time, agent/model labels, and approved project IDs. Prompts, responses, reasoning, transcripts, credentials, raw logs, and file contents are always excluded.',
        produces: 'Current assignment status, freshness, coverage gaps, and explicit outcomes.', state: agentActivity.some((item) => item.enabled && item.configured) ? 'connected' : agentActivity.some((item) => item.installedVersion) ? 'available' : 'needs-setup',
        reconciliationSourceId: null, action: agentActivity.some((item) => item.enabled && item.configured) ? 'review' : 'view-details', agentActivity,
      },
      {
        id: 'model-usage', label: 'Model usage',
        description: 'Read locally observed token and estimated-cost records.',
        privacy: 'Usage totals are processed locally. Prompts, responses, provider credentials, and raw logs are excluded.',
        produces: 'Model, provider, client, trend, and coverage views in Metrics.', state: 'available', reconciliationSourceId: null, action: 'review',
      },
    ]
    return { schemaVersion: 1, needsSetup: !lastRun, sources, lastRun }
  }

  firstRefresh(requested: readonly SourceId[]): ReconciliationRunDto {
    const enabled = new Set(this.reconciliation.sources().filter((source) => source.enabled).map((source) => source.id))
    const selected = [...new Set(['findmnemo-tickets' as SourceId, ...requested.filter((id) => enabled.has(id))])]
    return this.reconciliation.start(selected, 'onboarding')
  }
}
