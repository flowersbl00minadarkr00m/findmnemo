import type {
  ProjectProgressArtifactRef,
  ProjectProgressIssue,
  ProjectProgressItem,
  SddGate,
} from '../types'
import { stableProjectProgressId } from './generated-tickets.ts'

const NEXT_ACTION_BY_GATE: Record<SddGate, string> = {
  uninitialized: 'Initialize SDD or exclude this project from SDD tracking',
  'requirements:draft': 'Review and approve requirements or request PRD changes',
  'requirements:approved': 'Create or update the technical design with sdd-spec',
  'design:draft': 'Review and approve design or request design changes',
  'design:approved': 'Create or update implementation tasks with sdd-tasks',
  'tasks:draft': 'Review and approve tasks or request task changes',
  'tasks:approved': 'Start implementation with sdd-exec',
  'implementation:in-progress': 'Continue the next unblocked implementation task',
  'implementation:done': 'Review implementation with sdd-review',
  'review:done': 'No next SDD gate is pending',
  'invalid-status': 'Repair the invalid .status file before continuing',
  'stale-path': 'Refresh or repair the project registry path before continuing',
}

export function deriveSddNextAction(gate: SddGate): string {
  return NEXT_ACTION_BY_GATE[gate]
}

export function isValidSddGate(value: unknown): value is SddGate {
  return typeof value === 'string' && value in NEXT_ACTION_BY_GATE
}

export function normalizePathVisibility(value: unknown): ProjectProgressItem['pathVisibility'] {
  if (value === 'local-only' || value === 'visible') return value
  return 'hidden'
}

export function hidePathUnlessVisible(path: string | undefined, visibility: ProjectProgressItem['pathVisibility']): string | undefined {
  return visibility === 'visible' || visibility === 'local-only' ? path : undefined
}

export function normalizeProjectProgressItem(input: {
  id?: string
  projectId: string
  projectName: string
  specId?: string
  specTitle?: string
  currentGate: SddGate
  nextSafeAction?: string
  artifactRefs?: ProjectProgressArtifactRef[]
  canonicalPath?: string
  pathVisibility?: ProjectProgressItem['pathVisibility']
  lastScannedAt?: string
  issues?: ProjectProgressIssue[]
}): ProjectProgressItem {
  const pathVisibility = normalizePathVisibility(input.pathVisibility)
  const visiblePath = hidePathUnlessVisible(input.canonicalPath, pathVisibility)

  return {
    id: input.id ?? stableProjectProgressId(input.projectId, input.specId),
    projectId: input.projectId,
    projectName: input.projectName,
    ...(input.specId ? { specId: input.specId } : {}),
    ...(input.specTitle ? { specTitle: input.specTitle } : {}),
    currentGate: input.currentGate,
    nextSafeAction: input.nextSafeAction ?? deriveSddNextAction(input.currentGate),
    artifactRefs: input.artifactRefs ?? [],
    ...(visiblePath ? { canonicalPath: visiblePath } : {}),
    pathVisibility,
    origin: 'registry-sync',
    lastScannedAt: input.lastScannedAt ?? new Date().toISOString(),
    issues: input.issues ?? [],
  }
}

export function attentionIssuesForGate(gate: SddGate, message?: string): ProjectProgressIssue[] {
  if (gate === 'invalid-status') {
    return [{ severity: 'blocker', message: message ?? 'Invalid SDD status blocks generated progress sync' }]
  }
  if (gate === 'stale-path') {
    return [{ severity: 'blocker', message: message ?? 'Stale registry path blocks generated progress sync' }]
  }
  return []
}
