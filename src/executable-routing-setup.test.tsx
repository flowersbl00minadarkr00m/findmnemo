import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelRoutingView } from './components/ModelRoutingView'
import { createEmptyModelRoutingPolicy } from './lib/model-routing'
import type { OperationalRepository } from './lib/operational-repository'
import type { RoutingConnectionCatalogDto, RoutingConnectionSummaryDto } from '../shared/companion-contract'

describe('executable engine setup', () => {
  it('uses connection-scoped evidence and one assignment surface', async () => {
    const connection: RoutingConnectionSummaryDto = { id: 'codex:default', adapterId: 'codex-cli', displayName: 'Codex CLI', authMode: 'tool-owned', installedVersion: '0.142.2', supportedRange: '>=0.142.0 <0.145.0', authState: 'ready', enabled: true, readinessCheckedAt: '2026-07-14T18:00:00.000Z', catalogRefreshedAt: '2026-07-14T18:00:00.000Z' }
    const catalog: RoutingConnectionCatalogDto = { connectionId: 'codex:default', adapterId: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.142.2', source: 'tested-manifest', verification: 'manifest', checkedAt: '2026-07-14T18:00:00.000Z', expiresAt: '2099-07-14T18:15:00.000Z', models: [{ providerId: 'openai', modelId: 'gpt-5.4', displayName: 'GPT-5.4', reasoning: true, supportedEfforts: ['low', 'high'] }] }
    const repo: OperationalRepository = {
      listTickets: vi.fn(async () => []), createTicket: vi.fn(), updateTicketStatus: vi.fn(), addWorkNote: vi.fn(), deleteTicket: vi.fn(),
      listRoutingConnections: vi.fn(async () => [connection]),
      getRoutingConnectionCatalog: vi.fn(async () => catalog),
      getRoutingPolicyV3: vi.fn(async () => null), listProjectFolders: vi.fn(async () => []),
      discoverRoutingConnections: vi.fn(), refreshRoutingConnection: vi.fn(), setRoutingConnectionEnabled: vi.fn(), updateRoutingPolicyV3: vi.fn(), validateRoutingProfileV3: vi.fn(), startOpenRouterConnection: vi.fn(),
    }
    render(<ModelRoutingView policy={createEmptyModelRoutingPolicy()} onPolicyChange={vi.fn()} operationalRepository={repo} />)
    expect(await screen.findByRole('heading', { name: 'Connect the engines you already use' })).toBeVisible()
    expect(await screen.findByRole('option', { name: 'Codex CLI' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Coding' })).toHaveLength(1)
    expect(screen.queryByLabelText('Provider or tool')).not.toBeInTheDocument()
    expect(screen.getByText(/raw paths never enter the browser|empty local scratch folder/i)).toBeVisible()
  })
})
