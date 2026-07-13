import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { OperationalRepository } from './lib/operational-repository'
import { HOME_VIEW_PREFERENCE_KEY } from './lib/view-preference'

function repository(): OperationalRepository {
  return {
    listTickets: vi.fn(async () => []),
    createTicket: vi.fn(),
    updateTicketStatus: vi.fn(),
    addWorkNote: vi.fn(),
    deleteTicket: vi.fn(),
  }
}

describe('Operational home view migration', () => {
  beforeEach(() => window.localStorage.clear())

  it('defaults to Operations Desk and persists only the selected home view', async () => {
    render(<App operationalRepository={repository()} />)
    expect(await screen.findByRole('heading', { name: 'Operations Desk' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Daily Brief' }))
    expect(await screen.findByRole('heading', { name: 'Daily Brief' })).toBeInTheDocument()
    expect(window.localStorage.getItem(HOME_VIEW_PREFERENCE_KEY)).toBe('brief')
  })

  it('honors a valid Daily Brief preference without changing route identity', async () => {
    window.localStorage.setItem(HOME_VIEW_PREFERENCE_KEY, 'brief')
    window.history.replaceState({}, '', '/app')
    render(<App operationalRepository={repository()} />)
    expect(await screen.findByRole('heading', { name: 'Daily Brief' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/app')
    expect(screen.getByRole('button', { name: 'Tickets' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Projects/SDD' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Model Routing' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Analytics' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Emails' })).toBeVisible()
  })
})
