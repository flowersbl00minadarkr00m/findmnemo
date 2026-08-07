import type { AgentFamily, PreciseExecutionSurface } from '../../../shared/agent-activity-contract.js'

export type PreciseActivityIntegrationId =
  | 'surface:claude-desktop-code'
  | 'surface:claude-desktop-home'
  | 'surface:claude-code-cli'
  | 'surface:codex-desktop'
  | 'surface:codex-cli'
  | 'surface:pi-cli'

export interface SurfaceCellIdentity {
  integrationId: PreciseActivityIntegrationId
  agentFamily: AgentFamily
  executionSurface: PreciseExecutionSurface
  surfaceLabel: string
}

export interface SurfaceQualificationModule extends SurfaceCellIdentity {
  adapterVersion: string
  platform: 'win32'
  detection: {
    state: 'unavailable' | 'not-detected' | 'detected'
    detectedVersion: string | null
    checkedAt: string | null
  }
  setup: {
    state: 'unavailable' | 'not-configured' | 'configured' | 'verified'
    mechanism: string
    credentialState: 'not-configured' | 'missing' | 'ready' | 'unavailable'
    bindingVerified: boolean
  }
  reachability: {
    state: 'unknown' | 'unavailable' | 'reachable'
    checkedAt: string | null
  }
  qualification: {
    qualifiedVersions: readonly string[]
    manual: boolean
    snapshot: 'none' | 'next-interaction' | 'current-session'
    automaticEvents: 'none' | 'partial'
    explicitTerminal: 'none' | 'explicit' | 'task-only'
    lastQualifiedAt: string | null
  }
  health: {
    state: 'unknown' | 'unavailable' | 'healthy' | 'stale'
    checkedAt: string | null
    lastSuccessAt: string | null
    failureCode: string | null
  }
}

export const PRECISE_ACTIVITY_CELLS = [
  { integrationId: 'surface:claude-desktop-code', agentFamily: 'claude', executionSurface: 'claude-desktop-code', surfaceLabel: 'Claude Desktop Code' },
  { integrationId: 'surface:claude-desktop-home', agentFamily: 'claude', executionSurface: 'claude-desktop-home', surfaceLabel: 'Claude Desktop Home' },
  { integrationId: 'surface:claude-code-cli', agentFamily: 'claude', executionSurface: 'claude-code-cli', surfaceLabel: 'Claude Code CLI' },
  { integrationId: 'surface:codex-desktop', agentFamily: 'codex', executionSurface: 'codex-desktop', surfaceLabel: 'Codex Desktop' },
  { integrationId: 'surface:codex-cli', agentFamily: 'codex', executionSurface: 'codex-cli', surfaceLabel: 'Codex CLI' },
  { integrationId: 'surface:pi-cli', agentFamily: 'pi', executionSurface: 'pi-cli', surfaceLabel: 'Pi CLI' },
] as const satisfies readonly SurfaceCellIdentity[]

export function unavailableQualification(cell: SurfaceCellIdentity): SurfaceQualificationModule {
  return {
    ...cell,
    adapterVersion: 'unavailable',
    platform: 'win32',
    detection: { state: 'unavailable', detectedVersion: null, checkedAt: null },
    setup: { state: 'unavailable', mechanism: 'unavailable', credentialState: 'not-configured', bindingVerified: false },
    reachability: { state: 'unknown', checkedAt: null },
    qualification: { qualifiedVersions: [], manual: false, snapshot: 'none', automaticEvents: 'none', explicitTerminal: 'none', lastQualifiedAt: null },
    health: { state: 'unavailable', checkedAt: null, lastSuccessAt: null, failureCode: 'QUALIFICATION_UNAVAILABLE' },
  }
}
