import {
  parseAssignmentEventV1,
  type AgentKind,
  type AssignmentEventKind,
  type AssignmentEventV1,
  type AssignmentEvidenceKind,
  type AssignmentReportedState,
  type SummarySource,
  type TerminalEvidenceKind,
  type TerminalOutcome,
} from '../../../shared/agent-activity-contract.js'

export interface ReporterEventDraft {
  eventId: string
  integrationId: string
  agent: AgentKind
  adapterVersion: string
  agentVersion: string | null
  originAssignmentId: string
  generation: number
  summary?: { text: string; source: SummarySource }
  projectRef: AssignmentEventV1['assignment']['projectRef']
  targetRef?: AssignmentEventV1['assignment']['targetRef']
  kind: AssignmentEventKind
  reportedState?: AssignmentReportedState
  observedAt: string
  reasonCode?: AssignmentEventV1['observation']['reasonCode']
  evidenceKind: AssignmentEvidenceKind
  originEvidenceId?: string
  terminalEvidence?: { kind: TerminalEvidenceKind; outcome: TerminalOutcome }
  modelLabel?: string | null
  snapshot?: AssignmentEventV1['snapshot']
}

export type ReporterSelector = (sourcePayload: unknown) => ReporterEventDraft

export class ReporterSanitizer {
  private readonly sequences = new Map<string, number>()

  sanitize(sourcePayload: unknown, select: ReporterSelector): AssignmentEventV1 {
    return this.build(select(sourcePayload))
  }

  sanitizeDraft(draft: ReporterEventDraft): AssignmentEventV1 { return this.build(draft) }

  sanitizeBatch(sourcePayloads: readonly unknown[], select: ReporterSelector): AssignmentEventV1[] {
    return this.sanitizeDraftBatch(sourcePayloads.map((sourcePayload) => select(sourcePayload)))
  }

  sanitizeDraftBatch(selected: readonly ReporterEventDraft[]): AssignmentEventV1[] {
    const coalesced: ReporterEventDraft[] = []
    const heartbeatIndexes = new Map<string, number>()
    for (const draft of selected) {
      const identity = identityOf(draft)
      if (draft.kind === 'heartbeat') {
        const existing = heartbeatIndexes.get(identity)
        if (existing !== undefined) { coalesced[existing] = draft; continue }
        heartbeatIndexes.set(identity, coalesced.length)
      } else heartbeatIndexes.delete(identity)
      coalesced.push(draft)
    }
    return coalesced.map((draft) => this.build(draft))
  }

  private build(draft: ReporterEventDraft): AssignmentEventV1 {
    const identity = identityOf(draft)
    const sequence = (this.sequences.get(identity) ?? 0) + 1
    const candidate: AssignmentEventV1 = {
      schema: 'findmnemo.assignment-event.v1',
      eventId: draft.eventId,
      integrationId: draft.integrationId,
      agent: draft.agent,
      adapterVersion: draft.adapterVersion,
      agentVersion: draft.agentVersion,
      assignment: {
        originAssignmentId: draft.originAssignmentId,
        generation: draft.generation,
        summary: draft.summary ?? { text: placeholderFor(draft.agent), source: 'placeholder' },
        projectRef: draft.projectRef,
        ...(draft.targetRef ? { targetRef: draft.targetRef } : {}),
      },
      observation: {
        sequence,
        kind: draft.kind,
        ...(draft.reportedState ? { reportedState: draft.reportedState } : {}),
        observedAt: draft.observedAt,
        ...(draft.reasonCode ? { reasonCode: draft.reasonCode } : {}),
        evidenceKind: draft.evidenceKind,
        ...(draft.originEvidenceId ? { originEvidenceId: draft.originEvidenceId } : {}),
        ...(draft.terminalEvidence ? { terminalEvidence: draft.terminalEvidence } : {}),
      },
      ...(draft.modelLabel === undefined ? {} : { modelLabel: draft.modelLabel }),
      ...(draft.snapshot ? { snapshot: draft.snapshot } : {}),
    }
    const parsed = parseAssignmentEventV1(candidate).event
    this.sequences.set(identity, sequence)
    return parsed
  }
}

function identityOf(draft: ReporterEventDraft): string {
  return `${draft.integrationId}\0${draft.agent}\0${draft.originAssignmentId}\0${draft.generation}`
}

function placeholderFor(agent: AgentKind): string {
  if (agent === 'codex-cli') return 'Codex work — name this assignment'
  if (agent === 'claude-code') return 'Claude Code work — name this assignment'
  return 'Pi work — name this assignment'
}
