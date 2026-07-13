import type { RoutingDecisionRecord, WorkTelemetryEvent } from '../types.ts'
import { appendTelemetry, loadTelemetry } from './telemetry.ts'

export interface RoutingEvidenceRecordResult {
  status: 'recorded' | 'error'
  event?: WorkTelemetryEvent
  message: string
}

export function routingDecisionToTelemetryEvent(
  decision: RoutingDecisionRecord,
  sequence = 0,
): WorkTelemetryEvent {
  const overridden = decision.decisionType === 'partial-override'
  const routeSourceRef = `mnemosync://model-route/${decision.routeId}`
  const ticketSourceRef = `mnemosync://ticket/${decision.ticketId}`
  const capabilityTags = decision.requiredCapabilityIds.map((capabilityId) => `capability:${capabilityId}`)
  const missingCapabilityTags = decision.missingCapabilityIds.map((capabilityId) => `missing-capability:${capabilityId}`)

  return {
    eventId: `model-route:${decision.id}`,
    caseId: decision.ticketId,
    traceId: `ticket-${decision.ticketId}`,
    timestamp: decision.decidedAt,
    sequence,
    activity: {
      id: overridden ? 'model-route-overridden' : 'model-route-confirmed',
      label: overridden ? 'Override model route capability gap' : 'Confirm model route recommendation',
      type: 'decide',
      primitiveVersion: '1.0.0',
    },
    actor: {
      id: 'human-henry',
      label: 'Henry',
      type: 'human',
      role: 'workspace owner',
      authorityLevel: 7,
    },
    objects: [
      {
        id: decision.ticketId,
        type: 'mnemosync-ticket',
        role: 'subject',
        sourceRef: ticketSourceRef,
        classification: 'private-work-data',
      },
      {
        id: decision.routeId,
        type: 'model-route-target',
        role: 'output',
        sourceRef: routeSourceRef,
        classification: 'private-preference-data',
      },
    ],
    decision: {
      id: decision.id,
      selectedPath: decision.routeId,
      rationale: [
        `decisionType=${decision.decisionType}`,
        `policyRevision=${decision.policyRevision}`,
        `requiredCapabilities=${decision.requiredCapabilityIds.join(',')}`,
        `missingCapabilities=${decision.missingCapabilityIds.join(',')}`,
      ].join(';'),
      decidingAuthority: 'human-henry',
    },
    result: { status: 'success' },
    acceptedOutcome: true,
    truthState: overridden ? 'overridden' : 'user-confirmed',
    provenance: {
      sourceType: 'mnemosync',
      sourceRef: ticketSourceRef,
      ingestedAt: decision.decidedAt,
      transformation: 'FindMnemo model-routing decision evidence v1',
    },
    tags: [
      'mnemosync',
      'model-routing',
      `routing-decision:${decision.decisionType}`,
      `policy-revision:${decision.policyRevision}`,
      ...capabilityTags,
      ...missingCapabilityTags,
    ],
  }
}

export function recordRoutingDecision(
  decision: RoutingDecisionRecord,
): RoutingEvidenceRecordResult {
  const sequence = loadTelemetry().filter((event) => event.caseId === decision.ticketId).length
  const event = routingDecisionToTelemetryEvent(decision, sequence)
  try {
    appendTelemetry(event)
    return {
      status: 'recorded',
      event,
      message: 'Routing decision evidence recorded locally.',
    }
  } catch {
    return {
      status: 'error',
      message: 'The route decision remains selected, but local evidence could not be recorded.',
    }
  }
}
