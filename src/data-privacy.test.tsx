import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DataPrivacyView } from './components/DataPrivacyView'
import { AgentActivityControls } from './components/AgentActivityControls'
import type { OperationalRepository } from './lib/operational-repository'

const integration = { id: 'auto:claude-code', agent: 'claude-code', label: 'Claude Code', installedVersion: '2.1.207', supported: true, configured: true, enabled: true, agentAuthState: 'authenticated', integrationAuthState: 'ready', trustState: 'trusted', statusCheckedAt: '2026-07-14T22:00:00.000Z', supportLevel: 'automatic-task-terminal', coverageState: 'empty', coverageExplanation: 'Connected, but no assignment has been observed in this window.', capabilities: { detection: true, manual: true, snapshot: 'next-interaction', automaticEvents: 'partial', automaticTerminal: 'task-only' }, freshnessProfile: 'hook-observed', freshnessWindowSeconds: 900, lastEventAt: null, lastSuccessAt: null, retainedLastSuccess: false, pendingEventCount: 0, gapCount: 0, failureCode: null, primaryAction: 'test' } as const

function repo(): OperationalRepository {
  return { listTickets: vi.fn(async () => []), createTicket: vi.fn(), updateTicketStatus: vi.fn(), addWorkNote: vi.fn(), deleteTicket: vi.fn(), listProjectFolders: vi.fn(async () => []), listAgentActivityIntegrations: vi.fn(async () => [integration]), manageAgentActivity: vi.fn(async (_id, action) => ({ operation: action, integrationId: integration.id, outcome: 'complete' as const, completedAt: new Date().toISOString(), changed: false, coverageState: 'empty' as const, nextAction: 'Validation passed without creating a ticket.' })) }
}

describe('Data & Privacy agent activity', () => {
  it('shows exact disclosure and runs a validation-only safe test', async () => {
    const repository = repo(); render(<DataPrivacyView repository={repository} />)
    expect(await screen.findByRole('heading', { name: 'Claude Code' })).toBeVisible()
    expect(screen.getByText(/Prompts, responses, reasoning, transcripts/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Run safe test' }))
    await screen.findByText('Validation passed without creating a ticket.')
    expect(repository.manageAgentActivity).toHaveBeenCalledWith(integration.id, 'test', false)
  })

  it('keeps Sample isolated from operational management', async () => {
    const repository = repo(); render(<DataPrivacyView repository={repository} sample />)
    await waitFor(() => expect(repository.listAgentActivityIntegrations).not.toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Run safe test' })).not.toBeInTheDocument()
  })

  it('shows real manual-report guidance without falling through to safe test', async () => {
    const repository = repo()
    const unsupportedPi = {
      ...integration,
      id: 'auto:pi', agent: 'pi', label: 'Pi', installedVersion: '0.80.7', supported: false, configured: false, enabled: false,
      agentAuthState: 'not-applicable', integrationAuthState: 'not-configured', trustState: 'not-applicable', statusCheckedAt: '2026-07-14T22:00:00.000Z',
      supportLevel: 'unsupported', coverageState: 'unsupported', coverageExplanation: 'This Pi version is manual only.',
      capabilities: { detection: true, manual: true, snapshot: 'none', automaticEvents: 'none', automaticTerminal: 'none' }, primaryAction: 'manual-report',
    } as const
    render(<AgentActivityControls integrations={[unsupportedPi]} repository={repository} />)
    expect(screen.queryByRole('button', { name: 'Snapshot current work' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check manual reporting' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/report:activity/)
    expect(repository.manageAgentActivity).not.toHaveBeenCalled()
  })
})
