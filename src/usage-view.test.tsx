import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedUsageRecordDto, UsageCapabilityDto, UsageSummaryDto } from '../shared/companion-contract'
import { UsageView } from './components/UsageView'
import type { OperationalRepository } from './lib/operational-repository'

const metric = (value: number | null, state: 'complete' | 'partial' | 'unknown' = value === null ? 'unknown' : 'complete') => ({ value, knownRecordCount: value === null ? 0 : 1, unknownRecordCount: state === 'complete' ? 0 : 1, state })
const capability = (state: UsageCapabilityDto['state'] = 'installed-supported'): UsageCapabilityDto => ({ schema: 'findmnemo.usage-capability.v1', state, executableLabel: 'tokscale', collectorSource: state === 'installed-supported' ? 'embedded' : 'unavailable', installedVersion: state === 'not-installed' ? null : '4.5.2', supportedRange: '>=4.4.1 <4.6.0', adapterId: state === 'installed-supported' ? 'tokscale-v4.4-v4.5' : null, checkedAt: '2026-07-13T12:00:00.000Z', lastSuccessfulRefreshAt: null, sources: [], reasonCode: state === 'not-installed' ? 'TOKSCALE_EMBEDDED_MISSING' : null, guidance: { summary: 'The built-in collector is missing or damaged. Repair or reinstall FindMnemo.', installationUrl: 'https://github.com/flowersbl00minadarkr00m/findmnemo#model-usage', automaticInstall: false } })
const summary: UsageSummaryDto = {
  schema: 'findmnemo.usage-summary.v1', filters: { start: null, end: null, clientId: null, providerId: null, modelId: null, profileId: null, mappingState: null }, recordCount: 1,
  totalTokens: metric(0), inputTokens: metric(0), outputTokens: metric(0), cacheReadTokens: metric(0), cacheWriteTokens: metric(0), reasoningTokens: metric(null), cost: metric(1.25, 'partial'), currencies: [],
  trends: { day: [], week: [], month: [] }, breakdowns: { clients: [], providers: [], models: [] }, coverage: { schema: 'findmnemo.usage-coverage.v1', tokscaleVersion: '4.5.2', adapterId: 'tokscale-v4.4-v4.5', refreshedAt: '2026-07-13T12:00:00.000Z', sources: [], complete: false, warnings: ['partial'] },
  freshness: { state: 'current', lastSuccessfulRefreshAt: '2026-07-13T12:00:00.000Z', upstreamGeneratedAt: null }, duplicateConflictCount: 0, warnings: ['partial'],
}

function repository(state: UsageCapabilityDto['state'] = 'installed-supported'): OperationalRepository {
  return {
    listTickets: async () => [], createTicket: async () => { throw new Error('unused') }, updateTicketStatus: async (ticket) => ticket, addWorkNote: async (ticket) => ticket, deleteTicket: async () => undefined,
    getUsageCapability: vi.fn(async () => capability(state)), getUsageSummary: vi.fn(async () => summary), getUsageRecords: vi.fn(async () => ({ schema: 'findmnemo.usage-records.v1' as const, records: [] as NormalizedUsageRecordDto[], nextCursor: null, totalCount: 0 })), listUsageMappings: vi.fn(async () => []), getRoutingPolicy: vi.fn(async () => null),
    startUsageRefresh: vi.fn(async (input: { since: string; until: string }) => ({ schema: 'findmnemo.usage-refresh.v1' as const, id: 'run-1', state: 'complete' as const, stage: 'finished' as const, requestedAt: '2026-07-13T12:00:00.000Z', finishedAt: '2026-07-13T12:00:01.000Z', coverageStart: input.since, coverageEnd: input.until, commands: [], canonicalCount: 1, attributionCount: 0, warningCodes: [], errorCode: null, lastSuccessfulRefreshAt: '2026-07-13T12:00:01.000Z', retainedPreviousSuccess: false })),
    getUsageRefresh: vi.fn(), cancelUsageRefresh: vi.fn(),
  }
}

describe('operational model usage view', () => {
  it('distinguishes reported zero, unknown, estimated cost, and incomplete coverage', async () => {
    const repo = repository()
    render(<UsageView repository={repo} />)
    expect(await screen.findByRole('heading', { name: 'See what you actually use' })).toBeVisible()
    expect(screen.getAllByText('0 reported').length).toBeGreaterThan(0)
    expect(screen.getByText(/Unknown/)).toBeVisible()
    expect(screen.getByText(/estimated \(incomplete\)/i)).toBeVisible()
    expect(screen.getByText(/Incomplete coverage/i)).toBeVisible()
    expect(screen.getByText(/not provider billing or subscription quota/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
    await waitFor(() => expect(repo.startUsageRefresh).toHaveBeenCalledOnce())
  })

  it('shows built-in repair guidance and disables refresh when the collector is unavailable', async () => {
    render(<UsageView repository={repository('not-installed')} />)
    expect(await screen.findByText('Built-in collector unavailable.')).toBeVisible()
    expect(screen.getByText(/separate global Tokscale installation is not required/i)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open FindMnemo troubleshooting' })).toHaveAttribute('href', 'https://github.com/flowersbl00minadarkr00m/findmnemo#model-usage')
    expect(screen.getByRole('button', { name: 'Refresh usage' })).toBeDisabled()
  })
})
