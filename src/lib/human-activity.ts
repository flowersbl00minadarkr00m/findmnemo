import type { HumanActivityCommand, HumanActivityKind, WorkTelemetryEvent } from '../types'

const ACTIVITY_LABELS: Record<HumanActivityKind, string> = {
  'human-requested-work': 'Human requested work',
  'human-approved-requirements': 'Human approved requirements',
  'human-approved-design': 'Human approved design',
  'human-approved-tasks': 'Human approved tasks',
  'human-rejected-output': 'Human rejected output',
  'human-verified-artifact': 'Human verified artifact',
  'human-accepted-ai-receipt': 'Human accepted AI receipt',
  'human-overrode-status': 'Human overrode status',
}

function stableSegment(value: string): string {
  const normalized = value.trim().toLowerCase()
  const safe = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return safe || 'unknown'
}

function commandTarget(command: HumanActivityCommand): string {
  return command.ticketId ?? command.projectProgressId ?? command.receiptId ?? command.activity
}

export function buildHumanActivityEvent(
  command: HumanActivityCommand,
  actor: { id?: string; label?: string } = {},
  timestamp = new Date().toISOString(),
): WorkTelemetryEvent {
  const caseId = commandTarget(command)
  const acceptedOutcome = command.activity === 'human-accepted-ai-receipt'
  const rejectedOutcome = command.activity === 'human-rejected-output'

  return {
    eventId: `mnemo-human-${stableSegment(command.activity)}-${stableSegment(caseId)}-${stableSegment(timestamp)}`,
    caseId,
    traceId: `human-${caseId}`,
    timestamp,
    sequence: 0,
    intent: ACTIVITY_LABELS[command.activity],
    activity: {
      id: command.activity,
      label: ACTIVITY_LABELS[command.activity],
      type: command.activity.includes('approved') || command.activity.includes('accepted') ? 'decide' : 'review',
      primitiveVersion: '1.0.0',
    },
    actor: {
      id: actor.id ?? 'human-henry',
      label: actor.label ?? 'Henry',
      type: 'human',
      role: 'workspace owner',
      authorityLevel: 7,
    },
    objects: [
      ...(command.ticketId ? [{
        id: command.ticketId,
        type: 'mnemosync-ticket',
        role: 'subject' as const,
        sourceRef: `mnemosync://ticket/${command.ticketId}`,
        classification: 'private-work-data',
      }] : []),
      ...(command.projectProgressId ? [{
        id: command.projectProgressId,
        type: 'sdd-project-progress',
        role: 'subject' as const,
        sourceRef: `mnemosync://project-progress/${command.projectProgressId}`,
        classification: 'private-work-data',
      }] : []),
      ...(command.receiptId ? [{
        id: command.receiptId,
        type: 'ai-receipt',
        role: command.ticketId || command.projectProgressId ? 'evidence' as const : 'subject' as const,
        sourceRef: `mnemosync://ai-receipt/${command.receiptId}`,
        classification: 'private-work-data',
      }] : []),
    ],
    result: {
      status: rejectedOutcome ? 'failure' : 'success',
      ...(command.note ? { message: command.note } : {}),
    },
    evidence: command.artifactRefs?.map((ref, index) => ({
      id: `human-evidence-${index + 1}`,
      sourceRef: ref.ref,
      label: ref.label,
      classification: 'private-work-data',
    })),
    acceptedOutcome,
    truthState: 'user-confirmed',
    provenance: {
      sourceType: 'mnemosync',
      sourceRef: `mnemosync://human-activity/${command.activity}/${caseId}`,
      ingestedAt: timestamp,
      transformation: 'FindMnemo explicit human activity command',
    },
    tags: ['mnemosync', 'human-activity', command.activity],
  }
}
