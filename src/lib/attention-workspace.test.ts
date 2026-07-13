import { describe, expect, it } from 'vitest'
import type { GmailCandidateDto, ReconciliationRunDto, SourceDescriptor } from '../../shared/companion-contract'
import type { Ticket } from '../types'
import { projectAttentionWorkspace } from './attention-workspace'

const now = '2026-07-12T12:00:00.000Z'

function ticket(input: Partial<Ticket> & Pick<Ticket, 'id' | 'title' | 'status'>): Ticket {
  return {
    description: `${input.title} description`,
    source: 'Codex',
    workNotes: [],
    artifacts: [],
    decisionLog: [],
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
    ...input,
  }
}

const gmailCandidate: GmailCandidateDto = {
  accountId: 'account-hash',
  threadId: 'thread-1',
  latestMessageId: 'message-1',
  sender: 'sender@example.com',
  subject: 'Review the proposal',
  receivedAt: '2026-07-12T09:00:00.000Z',
  snippet: 'Could you confirm the next step?',
  reasonCodes: ['LATEST_FROM_OTHER', 'NO_LATER_SELF_REPLY'],
  state: 'candidate',
  gmailUrl: 'https://mail.google.com/mail/u/0/#inbox/thread-1',
  recordVersion: 1,
}

const sources: SourceDescriptor[] = [
  { id: 'gmail-followups', label: 'Gmail follow-ups', adapterVersion: '1.0.0', enabled: true, policy: 'review' },
]

const partialRun: ReconciliationRunDto = {
  id: 'run-1',
  state: 'partial',
  requestedSourceIds: ['gmail-followups'],
  startedAt: '2026-07-12T09:30:00.000Z',
  finishedAt: '2026-07-12T09:31:00.000Z',
  sources: [{
    sourceId: 'gmail-followups', state: 'failed', checked: 3, added: 0, updated: 0,
    unchanged: 2, excluded: 0, duplicate: 0, unresolved: 1, errorCode: 'SOURCE_CHECK_FAILED',
  }],
  items: [],
}

describe('attention workspace projection', () => {
  it('uses one deterministic rule order and stable record references', () => {
    const input = {
      tickets: [
        ticket({ id: 'frontier', title: 'Ready work', status: 'in-progress' }),
        ticket({ id: 'receipt', title: 'Receipt decision', status: 'done', receiptRequired: true, receiptIds: ['receipt-1'] }),
        ticket({ id: 'blocked', title: 'Blocked work', status: 'blocked', blockedBy: ['missing-ticket'] }),
      ],
      gmailCandidates: [gmailCandidate],
      reconciliationSources: sources,
      reconciliationRun: partialRun,
      ticketState: 'current' as const,
      now,
    }

    const first = projectAttentionWorkspace(input)
    const second = projectAttentionWorkspace({ ...input, tickets: [...input.tickets].reverse() })

    expect(first.items.map((item) => item.recordRef)).toEqual([
      'ticket:blocked',
      'ticket:receipt',
      'gmail:account-hash:thread-1',
      'source:gmail-followups',
      'ticket:frontier',
    ])
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id))
    expect(first.items[0]).toMatchObject({ priority: 'critical', bucket: 'needs-action', truthState: 'current' })
    expect(first.items[0].evidence.blockers).toEqual([{ id: 'missing-ticket', state: 'missing' }])
  })

  it('keeps missing evidence unverified and receipt-required work unresolved', () => {
    const result = projectAttentionWorkspace({
      tickets: [ticket({ id: 'receipt-missing', title: 'Missing receipt', status: 'done', receiptRequired: true, receiptIds: [] })],
      ticketState: 'loading',
      now,
    })

    expect(result.items[0]).toMatchObject({ truthState: 'unverified', bucket: 'needs-action' })
    expect(result.items[0].evidence.availability).toBe('required-missing')
    expect(result.items[0].primaryAction.disabledReason).toMatch(/receipt/i)
  })

  it('preserves available reversibility evidence and leaves missing rollback evidence unknown', () => {
    const result = projectAttentionWorkspace({
      tickets: [
        ticket({
          id: 'reversible', title: 'Reversible decision', status: 'todo',
          decisionLog: [{ id: 'decision-1', timestamp: now, decision: 'Use the shared adapter', reasoning: 'One source of truth', gateType: 'two-way', reversibility: 'high' }],
        }),
        ticket({ id: 'unknown-rollback', title: 'Unknown rollback', status: 'todo' }),
      ],
      ticketState: 'current', now,
    })

    const reversible = result.items.find((item) => item.recordRef === 'ticket:reversible')
    const unknown = result.items.find((item) => item.recordRef === 'ticket:unknown-rollback')
    expect(reversible?.evidence.rollbackRefs).toEqual([{ label: 'Decision reversibility', value: 'Use the shared adapter · high reversibility · two-way gate', state: 'available' }])
    expect(unknown?.evidence.rollbackRefs).toEqual([])
  })

  it('preserves stale, partial, disconnected, and fictional truth states', () => {
    const stale = projectAttentionWorkspace({ tickets: [ticket({ id: 'stale', title: 'Stale ticket', status: 'todo' })], ticketState: 'stale', now })
    const disconnected = projectAttentionWorkspace({ tickets: [ticket({ id: 'offline', title: 'Offline ticket', status: 'todo' })], ticketState: 'error', now })
    const partial = projectAttentionWorkspace({ tickets: [], reconciliationSources: sources, reconciliationRun: partialRun, ticketState: 'current', now })
    const fictional = projectAttentionWorkspace({ tickets: [ticket({ id: 'sample', title: 'Sample ticket', status: 'todo', origin: 'demo' })], ticketState: 'current', fictional: true, now })

    expect(stale.items[0].truthState).toBe('stale')
    expect(disconnected.items[0].truthState).toBe('disconnected')
    expect(partial.items[0].truthState).toBe('partial')
    expect(fictional.items[0].truthState).toBe('fictional')
  })

  it('does not turn missing blockers into frontier-ready work', () => {
    const result = projectAttentionWorkspace({
      tickets: [ticket({ id: 'waiting', title: 'Waiting ticket', status: 'todo', blockedBy: ['missing'] })],
      ticketState: 'current',
      now,
    })

    expect(result.items[0]).toMatchObject({ bucket: 'waiting', priorityReason: expect.stringMatching(/blocker/i) })
    expect(result.items[0].evidence.blockers).toEqual([{ id: 'missing', state: 'missing' }])
  })

  it('uses a safe empty denominator and bounded resolved progress', () => {
    const empty = projectAttentionWorkspace({ tickets: [], ticketState: 'current', now })
    const mixed = projectAttentionWorkspace({
      tickets: [
        ticket({ id: 'todo', title: 'Pending', status: 'todo' }),
        ticket({ id: 'done', title: 'Resolved', status: 'done', updatedAt: '2026-07-12T08:00:00.000Z' }),
      ],
      ticketState: 'current',
      now,
    })

    expect(empty.dayStatus).toEqual({ queued: 0, resolved: 0, progress: null, label: 'No decisions queued' })
    expect(mixed.dayStatus).toMatchObject({ queued: 2, resolved: 1, progress: 50 })
  })
})
