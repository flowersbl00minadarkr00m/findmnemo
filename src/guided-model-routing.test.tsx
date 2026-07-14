import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelRoutingView } from './components/ModelRoutingView'
import { createEmptyModelRoutingPolicy } from './lib/model-routing'
import type { OperationalRepository } from './lib/operational-repository'
import type { OperationalRoutingPolicy } from '../shared/companion-contract'

const legacy = createEmptyModelRoutingPolicy()

function repository(overrides: Partial<OperationalRepository> = {}): OperationalRepository {
  return {
    listTickets: vi.fn(async () => []),
    createTicket: vi.fn(),
    updateTicketStatus: vi.fn(),
    addWorkNote: vi.fn(),
    deleteTicket: vi.fn(),
    getRoutingPolicy: vi.fn(async () => null),
    updateRoutingPolicy: vi.fn(async (policy: OperationalRoutingPolicy) => ({ ...policy, policyVersion: 1 })),
    discoverRoutingDestinations: vi.fn(async () => ({
      checkedAt: '2026-07-12T20:00:00.000Z', complete: true,
      destinations: [{ adapterId: 'pi-rpc', displayName: 'Pi', installation: 'detected' as const, compatibility: 'supported' as const, controllability: 'controllable' as const, readiness: 'unchecked' as const, executableLabel: 'pi', installedVersion: '0.80.3', supportedRange: '>=0.80.0 <0.81.0', testedCapabilities: ['catalog', 'readiness', 'execution'], evidenceAt: '2026-07-12T20:00:00.000Z', reasonCode: null, guidance: 'Use Pi authentication outside FindMnemo.' }],
    })),
    refreshPiModelCatalog: vi.fn(async () => ({ adapterId: 'pi-rpc', adapterVersion: '1.0.0', installedVersion: '0.80.3', checkedAt: '2026-07-12T20:00:00.000Z', expiresAt: '2026-07-12T20:15:00.000Z', models: [{ providerId: 'openrouter', modelId: 'cohere/north-mini-code:free', displayName: 'North Mini Code Free', reasoning: true, supportedEfforts: ['low', 'high'] }] })),
    ...overrides,
  }
}

describe('guided model routing', () => {
  it('shows factual past-usage context without changing or dispatching a route', async () => {
    const policy: OperationalRoutingPolicy = {
      schemaVersion: '2.0.0',
      policyProfile: 'findmnemo.model-routing.v2',
      policyVersion: 3,
      updatedAt: '2026-07-13T00:00:00.000Z',
      capabilities: legacy.capabilities,
      profiles: [{
        id: 'profile:writing', displayName: 'Writing with Pi', destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default',
        providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4', effort: 'high', capabilityIds: ['creation.writing'], enabled: true,
        behavior: 'recommend', fallbackOrder: 0,
        readiness: { state: 'ready', checkedAt: '2026-07-13T00:00:00.000Z', expiresAt: '2026-07-13T00:15:00.000Z', adapterVersion: '1.0.0', installedVersion: '0.80.3', reasonCode: null },
      }],
      defaultProfileOrder: ['profile:writing'],
      capabilityOverrides: [],
    }
    const repo = repository({
      getRoutingPolicy: vi.fn(async () => policy),
      getUsageRouteObservations: vi.fn(async () => [{
        profileId: 'profile:writing', observation: 'most-used-route' as const, recordCount: 8, totalTokens: 12000, estimatedCost: 1.25,
        coverageComplete: true, periodStart: '2026-07-01', periodEnd: '2026-07-13',
      }]),
    })
    const onOpenUsage = vi.fn()

    render(<ModelRoutingView policy={legacy} onPolicyChange={vi.fn()} operationalRepository={repo} onOpenUsage={onOpenUsage} />)
    const evidence = await screen.findByRole('button', { name: /Past usage: most used for Writing with Pi/i })
    fireEvent.click(evidence)

    expect(onOpenUsage).toHaveBeenCalledWith(expect.objectContaining({ profileId: 'profile:writing', start: '2026-07-01', end: '2026-07-13' }))
    expect(repo.updateRoutingPolicy).not.toHaveBeenCalled()
    expect(repo.discoverRoutingDestinations).not.toHaveBeenCalled()
  })

  it('detects Pi without enabling anything and requires explicit profile choices', async () => {
    const repo = repository()
    render(<ModelRoutingView policy={legacy} onPolicyChange={vi.fn()} operationalRepository={repo} />)

    expect(await screen.findByRole('heading', { name: 'Choose a tool' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
    await screen.findByText(/detected \/ supported/i)
    expect(repo.updateRoutingPolicy).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openrouter' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'cohere/north-mini-code:free' } })
    fireEvent.click(screen.getByLabelText('Enable this profile'))
    fireEvent.change(screen.getByLabelText('When the work matches'), { target: { value: 'auto-exact' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(repo.updateRoutingPolicy).toHaveBeenCalledTimes(1))
    const saved = vi.mocked(repo.updateRoutingPolicy!).mock.calls[0][0]
    expect(saved.profiles[0]).toMatchObject({ destinationAdapterId: 'pi-rpc', providerId: 'openrouter', modelId: 'cohere/north-mini-code:free', enabled: true, behavior: 'auto-exact', readiness: { state: 'unchecked' } })
    expect(screen.getByText(/Automatic delegation remains blocked/i)).toBeVisible()
  })

  it('keeps manual tools recommendation-only', async () => {
    const repo = repository()
    render(<ModelRoutingView policy={legacy} onPolicyChange={vi.fn()} operationalRepository={repo} />)
    await screen.findByRole('heading', { name: 'Choose a tool' })
    fireEvent.click(screen.getByRole('button', { name: 'Another tool (manual)' }))
    fireEvent.change(screen.getByLabelText('Provider or tool'), { target: { value: 'Claude Code' } })
    fireEvent.change(screen.getByLabelText('Model label'), { target: { value: 'Sonnet' } })
    expect(screen.getByLabelText('When the work matches')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Enable this profile'))
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(repo.updateRoutingPolicy).toHaveBeenCalledTimes(1))
    expect(vi.mocked(repo.updateRoutingPolicy!).mock.calls[0][0].profiles[0]).toMatchObject({ destinationAdapterId: 'manual', behavior: 'recommend', enabled: true })
  })

  it('does not treat a browser-only policy as a live operational policy', async () => {
    render(<ModelRoutingView policy={legacy} onPolicyChange={vi.fn()} />)
    expect(await screen.findByText(/Browser storage is not treated as proof that routing is live/i)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Check tools' })).not.toBeInTheDocument()
  })
})
