import type { DatabaseSync } from 'node:sqlite'
import type { AgentKind, AssignmentEventV1, AssignmentEvidenceKind } from '../../shared/agent-activity-contract.js'
import type { AgentActivityIntegrationInput } from './agent-activity-repository.js'

export interface ActivityAdapterManifest {
  agent: AgentKind
  adapterVersion: string
  supportedAgentVersions: readonly string[]
  supportLevel: NonNullable<AgentActivityIntegrationInput['supportLevel']>
  freshnessProfile: string
  heartbeatSeconds: number | null
  freshnessWindowSeconds: number
  evidenceKinds: readonly AssignmentEvidenceKind[]
  qualification: {
    platform: 'win32'
    testedAgentVersion: string
    lifecycle: boolean
    privacy: boolean
    freshness: boolean
    snapshot: 'none' | 'next-interaction' | 'current-session'
    terminal: 'none' | 'explicit' | 'task-only'
  }
}

export const ACTIVITY_ADAPTER_MANIFESTS: readonly ActivityAdapterManifest[] = [
  {
    agent: 'codex-cli', adapterVersion: '1.0.0', supportedAgentVersions: ['0.144.3'], supportLevel: 'automatic-partial',
    freshnessProfile: 'hook-observed', heartbeatSeconds: null, freshnessWindowSeconds: 900,
    evidenceKinds: ['codex-hook', 'mcp-tool', 'manual-command', 'snapshot'],
    qualification: { platform: 'win32', testedAgentVersion: '0.144.3', lifecycle: true, privacy: true, freshness: true, snapshot: 'next-interaction', terminal: 'explicit' },
  },
  {
    agent: 'claude-code', adapterVersion: '1.0.0', supportedAgentVersions: ['2.1.207'], supportLevel: 'automatic-task-terminal',
    freshnessProfile: 'hook-observed', heartbeatSeconds: null, freshnessWindowSeconds: 900,
    evidenceKinds: ['claude-hook', 'claude-task-hook', 'mcp-tool', 'manual-command', 'snapshot'],
    qualification: { platform: 'win32', testedAgentVersion: '2.1.207', lifecycle: true, privacy: true, freshness: true, snapshot: 'next-interaction', terminal: 'task-only' },
  },
  {
    agent: 'pi', adapterVersion: '1.0.0', supportedAgentVersions: ['0.80.3'], supportLevel: 'automatic-partial',
    freshnessProfile: 'resident-extension', heartbeatSeconds: 45, freshnessWindowSeconds: 120,
    evidenceKinds: ['pi-extension', 'mcp-tool', 'manual-command', 'snapshot'],
    qualification: { platform: 'win32', testedAgentVersion: '0.80.3', lifecycle: true, privacy: true, freshness: true, snapshot: 'current-session', terminal: 'explicit' },
  },
] as const

export const MANUAL_ACTIVITY_ADAPTER_VERSION = 'manual-1.0.0'

export function manualActivityRegistration(id: string, agent: AgentKind): AgentActivityIntegrationInput {
  return {
    id, agent, adapterVersion: MANUAL_ACTIVITY_ADAPTER_VERSION, installedVersion: null,
    enabled: true, configured: true, supportLevel: 'manual', freshnessProfile: 'manual',
    heartbeatSeconds: null, freshnessWindowSeconds: 1_800,
  }
}

export class ActivityCapabilityRegistry {
  private readonly db: DatabaseSync
  private readonly manifests: readonly ActivityAdapterManifest[]

  constructor(db: DatabaseSync, manifests: readonly ActivityAdapterManifest[] = ACTIVITY_ADAPTER_MANIFESTS) {
    this.db = db
    this.manifests = manifests.map(qualifyActivityAdapterManifest)
  }

  registration(id: string, agent: AgentKind, installedVersion: string | null): AgentActivityIntegrationInput {
    const manifest = this.manifest(agent)
    const supported = installedVersion !== null && manifest.supportedAgentVersions.includes(normalizeVersion(installedVersion))
    return {
      id, agent, adapterVersion: manifest.adapterVersion, installedVersion,
      enabled: supported, configured: supported,
      supportLevel: supported ? manifest.supportLevel : 'unsupported',
      freshnessProfile: manifest.freshnessProfile,
      heartbeatSeconds: manifest.heartbeatSeconds,
      freshnessWindowSeconds: manifest.freshnessWindowSeconds,
    }
  }

  validate(event: AssignmentEventV1): void {
    const row = this.db.prepare(`SELECT agent_kind,adapter_version,installed_version,enabled,configured,support_level,
      freshness_profile,heartbeat_seconds,freshness_window_seconds FROM agent_activity_integrations WHERE id=?`).get(event.integrationId) as Record<string, unknown> | undefined
    if (!row || !row.enabled || !row.configured) throw new Error('ACTIVITY_INTEGRATION_NOT_ENABLED')
    if (row.support_level === 'manual') {
      const evidenceAllowed = event.observation.evidenceKind === 'mcp-tool' || event.observation.evidenceKind === 'manual-command' || event.observation.evidenceKind === 'snapshot'
      if (
        event.agent !== row.agent_kind || event.adapterVersion !== MANUAL_ACTIVITY_ADAPTER_VERSION ||
        row.adapter_version !== MANUAL_ACTIVITY_ADAPTER_VERSION || event.agentVersion !== null ||
        !evidenceAllowed ||
        row.freshness_profile !== 'manual' || nullableNumber(row.heartbeat_seconds) !== null || Number(row.freshness_window_seconds) !== 1_800
      ) throw new Error('ACTIVITY_CAPABILITY_MISMATCH')
      return
    }
    const manifest = this.manifest(String(row.agent_kind) as AgentKind)
    const installedVersion = row.installed_version ? normalizeVersion(String(row.installed_version)) : null
    const eventVersion = event.agentVersion ? normalizeVersion(event.agentVersion) : null
    if (
      event.agent !== manifest.agent || event.adapterVersion !== manifest.adapterVersion ||
      row.adapter_version !== manifest.adapterVersion || !installedVersion || !manifest.supportedAgentVersions.includes(installedVersion) ||
      (eventVersion !== null && eventVersion !== installedVersion) || !manifest.evidenceKinds.includes(event.observation.evidenceKind) ||
      row.support_level !== manifest.supportLevel || row.freshness_profile !== manifest.freshnessProfile ||
      Number(row.freshness_window_seconds) !== manifest.freshnessWindowSeconds || nullableNumber(row.heartbeat_seconds) !== manifest.heartbeatSeconds
    ) throw new Error('ACTIVITY_CAPABILITY_MISMATCH')
  }

  private manifest(agent: AgentKind): ActivityAdapterManifest {
    const manifest = this.manifests.find((candidate) => candidate.agent === agent)
    if (!manifest) throw new Error('ACTIVITY_CAPABILITY_UNSUPPORTED')
    return manifest
  }
}

export function qualifyActivityAdapterManifest(manifest: ActivityAdapterManifest): ActivityAdapterManifest {
  const qualification = manifest.qualification
  if (manifest.supportLevel === 'automatic-task-terminal' && qualification?.terminal !== 'task-only') throw new Error('ACTIVITY_MANIFEST_TERMINAL_UNQUALIFIED')
  if (manifest.supportLevel === 'snapshot' && qualification?.snapshot === 'none') throw new Error('ACTIVITY_MANIFEST_SNAPSHOT_UNQUALIFIED')
  if (!qualification || qualification.platform !== 'win32' || !manifest.supportedAgentVersions.includes(qualification.testedAgentVersion) || !qualification.lifecycle || !qualification.privacy || !qualification.freshness) throw new Error('ACTIVITY_MANIFEST_UNQUALIFIED')
  if (manifest.supportLevel.startsWith('automatic') && qualification.snapshot === 'none') throw new Error('ACTIVITY_MANIFEST_SNAPSHOT_UNQUALIFIED')
  return manifest
}

function normalizeVersion(value: string): string {
  const match = value.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:$|\s)/)
  return match?.[1] ?? value.trim()
}

function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value) }
