import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReconciliationRunDto, SourceDescriptor } from '../shared/companion-contract'
import App from './App'
import { ReconciliationResults } from './components/ReconciliationResults'
import { SourceCoverage } from './components/SourceCoverage'
import type { OperationalRepository } from './lib/operational-repository'
import { recordReconciliationTelemetry } from './lib/reconciliation'
import { loadTelemetry } from './lib/telemetry'
import type { Ticket } from './types'

const source: SourceDescriptor = { id: 'findmnemo-tickets', label: 'FindMnemo tickets', adapterVersion: '1.0.0', enabled: true, policy: 'auto-create' }
const run: ReconciliationRunDto = {
  id: 'run-1', state: 'complete', requestedSourceIds: ['findmnemo-tickets'], startedAt: '2026-07-11T08:00:00.000Z', finishedAt: '2026-07-11T08:00:01.000Z',
  sources: [{ sourceId: 'findmnemo-tickets', state: 'checked', checked: 1, added: 0, updated: 0, unchanged: 1, excluded: 0, duplicate: 0, unresolved: 0 }],
  items: [{ sourceId: 'findmnemo-tickets', externalId: 'ticket-1', classification: 'unchanged', ticketId: 'ticket-1' }],
}
const ticket: Ticket = { id: 'ticket-1', title: 'Keep ownership stable', description: 'No handoff', source: 'Codex', status: 'in-progress', workNotes: [], decisionLog: [], artifacts: [], createdAt: run.startedAt!, updatedAt: run.startedAt!, origin: 'local-bridge' }

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
})
afterEach(() => vi.restoreAllMocks())

describe('operational MnemoSync results', () => {
  it('runs reconciliation without mutating ticket ownership or agent state', async () => {
    const updateTicketStatus = vi.fn()
    const repository: OperationalRepository = {
      listTickets: vi.fn().mockResolvedValue([ticket]), createTicket: vi.fn(), updateTicketStatus,
      addWorkNote: vi.fn(), deleteTicket: vi.fn(), listReconciliationSources: vi.fn().mockResolvedValue([source]),
      listReconciliationRuns: vi.fn().mockResolvedValue([]), startReconciliation: vi.fn().mockResolvedValue(run),
      getReconciliationRun: vi.fn().mockResolvedValue(run), retryReconciliation: vi.fn(),
    }
    render(<App operationalRepository={repository} />)
    expect((await screen.findAllByText(ticket.title)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'MnemoSync' }))

    await screen.findByText(/MnemoSync complete/)
    expect(screen.getByText(/1 checked · 0 added · 0 updated · 1 unchanged/)).toBeVisible()
    expect(updateTicketStatus).not.toHaveBeenCalled()
    expect(ticket).toMatchObject({ source: 'Codex', status: 'in-progress' })
    expect(loadTelemetry()).toHaveLength(1)
    expect(loadTelemetry()[0].activity.type).toBe('reconcile')
  })

  it('states partial gaps in text and offers an exact-source retry', () => {
    const retry = vi.fn()
    const partial: ReconciliationRunDto = {
      ...run, state: 'partial', requestedSourceIds: ['agent-ledger'],
      sources: [{ sourceId: 'agent-ledger', state: 'checked', checked: 2, added: 0, updated: 0, unchanged: 0, excluded: 0, duplicate: 1, unresolved: 1 }],
      items: [{ sourceId: 'agent-ledger', externalId: 'opaque-1', classification: 'unresolved', reasonCode: 'REVIEW_REQUIRED' }],
    }
    const ledger: SourceDescriptor = { id: 'agent-ledger', label: 'Registered agent ledger', adapterVersion: '1.0.0', enabled: true, policy: 'review' }
    render(<><ReconciliationResults run={partial} lastSuccess="2026-07-10T08:00:00.000Z" /><SourceCoverage run={partial} sources={[ledger]} onRetry={retry} /></>)
    expect(screen.getByText(/MnemoSync partial/)).toBeVisible()
    expect(screen.getByText(/1 durable item gap/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Retry this source' }))
    expect(retry).toHaveBeenCalledWith('agent-ledger')
  })

  it('emits privacy-minimized reconcile telemetry without source content or handoff claims', async () => {
    const sensitive = { ...run, items: [{ sourceId: 'gmail-followups' as const, externalId: 'sender@example.com:private-thread', classification: 'unresolved' as const }] }
    recordReconciliationTelemetry(sensitive)
    await waitFor(() => expect(loadTelemetry()).toHaveLength(1))
    const serialized = JSON.stringify(loadTelemetry())
    expect(serialized).not.toMatch(/sender@example|private-thread|"title"|canonicalPath|"type":"handoff"/i)
    expect(serialized).toContain('reconcile')
  })
})
