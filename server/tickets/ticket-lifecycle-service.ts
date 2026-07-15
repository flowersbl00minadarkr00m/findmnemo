import { randomUUID } from 'node:crypto'
import type { OperationalRepository, StoredTicket } from '../db/operational-repository.js'

export interface TicketTransitionInput {
  ticketId: string
  expectedUpdatedAt: string
  nextPayload: Record<string, unknown>
  origin: string
  correlationId?: string | null
  occurredAt?: string
}

export class TicketLifecycleService {
  private readonly repository: OperationalRepository
  private readonly clock: () => Date

  constructor(repository: OperationalRepository, clock: () => Date = () => new Date()) { this.repository = repository; this.clock = clock }

  create(ticket: StoredTicket, origin: string, correlationId: string | null = null): StoredTicket {
    return this.repository.transaction(() => this.createWithinTransaction(ticket, origin, correlationId))
  }

  createWithinTransaction(ticket: StoredTicket, origin: string, correlationId: string | null = null): StoredTicket {
    if (this.repository.getTicket(ticket.id)) throw new Error('RECORD_CHANGED')
    const now = this.clock().toISOString()
    const completedAt = ticket.status === 'done' ? now : null
    const saved = { ...ticket, updatedAt: now, completedAt, payload: { ...ticket.payload, updatedAt: now, completedAt } }
    this.repository.saveTicket(saved)
    this.repository.appendTicketStatusEvent({ id: randomUUID(), ticketId: saved.id, fromStatus: null, toStatus: saved.status, occurredAt: now, completionAt: completedAt, origin, correlationId })
    return saved
  }

  transition(input: TicketTransitionInput): StoredTicket {
    return this.repository.transaction(() => this.transitionWithinTransaction(input))
  }

  transitionWithinTransaction(input: TicketTransitionInput): StoredTicket {
    const current = this.repository.getTicket(input.ticketId)
    if (!current || current.updatedAt !== input.expectedUpdatedAt) throw new Error('RECORD_CHANGED')
    const nextStatus = typeof input.nextPayload.status === 'string' ? input.nextPayload.status : current.status
    const changed = nextStatus !== current.status
    const now = input.occurredAt ?? this.clock().toISOString()
    const completedAt = !changed ? current.completedAt ?? null : nextStatus === 'done' ? now : null
    const saved: StoredTicket = { ...current, status: nextStatus, updatedAt: now, completedAt, payload: { ...current.payload, ...input.nextPayload, id: current.id, status: nextStatus, updatedAt: now, completedAt } }
    this.repository.saveTicket(saved)
    if (changed) this.repository.appendTicketStatusEvent({ id: randomUUID(), ticketId: current.id, fromStatus: current.status, toStatus: nextStatus, occurredAt: now, completionAt: nextStatus === 'done' ? now : null, origin: input.origin, correlationId: input.correlationId ?? null })
    return saved
  }
}
