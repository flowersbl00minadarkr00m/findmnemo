import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentActivityAssignmentSummaryDto, AgentActivityAssignmentUpdateDto, AgentActivityIntegrationDto, ProjectFolderSummaryDto } from '../shared/companion-contract'
import { ActiveAssignmentsPanel } from './components/ActiveAssignmentsPanel'
import { projectAttentionWorkspace } from './lib/attention-workspace'
import type { Ticket } from './types'

const assignment: AgentActivityAssignmentSummaryDto = {
  id: 'a'.repeat(64), integrationId: 'auto:codex-cli', ticketId: 'ticket-1', agent: 'codex-cli', agentLabel: 'Codex',
  summary: 'Implement the active work view', summaryOwner: 'source', project: { kind: 'approved-project', id: 'project-1', label: 'FindMnemo' }, projectOwner: 'source', modelLabel: null,
  effectiveState: 'stale', retainedLastState: 'needs-action', lastObservedAt: '2026-07-14T20:00:00.000Z', freshUntil: '2026-07-14T20:15:00.000Z', terminalAt: null,
  terminalEvidence: null, terminalOutcome: null, evidenceKind: 'codex-hook', sourceUpdatePolicy: 'follow', recordVersion: 3, linkedTicketKind: 'sdd-task-execution',
}

const project: ProjectFolderSummaryDto = {
  id: 'project-1', label: 'FindMnemo', state: 'active', detectedKind: 'sdd', sddEnrichmentEnabled: true,
  lastCheckedAt: '2026-07-14T20:00:00.000Z', lastSuccessAt: '2026-07-14T20:00:00.000Z', errorCode: null,
}

function ticket(): Ticket {
  return { id: 'ticket-1', title: assignment.summary, description: '', source: 'Codex', status: 'blocked', workNotes: [], artifacts: [], decisionLog: [], createdAt: assignment.lastObservedAt, updatedAt: assignment.lastObservedAt, origin: 'agent-runtime' }
}

function integration(state: AgentActivityIntegrationDto['coverageState']): AgentActivityIntegrationDto {
  return {
    id: 'auto:codex-cli', agent: 'codex-cli', label: 'Codex', installedVersion: '0.144.3', supported: true, configured: true, enabled: true, agentAuthState: 'authenticated', integrationAuthState: 'ready', trustState: 'trusted', statusCheckedAt: '2026-07-14T22:00:00.000Z',
    supportLevel: 'automatic-partial', coverageState: state, coverageExplanation: 'Retained last success.', capabilities: { detection: true, manual: true, snapshot: 'next-interaction', automaticEvents: 'partial', automaticTerminal: 'none' },
    freshnessProfile: 'hook-observed', freshnessWindowSeconds: 900, lastEventAt: assignment.lastObservedAt, lastSuccessAt: assignment.lastObservedAt, retainedLastSuccess: state === 'stale', pendingEventCount: 0, gapCount: 0, failureCode: null, primaryAction: 'test',
  }
}

function disconnectedIntegration(): AgentActivityIntegrationDto {
  return {
    ...integration('unavailable'),
    configured: false,
    enabled: false,
    integrationAuthState: 'not-configured',
    trustState: 'not-applicable',
    lastEventAt: null,
    lastSuccessAt: null,
    retainedLastSuccess: false,
    coverageExplanation: 'Enable tracking to begin.',
    primaryAction: 'enable',
  }
}

function unsupportedIntegration(): AgentActivityIntegrationDto {
  return {
    ...disconnectedIntegration(),
    supported: false,
    supportLevel: 'unsupported',
    coverageState: 'unsupported',
    coverageExplanation: 'This version is not qualified for automatic activity capture.',
    capabilities: { detection: true, manual: true, snapshot: 'none', automaticEvents: 'none', automaticTerminal: 'none' },
    primaryAction: 'manual-report',
  }
}

describe('active assignment operations workspace', () => {
  it('places needs-action and stale truth in My Day without duplicating the linked ticket', () => {
    const projection = projectAttentionWorkspace({ tickets: [ticket()], agentAssignments: [assignment], agentIntegrations: [integration('stale')], ticketState: 'current', now: '2026-07-14T20:20:00.000Z' })
    expect(projection.items.filter((item) => item.recordRef === 'ticket:ticket-1')).toHaveLength(1)
    expect(projection.items[0]).toMatchObject({ bucket: 'needs-action', truthState: 'stale', priorityReason: expect.stringMatching(/last reported needs action/i) })
    expect(projection.sources).toContainEqual(expect.objectContaining({ id: 'agent-activity:auto:codex-cli', label: 'Codex activity', truthState: 'stale', detail: expect.stringMatching(/retained/i) }))
  })

  it('renders stacked state/evidence and preserves optimistic ownership in update controls', async () => {
    const onUpdate = vi.fn(async (_id: string, input: AgentActivityAssignmentUpdateDto) => ({ ...assignment, summary: input.safeSummary ?? assignment.summary, summaryOwner: 'human' as const, recordVersion: 4 }))
    render(<ActiveAssignmentsPanel assignments={[assignment]} projects={[project]} integrations={[integration('stale')]} onUpdate={onUpdate} />)
    expect(screen.getByRole('region', { name: /active agent assignments/i })).toHaveClass('min-w-0')
    expect(screen.getByText('Stale — last reported Needs action')).toBeVisible()
    expect(screen.getByText('Linked to existing SDD task ticket')).toBeVisible()
    fireEvent.click(screen.getByText('Automation and your changes'))
    expect(screen.getByText(/your summary and project choices stay yours/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /rename assignment/i }))
    fireEvent.change(screen.getByLabelText(/safe assignment summary/i), { target: { value: 'Human-safe title' } })
    fireEvent.click(screen.getByRole('button', { name: /save summary/i }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(assignment.id, { expectedVersion: 3, safeSummary: 'Human-safe title' }))
    expect(screen.getByRole('status')).toHaveTextContent(/saved/i)
  })

  it('requires confirmation to close and exposes pause and detach as text controls', async () => {
    const onUpdate = vi.fn(async (_id: string, input: AgentActivityAssignmentUpdateDto) => ({ ...assignment, sourceUpdatePolicy: input.sourceUpdatePolicy ?? assignment.sourceUpdatePolicy, recordVersion: input.expectedVersion + 1 }))
    render(<ActiveAssignmentsPanel assignments={[assignment]} projects={[project]} integrations={[integration('connected')]} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause updates' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(assignment.id, { expectedVersion: 3, sourceUpdatePolicy: 'paused' }))
    fireEvent.click(screen.getByRole('button', { name: 'Detach source' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(assignment.id, { expectedVersion: 3, sourceUpdatePolicy: 'detached' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close assignment' }))
    expect(onUpdate).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm close assignment' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(assignment.id, { expectedVersion: 3, sourceUpdatePolicy: 'closed' }))
  })

  it('explains that installed agents do not create tickets until tracking reports an assignment', () => {
    const onOpenPrivacy = vi.fn()
    render(<ActiveAssignmentsPanel assignments={[]} projects={[]} integrations={[disconnectedIntegration()]} onOpenPrivacy={onOpenPrivacy} />)

    expect(screen.getByRole('heading', { name: 'Automatic agent tracking is off' })).toBeVisible()
    expect(screen.getByText(/installing or using Codex, Claude Code, or Pi does not connect it to FindMnemo/i)).toBeVisible()
    expect(screen.getByText(/tickets are created only after an enabled integration reports an assignment/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Set up agent tracking' }))
    expect(onOpenPrivacy).toHaveBeenCalledOnce()
  })

  it('distinguishes connected coverage with no observed assignment from disconnected tracking', () => {
    render(<ActiveAssignmentsPanel assignments={[]} projects={[]} integrations={[integration('empty')]} />)

    expect(screen.getByRole('heading', { name: 'Tracking is connected; no assignment observed' })).toBeVisible()
    expect(screen.getByText(/does not prove that no agent work exists/i)).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Automatic agent tracking is off' })).not.toBeInTheDocument()
  })

  it('prefers the manual-only explanation when every detected integration is unsupported and disabled', () => {
    const onOpenPrivacy = vi.fn()
    render(<ActiveAssignmentsPanel assignments={[]} projects={[]} integrations={[unsupportedIntegration()]} onOpenPrivacy={onOpenPrivacy} />)

    expect(screen.getByRole('heading', { name: 'Automatic tracking is unsupported for these agent versions' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Automatic agent tracking is off' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review manual options' }))
    expect(onOpenPrivacy).toHaveBeenCalledOnce()
  })

  it('does not claim tracking is disconnected while assignment coverage is loading', () => {
    render(<ActiveAssignmentsPanel assignments={[]} projects={[]} integrations={[]} loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading active assignments')
    expect(screen.queryByRole('heading', { name: 'Automatic agent tracking is off' })).not.toBeInTheDocument()
  })
})
