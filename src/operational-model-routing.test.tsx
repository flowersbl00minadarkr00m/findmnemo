import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import type { OperationalRepository } from './lib/operational-repository'
import type { Ticket } from './types'

const operationalTicket: Ticket = {
  id: 'ticket:operational-routing',
  title: 'Implement companion-backed routing test',
  description: 'Code the approved operational routing integration.',
  source: 'Codex',
  status: 'todo',
  workNotes: [],
  artifacts: [],
  decisionLog: [],
  createdAt: '2026-07-10T18:00:00.000Z',
  updatedAt: '2026-07-10T18:00:00.000Z',
  origin: 'local-bridge',
}

function createOperationalRepository(): OperationalRepository {
  return {
    listTickets: vi.fn(async () => [operationalTicket]),
    createTicket: vi.fn(),
    updateTicketStatus: vi.fn(),
    addWorkNote: vi.fn(),
    deleteTicket: vi.fn(),
  }
}

describe('companion-backed Model Routing integration', () => {
  it('launches routing from a real operational repository ticket', async () => {
    render(<App operationalRepository={createOperationalRepository()} />)

    expect((await screen.findAllByText(operationalTicket.title)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Next Actions'))
    fireEvent.click((await screen.findAllByTitle('Open ticket detail'))[0])
    fireEvent.click(screen.getByRole('button', { name: 'Recommend route' }))

    expect(await screen.findByRole('heading', { name: 'Model Routing' }, { timeout: 5000 })).toBeVisible()
    expect(screen.getByText('Ticket ticket:operational-routing')).toBeVisible()
    expect(screen.getByText(operationalTicket.title)).toBeVisible()
  })
})
