import type { FogMap, ReadinessState, ReviewRecord, ReviewVerdict, Ticket } from '../types'

export interface BlockingReference {
  id: string
  ticket?: Ticket
  reason: 'pending-ticket' | 'missing-ticket' | 'self-reference'
}

function ticketMap(tickets: Ticket[]): Map<string, Ticket> {
  return new Map(tickets.map((ticket) => [ticket.id, ticket]))
}

function hasBlockingTicket(blocker: BlockingReference): blocker is BlockingReference & { ticket: Ticket } {
  return blocker.ticket !== undefined
}

export function getBlockingReferences(ticket: Ticket, tickets: Ticket[]): BlockingReference[] {
  const ticketsById = ticketMap(tickets)
  return (ticket.blockedBy ?? []).flatMap((blockerId): BlockingReference[] => {
    if (blockerId === ticket.id) {
      return [{ id: blockerId, ticket, reason: 'self-reference' as const }]
    }

    const blocker = ticketsById.get(blockerId)
    if (!blocker) {
      return [{ id: blockerId, reason: 'missing-ticket' as const }]
    }

    if (blocker.status !== 'done') {
      return [{ id: blockerId, ticket: blocker, reason: 'pending-ticket' as const }]
    }

    return []
  })
}

export function getBlockingTickets(ticket: Ticket, tickets: Ticket[]): Ticket[] {
  return getBlockingReferences(ticket, tickets)
    .filter(hasBlockingTicket)
    .filter((blocker) => blocker.ticket.id !== ticket.id)
    .map((blocker) => blocker.ticket)
}

export function computeTicketReadiness(ticket: Ticket, tickets: Ticket[]): ReadinessState {
  if (ticket.status === 'done') return 'done'
  if (ticket.status === 'blocked') return 'blocked'
  return getBlockingReferences(ticket, tickets).length > 0 ? 'blocked' : 'ready'
}

export function getFrontierTickets(tickets: Ticket[]): Ticket[] {
  return tickets.filter((ticket) => computeTicketReadiness(ticket, tickets) === 'ready')
}

export function isFogMapResolved(fogMap?: FogMap): boolean {
  if (!fogMap) return true
  return fogMap.items.length === 0
}

export function summarizeReview(review?: ReviewRecord): ReviewVerdict {
  if (!review) return 'needs-fixes'

  const verdicts = [review.spec.verdict, review.standards.verdict]
  if (verdicts.includes('needs-fixes')) return 'needs-fixes'
  if (verdicts.includes('approved-with-follow-ups')) return 'approved-with-follow-ups'
  return 'approved'
}
