import { createHash } from 'node:crypto'
import type { CompletedTicketSummaryDto, CompletedWorkQueryDto, CompletedWorkResultDto } from '../../shared/companion-contract.js'
import type { OperationalRepository, StoredTicket } from '../db/operational-repository.js'

interface CursorPayload { queryId: string; completedAt: string; id: string }

export class CompletedWorkQueryService {
  private readonly repository: OperationalRepository
  private readonly clock: () => Date

  constructor(repository: OperationalRepository, clock: () => Date = () => new Date()) { this.repository = repository; this.clock = clock }

  query(input: CompletedWorkQueryDto, exportLimit?: number): CompletedWorkResultDto {
    const normalized = normalize(input, exportLimit)
    const after = input.cursor ? decodeCursor(input.cursor, normalized.queryId) : undefined
    const result = this.repository.queryCompletedTickets({ startInclusive: normalized.startInclusive, endExclusive: normalized.endExclusive, after, limit: normalized.limit + 1 })
    const page = result.records.slice(0, normalized.limit)
    const last = page.at(-1)
    const nextCursor = result.records.length > normalized.limit && last?.completedAt ? encodeCursor({ queryId: normalized.queryId, completedAt: last.completedAt, id: last.id }) : null
    return { query: normalized, records: page.map(summary), total: result.total, unknownCompletionCount: result.unknownCompletionCount, nextCursor, generatedAt: this.clock().toISOString() }
  }
}

function normalize(input: CompletedWorkQueryDto, exportLimit?: number) {
  const start = new Date(input.startInclusive)
  const end = new Date(input.endExclusive)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end.getTime() - start.getTime() > 367 * 86_400_000) throw new Error('COMPLETED_RANGE_INVALID')
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(start) } catch { throw new Error('COMPLETED_RANGE_INVALID') }
  const limit = exportLimit ?? Math.max(1, Math.min(100, Number.isInteger(input.limit) ? input.limit! : 50))
  const queryId = createHash('sha256').update(`${start.toISOString()}\0${end.toISOString()}\0${input.timeZone}`).digest('hex').slice(0, 24)
  return { startInclusive: start.toISOString(), endExclusive: end.toISOString(), timeZone: input.timeZone, limit, queryId }
}

function summary(ticket: StoredTicket): CompletedTicketSummaryDto {
  return { id: ticket.id, title: typeof ticket.payload.title === 'string' ? ticket.payload.title : 'Untitled ticket', source: ticket.source, projectLabel: typeof ticket.payload.projectLabel === 'string' ? ticket.payload.projectLabel : null, completedAt: ticket.completedAt!, status: 'done' }
}
function encodeCursor(cursor: CursorPayload): string { return Buffer.from(JSON.stringify(cursor)).toString('base64url') }
function decodeCursor(value: string, queryId: string): { completedAt: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as CursorPayload
    if (parsed.queryId !== queryId || !parsed.id || !Number.isFinite(Date.parse(parsed.completedAt))) throw new Error('mismatch')
    return { completedAt: parsed.completedAt, id: parsed.id }
  } catch { throw new Error('COMPLETED_CURSOR_INVALID') }
}
