import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SourceSetup } from './components/SourceSetup'
import type { OperationalRepository } from './lib/operational-repository'
import type { OnboardingSnapshotDto, ReconciliationRunDto, SourceId } from '../shared/companion-contract'

function repository(): OperationalRepository {
  const snapshot: OnboardingSnapshotDto = { schemaVersion: 1, needsSetup: true, lastRun: null, sources: [
    { id: 'gmail', label: 'Gmail follow-up', description: 'Find replies.', privacy: 'Metadata stays local.', produces: 'Outreach candidates.', state: 'needs-setup', reconciliationSourceId: null, action: 'set-up' },
    { id: 'project-folders', label: 'Project folders', description: 'Folders you choose.', privacy: 'Paths stay local.', produces: 'Project evidence.', state: 'connected', reconciliationSourceId: 'project-folders', action: 'review' },
    { id: 'agent-activity', label: 'Agent activity', description: 'Current work.', privacy: 'Private content is excluded.', produces: 'Assignment status.', state: 'available', reconciliationSourceId: null, action: 'view-details', agentActivity: [{ id: 'auto:codex-cli', agent: 'codex-cli', label: 'Codex', installedVersion: '0.144.3', supported: true, configured: false, enabled: false, agentAuthState: 'authenticated', integrationAuthState: 'not-configured', trustState: 'not-applicable', statusCheckedAt: '2026-07-14T22:00:00.000Z', supportLevel: 'automatic-partial', coverageState: 'unavailable', coverageExplanation: 'Enable tracking to begin.', capabilities: { detection: true, manual: true, snapshot: 'next-interaction', automaticEvents: 'partial', automaticTerminal: 'none' }, freshnessProfile: 'hook-observed', freshnessWindowSeconds: 900, lastEventAt: null, lastSuccessAt: null, retainedLastSuccess: false, pendingEventCount: 0, gapCount: 0, failureCode: null, primaryAction: 'enable' }] },
  ] }
  const running = (sourceIds: SourceId[]): ReconciliationRunDto => ({ id: 'run-1', state: 'running', requestedSourceIds: sourceIds, sources: [], items: [] })
  const complete: ReconciliationRunDto = { id: 'run-1', state: 'complete', requestedSourceIds: ['project-folders'], sources: [{ sourceId: 'project-folders', state: 'checked', checked: 1, added: 0, updated: 0, unchanged: 1, excluded: 0, duplicate: 0, unresolved: 0 }], items: [] }
  return {
    listTickets: vi.fn(async () => []), createTicket: vi.fn(), updateTicketStatus: vi.fn(), addWorkNote: vi.fn(), deleteTicket: vi.fn(),
    getOnboardingSnapshot: vi.fn(async () => snapshot),
    startOnboardingRefresh: vi.fn(async (sourceIds) => running(sourceIds)),
    getReconciliationRun: vi.fn(async () => complete),
    manageAgentActivity: vi.fn(async () => ({ operation: 'enable' as const, integrationId: 'auto:codex-cli', outcome: 'complete' as const, completedAt: new Date().toISOString(), changed: true, coverageState: 'empty' as const, nextAction: 'Run a safe test.' })),
    listAgentActivityIntegrations: vi.fn(async () => snapshot.sources.find((source) => source.id === 'agent-activity')!.agentActivity!),
  }
}

describe('first-run source setup', () => {
  it('explains boundaries, refreshes only selected configured sources, and treats empty as success', async () => {
    const repo = repository()
    render(<SourceSetup repository={repo} onNavigate={vi.fn()} onFinished={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Choose what FindMnemo should read' })).toBeVisible()
    expect(screen.getByText('Paths stay local.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Codex' })).toBeVisible()
    expect(screen.getByText(/Prompts, responses, reasoning/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh selected sources' }))
    await screen.findByText('Refresh complete — nothing needs attention yet')
    expect(repo.startOnboardingRefresh).toHaveBeenCalledWith(['project-folders'])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open My Day' })).toBeVisible())
  })
})
