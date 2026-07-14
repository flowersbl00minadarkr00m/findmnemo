import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRouter } from './WorkspaceRouter'
import {
  createSampleTicket,
  getSampleSessionKey,
  loadSampleWorkspace,
  resetSampleWorkspace,
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
    expect(screen.getByRole('heading', { name: 'Sample model routing' })).toBeVisible()
    expect(screen.getByText(/does not call the companion or configure real AI providers/i)).toBeVisible()
    fireEvent.click(screen.getByText('Metrics'))
    expect(screen.getByRole('heading', { name: 'Sample model usage' })).toBeVisible()
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
    const initial = loadSampleWorkspace()
    const changed = createSampleTicket(initial, 'Fictional test ticket', 'Sample only', 'Codex')

    expect(changed.tickets).toHaveLength(initial.tickets.length + 1)
    expect(window.sessionStorage.getItem(getSampleSessionKey())).toContain('Fictional test ticket')
    expect(window.localStorage.length).toBe(0)

    const reset = resetSampleWorkspace()
    expect(reset.tickets).toHaveLength(initial.tickets.length)
    expect(reset.tickets.every((ticket) => ticket.origin === 'demo')).toBe(true)
  })

  it('shows permissioned operational onboarding with no seeded counts', () => {
    window.history.replaceState({}, '', '/app')
    render(<WorkspaceRouter />)

    expect(screen.getByText('Operational workspace · permission-required')).toBeVisible()
    expect(screen.getByText('Local network permission required')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connect local companion' })).toBeEnabled()
    expect(screen.queryByText(/tickets in flight/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/FindMnemo Sample Workspace/i)).not.toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'Open local fallback' })).toHaveAttribute('href', 'http://127.0.0.1:3210/app')
  })
})
