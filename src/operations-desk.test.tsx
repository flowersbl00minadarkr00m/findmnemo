import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AttentionWorkspaceProjection, Ticket } from './types'
import { OperationsDesk } from './components/OperationsDesk'
import { ReceiptDispositionControls } from './components/ReceiptDispositionControls'

const projection: AttentionWorkspaceProjection = {
  dayStatus: { queued: 2, resolved: 0, progress: 0, label: '0 of 2 decisions resolved' },
  sources: [
    { id: 'gmail-followups', label: 'Gmail follow-ups', truthState: 'partial', detail: '3 checked · 1 unresolved' },
    { id: 'agent-ledger', label: 'Agent ledger', enabled: false, truthState: 'unverified', detail: 'Optional source — not configured.' },
  ],
  items: [
    {
      id: 'attention:ticket:blocked', kind: 'ticket', recordRef: 'ticket:blocked', title: 'Blocked release', summary: 'Release is waiting on evidence.',
      sourceLabel: 'Ticket', ownerLabel: 'Codex', bucket: 'needs-action', priority: 'critical', priorityReason: 'Blocked work has unresolved blockers.',
      truthState: 'current', evidence: { availability: 'available', refs: [{ label: 'SDD gate', value: 'implementation:in-progress' }], blockers: [{ id: 'signing', state: 'missing' }], receiptIds: [], reasonCodes: [] },
      primaryAction: { id: 'open', kind: 'open-ticket', label: 'Review blocker', recordRef: 'ticket:blocked' }, secondaryActions: [],
    },
    {
      id: 'attention:gmail:account:thread', kind: 'gmail', recordRef: 'gmail:account:thread', title: 'Reply requested', summary: 'Can you confirm?',
      sourceLabel: 'Gmail', bucket: 'needs-action', priority: 'high', priorityReason: 'Email candidate requires review.', truthState: 'stale',
      evidence: { availability: 'partial', refs: [], blockers: [], receiptIds: [], reasonCodes: [] },
      primaryAction: { id: 'review', kind: 'review-gmail', label: 'Review email', recordRef: 'gmail:account:thread' }, secondaryActions: [],
    },
  ],
}

describe('Operations Desk', () => {
  it('renders ordered rows, explicit source states, and selection evidence', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<OperationsDesk projection={projection} onSelectedIdChange={onSelect} />)

    const queue = screen.getByRole('list', { name: /prioritized attention queue/i })
    expect(within(queue).getAllByRole('button').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Blocked release'),
      expect.stringContaining('Reply requested'),
    ])
    expect(screen.getByText('partial')).toBeVisible()
    expect(screen.getByText('unverified')).toBeVisible()
    expect(screen.getByText('Set up locally when needed')).toBeVisible()
    const ledgerCard = screen.getByText('Agent ledger').closest('article')
    expect(ledgerCard).not.toBeNull()
    expect(within(ledgerCard!).queryByRole('button', { name: /retry source/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /blocked release/i }))
    expect(onSelect).toHaveBeenCalledWith('attention:ticket:blocked')
    rerender(<OperationsDesk projection={projection} selectedId="attention:ticket:blocked" onSelectedIdChange={onSelect} />)
    expect(screen.getByRole('complementary', { name: /evidence for blocked release/i })).toHaveTextContent('Blocker signing: missing')
    expect(screen.getByRole('complementary', { name: /evidence for blocked release/i })).toHaveTextContent('Rollback / reversibilityNot available.')
  })

  it('opens authoritative ticket detail and exposes an accessible view switch', () => {
    const onOpen = vi.fn()
    render(<OperationsDesk projection={projection} selectedId="attention:ticket:blocked" onSelectedIdChange={() => undefined} onOpenTicket={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /open ticket detail/i }))
    expect(onOpen).toHaveBeenCalledWith('blocked')
    expect(screen.getByRole('radio', { name: /operations desk/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /daily brief/i })).toBeEnabled()
  })

  it('shows loading, empty, and error states without claiming healthy coverage', () => {
    render(<OperationsDesk projection={{ items: [], sources: [], dayStatus: { queued: 0, resolved: 0, progress: null, label: 'No decisions queued' } }} onSelectedIdChange={() => undefined} loading error="Companion stopped" />)
    expect(screen.getByText(/loading companion-owned/i)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(/companion stopped/i)
    expect(screen.getByText(/source coverage: unverified/i)).toBeVisible()
    expect(screen.getByText(/no evidenced attention items/i)).toBeVisible()
  })

  it('contains pending actions, performs one callback, and preserves record-change failures', async () => {
    let resolveAction: () => void = () => undefined
    const pending = new Promise<void>((resolve) => { resolveAction = resolve })
    const onAction = vi.fn(() => pending)
    const { rerender } = render(<OperationsDesk projection={projection} selectedId="attention:ticket:blocked" onSelectedIdChange={() => undefined} onAction={onAction} />)

    const primary = screen.getByRole('button', { name: /review blocker/i })
    fireEvent.click(primary)
    fireEvent.click(primary)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /working/i })).toBeDisabled()
    resolveAction()
    await waitFor(() => expect(screen.getByRole('button', { name: /review blocker/i })).toBeEnabled())

    const changed = vi.fn(async () => { throw new Error('RECORD_CHANGED') })
    rerender(<OperationsDesk projection={projection} selectedId="attention:ticket:blocked" onSelectedIdChange={() => undefined} onAction={changed} />)
    fireEvent.click(screen.getByRole('button', { name: /review blocker/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/record changed/i)
  })

  it('reports receipt completion only after the durable writer succeeds', async () => {
    const receiptTicket: Ticket = {
      id: 'receipt-ticket', title: 'Receipt work', description: 'Review evidence', source: 'Codex', status: 'done',
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T01:00:00.000Z', workNotes: [], artifacts: [], decisionLog: [],
      receiptRequired: true, receiptIds: ['receipt-1'],
    }
    const writer = vi.fn(async () => ({ ok: true }))
    render(<ReceiptDispositionControls ticket={receiptTicket} updateDisposition={writer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(screen.getByRole('status')).toHaveTextContent(/saving/i)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/disposition saved/i))
    expect(writer).toHaveBeenCalledTimes(1)
    expect(writer).toHaveBeenCalledWith('receipt-1', 'accepted')
  })

  it('blocks receipt acceptance when the required receipt ID is absent', () => {
    const missing: Ticket = {
      id: 'missing-receipt', title: 'Missing receipt', description: 'No receipt linked', source: 'Codex', status: 'done',
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T01:00:00.000Z', workNotes: [], artifacts: [], decisionLog: [],
      receiptRequired: true, receiptIds: [],
    }
    render(<ReceiptDispositionControls ticket={missing} />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByText(/no AI receipt is linked/i)).toBeVisible()
  })

  it('uses a dismissible narrow inspector and returns focus to its queue row', async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes('1023px'), media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }))
    let selectedId: string | undefined = 'attention:ticket:blocked'
    let rerender: (ui: ReactNode) => void
    const onSelectedIdChange = (id?: string) => {
      selectedId = id
      rerender(<OperationsDesk projection={projection} selectedId={selectedId} onSelectedIdChange={onSelectedIdChange} />)
    }
    const rendered = render(<OperationsDesk projection={projection} selectedId={selectedId} onSelectedIdChange={onSelectedIdChange} />)
    rerender = rendered.rerender

    const dialog = await screen.findByRole('dialog', { name: /evidence for blocked release/i })
    expect(dialog).toBeVisible()
    expect(screen.getByRole('button', { name: /close inspector/i })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: /blocked release/i })).toHaveFocus())
    window.matchMedia = originalMatchMedia
  })
})
