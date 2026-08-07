import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AttentionWorkspaceProjection } from './types'
import type { AgentActivityIntegrationDto } from '../shared/companion-contract'
import { DailyBrief } from './components/DailyBrief'

const projection: AttentionWorkspaceProjection = {
  dayStatus: { queued: 3, resolved: 1, progress: 33, label: '1 of 3 decisions resolved' },
  sources: [{ id: 'gmail-followups', label: 'Gmail', truthState: 'stale', detail: 'Last result retained' }],
  items: [
    { id: 'attention:ticket:one', kind: 'ticket', recordRef: 'ticket:one', title: 'Decide now', summary: 'Open decision', sourceLabel: 'Ticket', bucket: 'needs-action', priority: 'high', priorityReason: 'Decision needed.', truthState: 'current', evidence: { availability: 'missing', refs: [], blockers: [], receiptIds: [], reasonCodes: [] }, primaryAction: { id: 'ticket:one:open', kind: 'open-ticket', label: 'Review', recordRef: 'ticket:one' }, secondaryActions: [{ id: 'ticket:one:done', kind: 'change-status', label: 'Mark done', recordRef: 'ticket:one', targetStatus: 'done' }] },
    { id: 'attention:ticket:two', kind: 'ticket', recordRef: 'ticket:two', title: 'Waiting work', summary: 'Dependency pending', sourceLabel: 'Ticket', bucket: 'waiting', priority: 'normal', priorityReason: 'Waiting on dependency.', truthState: 'partial', evidence: { availability: 'partial', refs: [], blockers: [{ id: 'external', state: 'missing' }], receiptIds: [], reasonCodes: [] }, primaryAction: { id: 'ticket:two:open', kind: 'open-ticket', label: 'Inspect', recordRef: 'ticket:two' }, secondaryActions: [] },
    { id: 'attention:ticket:three', kind: 'ticket', recordRef: 'ticket:three', title: 'Resolved work', summary: 'Completed', sourceLabel: 'Ticket', bucket: 'recently-resolved', priority: 'low', priorityReason: 'Recently resolved.', truthState: 'current', evidence: { availability: 'available', refs: [], blockers: [], receiptIds: [], reasonCodes: [] }, primaryAction: { id: 'ticket:three:open', kind: 'open-ticket', label: 'Review outcome', recordRef: 'ticket:three' }, secondaryActions: [] },
  ],
}

describe('Daily Brief', () => {
  it('separates the three buckets and keeps source truth explicit', () => {
    render(<DailyBrief projection={projection} onSelectedIdChange={() => undefined} onAction={async () => undefined} onHomeViewChange={() => undefined} />)
    expect(within(screen.getByRole('list', { name: 'Needs action' })).getByText('Decide now')).toBeVisible()
    expect(within(screen.getByRole('list', { name: 'Waiting' })).getByText('Waiting work')).toBeVisible()
    expect(within(screen.getByRole('list', { name: 'Recently resolved' })).getByText('Resolved work')).toBeVisible()
    expect(screen.getByText('stale')).toBeVisible()
    expect(screen.getByText('33%')).toBeVisible()
  })

  it('uses the same item action descriptor and exposes secondary actions in a menu', async () => {
    const onAction = vi.fn(async () => undefined)
    render(<DailyBrief projection={projection} onSelectedIdChange={() => undefined} onAction={onAction} onHomeViewChange={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(onAction).toHaveBeenCalledWith(projection.items[0].primaryAction, projection.items[0])
    fireEvent.click(screen.getByText('More actions'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark done' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith(projection.items[0].secondaryActions[0], projection.items[0]))
  })

  it('shows safe empty progress without false completion', () => {
    render(<DailyBrief projection={{ items: [], sources: [], dayStatus: { queued: 0, resolved: 0, progress: null, label: 'No decisions queued' } }} onSelectedIdChange={() => undefined} onAction={async () => undefined} onHomeViewChange={() => undefined} />)
    expect(screen.getByText('No decisions queued')).toBeVisible()
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })

  it('surfaces disconnected agent tracking in the decision view', () => {
    const integration: AgentActivityIntegrationDto = {
      id: 'auto:codex-cli', agent: 'codex-cli', label: 'Codex', installedVersion: '0.144.3', supported: true,
      configured: false, enabled: false, agentAuthState: 'authenticated', integrationAuthState: 'not-configured', trustState: 'not-applicable', statusCheckedAt: '2026-07-19T20:00:00.000Z',
      supportLevel: 'automatic-partial', coverageState: 'unavailable', coverageExplanation: 'Enable tracking to begin.', capabilities: { detection: true, manual: true, snapshot: 'next-interaction', automaticEvents: 'partial', automaticTerminal: 'none' },
      freshnessProfile: 'hook-observed', freshnessWindowSeconds: 900, lastEventAt: null, lastSuccessAt: null, retainedLastSuccess: false, pendingEventCount: 0, gapCount: 0, failureCode: null, primaryAction: 'enable',
    }
    const onOpenPrivacy = vi.fn()
    render(<DailyBrief projection={{ items: [], sources: [], dayStatus: { queued: 0, resolved: 0, progress: null, label: 'No decisions queued' } }} onSelectedIdChange={() => undefined} onAction={async () => undefined} onHomeViewChange={() => undefined} agentIntegrations={[integration]} agentAssignmentCount={0} onOpenPrivacy={onOpenPrivacy} />)

    expect(screen.getByRole('heading', { name: 'Automatic agent tracking is off' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Set up agent tracking' }))
    expect(onOpenPrivacy).toHaveBeenCalledOnce()
  })
})
