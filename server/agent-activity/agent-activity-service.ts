import {
  normalizeAssignmentEvent,
  parseAssignmentEvent,
  type AssignmentEvent,
  type AssignmentEventReceiptCode,
  type NormalizedAssignmentEvent,
} from '../../shared/agent-activity-contract.js'
import { AgentActivityRepository, type AgentActivityIngestReceipt } from './agent-activity-repository.js'

export interface ActivityAssociationResolver {
  resolve(event: NormalizedAssignmentEvent): { event: NormalizedAssignmentEvent; ticketId?: string; reasonCode?: string }
}

export class AgentActivityService {
  private readonly repository: AgentActivityRepository
  private readonly clock: () => Date
  private readonly associations?: ActivityAssociationResolver

  constructor(repository: AgentActivityRepository, clock: () => Date = () => new Date(), associations?: ActivityAssociationResolver) {
    this.repository = repository
    this.clock = clock
    this.associations = associations
  }

  ingest(input: unknown): AgentActivityIngestReceipt {
    const parsed = parseAssignmentEvent(input)
    return this.ingestValidated(parsed.event, parsed.receiptCodes)
  }

  ingestValidated(eventInput: AssignmentEvent | NormalizedAssignmentEvent, receiptCodes: AssignmentEventReceiptCode[]): AgentActivityIngestReceipt {
    const event = isNormalizedEvent(eventInput) ? eventInput : normalizeAssignmentEvent(eventInput)
    const assignmentKey = this.repository.assignmentKeyFor(event)
    const defaultTicketId = `agent-activity:${assignmentKey.slice(0, 32)}`
    if (Date.parse(event.observation.observedAt) > this.clock().getTime() + 5 * 60_000) {
      return { outcome: 'rejected', assignmentKey, ticketId: defaultTicketId, receiptCodes, reasonCode: 'CLOCK_SKEW', appliedCount: 0 }
    }
    if (event.assignment.targetRef && !this.associations) {
      return { outcome: 'rejected', assignmentKey, ticketId: defaultTicketId, receiptCodes, reasonCode: 'TARGET_RESOLVER_UNAVAILABLE', appliedCount: 0 }
    }
    const resolved = this.associations?.resolve(event) ?? { event }
    if (resolved.reasonCode) return { outcome: 'rejected', assignmentKey, ticketId: resolved.ticketId ?? defaultTicketId, receiptCodes, reasonCode: resolved.reasonCode, appliedCount: 0 }
    return this.repository.ingestValidated(resolved.event, receiptCodes, resolved.ticketId)
  }
}

function isNormalizedEvent(event: AssignmentEvent | NormalizedAssignmentEvent): event is NormalizedAssignmentEvent {
  return 'schemaVersion' in event
}
