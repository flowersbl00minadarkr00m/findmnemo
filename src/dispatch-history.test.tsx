import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RoutingDispatchReceiptDto } from '../shared/companion-contract'
import { DispatchHistory } from './components/routing/DispatchHistory'
import type { OperationalRepository } from './lib/operational-repository'

function receipt(overrides: Partial<RoutingDispatchReceiptDto> = {}): RoutingDispatchReceiptDto {
  return {
    id: 'receipt-1', idempotencyKey: 'key-1', generation: 1, priorReceiptId: null,
    origin: { adapterId: 'codex-mcp', correlationId: 'turn-1', conversationRefHash: 'hash' },
    capabilityIds: ['creation.writing'], classificationSource: 'explicit', policyVersion: 4,
    requestedProfileSnapshot: { profileId: 'writer', destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default', providerId: 'openrouter', modelId: 'writer-model', effort: 'high', behavior: 'auto-exact' },
    actualRoute: { destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default', providerId: 'openrouter', modelId: 'writer-model', effort: 'high' },
    state: 'completed', returnState: 'delivered', createdAt: '2026-07-12T20:00:00.000Z', acceptedAt: '2026-07-12T20:00:00.000Z', startedAt: '2026-07-12T20:00:01.000Z', finishedAt: '2026-07-12T20:00:02.000Z', failureCode: null, requestHash: 'request-hash', resultHash: 'result-hash',
    ...overrides,
  }
}

function repo(receipts: RoutingDispatchReceiptDto[]): OperationalRepository {
  return {
    listTickets: vi.fn(async () => []), createTicket: vi.fn(), updateTicketStatus: vi.fn(), addWorkNote: vi.fn(), deleteTicket: vi.fn(),
    listRoutingDispatchReceipts: vi.fn(async () => receipts),
    cancelRoutingDispatch: vi.fn(async (id) => receipt({ id, state: 'cancelled', returnState: 'return-unavailable' })),
    retryRoutingDispatch: vi.fn(async (id) => receipt({ id: 'receipt-2', generation: 2, priorReceiptId: id, state: 'running', returnState: 'pending' })),
  }
}

describe('DispatchHistory', () => {
  it('separates requested and actual route, labels mismatch and never renders content canaries', async () => {
    const unsafe = { ...receipt({ actualRoute: { destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default', providerId: 'openrouter', modelId: 'different-model', effort: 'low' }, returnState: 'return-unavailable' }), task: 'PROMPT_CANARY_PRIVATE', result: 'RESULT_CANARY_PRIVATE', credential: 'SECRET_CANARY_PRIVATE' } as RoutingDispatchReceiptDto
    render(<DispatchHistory operationalRepository={repo([unsafe])} />)
    expect(await screen.findByText('openrouter / writer-model / high')).toBeVisible()
    expect(screen.getByText(/openrouter \/ different-model \/ low — mismatch/)).toBeVisible()
    expect(screen.getByText(/originating chat could not receive it/i)).toBeVisible()
    expect(document.body.textContent).not.toContain('PROMPT_CANARY_PRIVATE')
    expect(document.body.textContent).not.toContain('RESULT_CANARY_PRIVATE')
    expect(document.body.textContent).not.toContain('SECRET_CANARY_PRIVATE')
  })

  it('offers cancellation only for active states and retry only for failed terminal states', async () => {
    const repository = repo([receipt({ id: 'running', state: 'running', returnState: 'pending', actualRoute: null }), receipt({ id: 'failed', state: 'failed', returnState: 'return-unavailable', failureCode: 'DESTINATION_TIMEOUT' })])
    render(<DispatchHistory operationalRepository={repository} />)
    expect((await screen.findAllByRole('button', { name: 'Cancel dispatch' })).length).toBe(1)
    expect(screen.getAllByRole('button', { name: 'Retry as new generation' }).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel dispatch' }))
    await waitFor(() => expect(repository.cancelRoutingDispatch).toHaveBeenCalledWith('running'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry as new generation' }))
    await waitFor(() => expect(repository.retryRoutingDispatch).toHaveBeenCalledWith('failed', expect.any(String)))
  })
})
