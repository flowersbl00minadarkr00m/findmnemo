import type { ProjectProgressItem, SddTaskExecutionTicketSeed, Ticket } from '../types'

function stableSegment(value: string): string {
  const normalized = value.trim().toLowerCase()
  const safe = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return safe || 'unknown'
}

export function stableProjectProgressId(projectId: string, specId = 'uninitialized'): string {
  return `project:${stableSegment(projectId)}:spec:${stableSegment(specId)}`
}

export function stableSddGatePlaceholderTicketId(projectId: string, specId: string): string {
  return `ticket:sdd-gate:${stableSegment(projectId)}:${stableSegment(specId)}`
}

export function stableSddTaskTicketId(projectId: string, specId: string, taskId: string): string {
  return `ticket:sdd-task:${stableSegment(projectId)}:${stableSegment(specId)}:${stableSegment(taskId)}`
}

function relativeArtifactLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || normalized
}

export function projectProgressToGatePlaceholderTicket(item: ProjectProgressItem): Ticket {
  const specLabel = item.specTitle ?? item.specId ?? 'SDD workspace'
  const issueLines = item.issues.map((issue) => `${issue.severity.toUpperCase()}: ${issue.message}`)
  const descriptionLines = [
    `Project: ${item.projectName}`,
    `Spec: ${specLabel}`,
    `Current gate: ${item.currentGate}`,
    `Next safe action: ${item.nextSafeAction}`,
    ...issueLines,
  ]

  return {
    id: stableSddGatePlaceholderTicketId(item.projectId, item.specId ?? 'uninitialized'),
    title: `${item.projectName}: ${specLabel} gate`,
    description: descriptionLines.join('\n'),
    source: 'Codex',
    status: item.issues.some((issue) => issue.severity === 'blocker') ? 'blocked' : 'todo',
    workNotes: [{
      id: `note:${stableSegment(item.id)}:gate`,
      text: item.nextSafeAction,
      kind: 'fact',
      evidenceRefs: item.artifactRefs.map((ref) => ref.path),
      createdAt: item.lastScannedAt,
    }],
    artifacts: item.artifactRefs.map((ref) => ({
      id: `artifact:${stableSegment(item.id)}:${stableSegment(ref.kind)}:${stableSegment(ref.label)}`,
      type: 'file' as const,
      label: `${ref.kind}: ${ref.label || relativeArtifactLabel(ref.path)}`,
      url: ref.path,
      status: 'available' as const,
      createdAt: item.lastScannedAt,
    })),
    decisionLog: [],
    createdAt: item.lastScannedAt,
    updatedAt: item.lastScannedAt,
    origin: 'registry-sync',
    generatedKind: 'sdd-gate-placeholder',
    projectProgressId: item.id,
    ...(item.specId ? { sddSpecId: item.specId } : {}),
    sddGate: item.currentGate,
    blockedBy: item.issues.some((issue) => issue.severity === 'blocker') ? [`attention:${item.currentGate}`] : [],
    delivers: `Keeps the next SDD gate visible for ${item.projectName}.`,
    acceptanceCriteria: [{
      id: `ac:${stableSegment(item.id)}:next-action-visible`,
      text: `Next safe action is visible: ${item.nextSafeAction}`,
      checked: false,
    }],
    verificationChecks: [{
      id: `vc:${stableSegment(item.id)}:registry-scan`,
      commandOrCheck: 'node scripts/sync-sdd-progress.mjs --dry-run',
      expected: 'Scanner updates the same project-progress item and gate placeholder ticket',
      result: 'not-run',
    }],
    receiptRequired: false,
    receiptIds: [],
  }
}

export function approvedTaskToExecutionTicket(seed: SddTaskExecutionTicketSeed): Ticket {
  const generatedAt = seed.generatedAt ?? new Date().toISOString()
  const artifactEvidenceRefs = seed.artifactRefs.map((ref) => ref.path)
  const descriptionLines = [
    seed.description,
    seed.delivers ? `Delivers: ${seed.delivers}` : undefined,
    `Task: ${seed.taskId}`,
  ].filter(Boolean)

  return {
    id: seed.id,
    title: seed.title,
    description: descriptionLines.join('\n\n'),
    source: 'Codex',
    status: 'todo',
    workNotes: [{
      id: `note:${stableSegment(seed.id)}:approved-task`,
      text: `Generated from approved SDD task ${seed.taskId}.`,
      kind: 'fact',
      evidenceRefs: artifactEvidenceRefs,
      createdAt: generatedAt,
    }],
    artifacts: seed.artifactRefs.map((ref) => ({
      id: `artifact:${stableSegment(seed.id)}:${stableSegment(ref.kind)}:${stableSegment(ref.label)}`,
      type: 'file' as const,
      label: `${ref.kind}: ${ref.label || relativeArtifactLabel(ref.path)}`,
      url: ref.path,
      status: 'available' as const,
      createdAt: generatedAt,
    })),
    decisionLog: [],
    createdAt: generatedAt,
    updatedAt: generatedAt,
    origin: 'registry-sync',
    generatedKind: 'sdd-task-execution',
    projectProgressId: seed.projectProgressId,
    sddSpecId: seed.specId,
    sddGate: 'tasks:approved',
    blockedBy: seed.blockedBy,
    ...(seed.delivers ? { delivers: seed.delivers } : {}),
    acceptanceCriteria: seed.acceptanceCriteria,
    verificationChecks: seed.verificationChecks,
    receiptRequired: true,
    receiptIds: [],
  }
}
