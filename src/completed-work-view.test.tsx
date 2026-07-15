import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompletedWorkPanel } from './components/CompletedWorkPanel'
import type { OperationalRepository } from './lib/operational-repository'

function repository(): OperationalRepository {
  return {
    queryCompletedWork: vi.fn(async (query) => ({ query: { ...query, limit: query.limit ?? 50, queryId: 'query-1' }, records: [{ id: 'ticket-1', title: 'Finished launch task', source: 'Codex', projectLabel: 'FindMnemo', completedAt: '2026-07-13T18:00:00.000Z', status: 'done' as const }], total: 1, unknownCompletionCount: 2, nextCursor: null, generatedAt: '2026-07-14T18:00:00.000Z' })),
    downloadCompletedWork: vi.fn(async () => undefined),
  } as unknown as OperationalRepository
}

describe('CompletedWorkPanel', () => {
  it('defaults to 30 days, discloses unknown dates, exports the same query, and reopens after success', async () => {
    const repo = repository(); const reopen = vi.fn(async () => undefined)
    render(<CompletedWorkPanel repository={repo} onOpenTicket={vi.fn()} onReopen={reopen} />)
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Finished launch task')).toBeVisible()
    expect(screen.getByText(/2 older completed ticket/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(repo.downloadCompletedWork).toHaveBeenCalledWith(expect.objectContaining({ timeZone: expect.any(String) }), 'csv'))
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(reopen).toHaveBeenCalledWith('ticket-1'))
    expect(screen.queryByText('Finished launch task')).not.toBeInTheDocument()
  })

  it('supports custom inclusive dates without horizontal-only controls', async () => {
    const repo = repository()
    render(<CompletedWorkPanel repository={repo} onOpenTicket={vi.fn()} onReopen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-07-14' } })
    await waitFor(() => expect(repo.queryCompletedWork).toHaveBeenLastCalledWith(expect.objectContaining({ startInclusive: expect.stringContaining('2026-07-01'), endExclusive: expect.stringContaining('2026-07-15') })))
  })
})
