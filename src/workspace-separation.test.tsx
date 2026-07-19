import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRouter } from './WorkspaceRouter'
import {
  createSampleTicket,
  getSampleSessionKey,
  loadSampleWorkspace,
  resetSampleWorkspace,
  updateSampleTicketStatus,
} from './lib/sample-repository'
import { getWorkspaceKind } from './lib/settings'

describe('workspace route separation', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    window.sessionStorage.clear()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('derives workspace identity from the pathname instead of a stored mode', () => {
    expect(getWorkspaceKind('/')).toBe('landing')
    expect(getWorkspaceKind('/demo')).toBe('sample')
    expect(getWorkspaceKind('/demo/tickets')).toBe('sample')
    expect(getWorkspaceKind('/app')).toBe('operational')
    expect(getWorkspaceKind('/assets/index.js')).toBe('not-found')
    expect(getWorkspaceKind('/api/v1/status')).toBe('not-found')
  })

  it('renders fictional sample data without fetch or operational localStorage access', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const localGet = vi.spyOn(window.localStorage, 'getItem')
    const localSet = vi.spyOn(window.localStorage, 'setItem')
    window.history.replaceState({}, '', '/demo')

    render(<WorkspaceRouter />)

    expect(screen.getByLabelText('Sample workspace notice')).toHaveTextContent('fictional')
    expect(screen.getByText(/FindMnemo Sample Workspace/i)).toBeInTheDocument()
    expect(screen.queryByText(/Toggle Demo \/ Live/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Operations Desk' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Daily Brief' }))
    expect(await screen.findByRole('heading', { name: 'Daily Brief' }, { timeout: 5_000 })).toBeInTheDocument()
    expect(screen.getAllByText(/fictional/i).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Engines'))
    expect(await screen.findByRole('heading', { name: 'Sample model routing' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'One assignment per work type' })).toBeVisible()
    expect(screen.getByText('DEMO-ROUTE-024')).toBeVisible()
    fireEvent.click(screen.getByText('Metrics'))
    expect(await screen.findByRole('heading', { name: 'Sample model usage' })).toBeVisible()
    expect(screen.getByText('1.82m')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Partial, not complete' })).toBeVisible()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(localGet).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
  })

  it('supports a development-only sanitized browser fixture on the operational path', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    window.history.replaceState({}, '', '/app?fixture=sample')
    render(<WorkspaceRouter />)
    expect(screen.getByLabelText('Sample workspace notice')).toHaveTextContent('fictional')
    expect(screen.getByRole('heading', { name: 'Operations Desk' })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps sample mutations in the tab namespace and restores canonical fixtures', () => {
    window.sessionStorage.setItem('findmnemo.sample.workspace.v1', JSON.stringify({ tickets: [], activities: [], emails: [] }))
    const initial = loadSampleWorkspace()
    const changed = createSampleTicket(initial, 'Fictional test ticket', 'Sample only', 'Codex')

    expect(changed.tickets).toHaveLength(initial.tickets.length + 1)
    expect(window.sessionStorage.getItem(getSampleSessionKey())).toContain('Fictional test ticket')
    expect(window.localStorage.length).toBe(0)
    expect(getSampleSessionKey()).toBe('findmnemo.sample.workspace.v2')

    const reset = resetSampleWorkspace()
    expect(reset.tickets).toHaveLength(initial.tickets.length)
    expect(reset.tickets.every((ticket) => ticket.origin === 'demo')).toBe(true)
  })

  it('records explicit completion evidence for sample status changes and clears it on reopen', () => {
    const initial = loadSampleWorkspace()
    const active = initial.tickets.find((ticket) => ticket.status !== 'done')!
    const completed = updateSampleTicketStatus(initial, active.id, 'done')
    const completedTicket = completed.tickets.find((ticket) => ticket.id === active.id)!

    expect(completedTicket.completedAt).toBeTruthy()

    const reopened = updateSampleTicketStatus(completed, active.id, 'in-progress')
    expect(reopened.tickets.find((ticket) => ticket.id === active.id)?.completedAt).toBeNull()
    expect(initial.tickets.filter((ticket) => ticket.status === 'done').every((ticket) => Boolean(ticket.completedAt))).toBe(true)
  })

  it('shows permissioned operational onboarding with no seeded counts', () => {
    window.history.replaceState({}, '', '/app')
    render(<WorkspaceRouter />)

    expect(screen.getByText('Operational workspace · permission-required')).toBeVisible()
    expect(screen.getByText('Permission needed to connect this computer')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connect this computer' })).toBeEnabled()
    expect(screen.queryByText(/tickets in flight/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/FindMnemo Sample Workspace/i)).not.toBeInTheDocument()
  })

  it('turns an unreachable companion into actionable install and start guidance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    window.history.replaceState({}, '', '/app')
    render(<WorkspaceRouter />)

    fireEvent.click(screen.getByRole('button', { name: 'Connect this computer' }))

    expect(await screen.findByText('Local companion not detected')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'The local companion must be installed and running' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open Windows install and source-run guidance' })).toHaveAttribute('href', expect.stringContaining('unsigned-windows-preview.md'))
    expect(screen.getByRole('link', { name: 'Open local app (requires companion running)' })).toHaveAttribute('href', 'http://127.0.0.1:3210/app')
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('COMPANION_UNREACHABLE')
  })

  it('offers reset and exit controls on every Sample workspace view', () => {
    window.history.replaceState({}, '', '/demo')
    render(<WorkspaceRouter />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset sample' }))
    expect(screen.getByText('Sample fixtures restored.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Exit sample' })).toHaveAttribute('href', '/')
  })

  it('disables only the hosted operational entry when the rollback flag is off', () => {
    vi.stubEnv('VITE_LOCAL_COMPANION_ENABLED', 'false')
    window.history.replaceState({}, '', '/app')

    render(<WorkspaceRouter />)

    expect(screen.getByRole('status')).toHaveTextContent('rollback mode')
    expect(screen.getByText(/local database and Gmail credential remain on this computer/i)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open local app (requires companion running)' })).toHaveAttribute('href', 'http://127.0.0.1:3210/app')
  })
})
