import { describe, expect, it, vi } from 'vitest'
import type { RoutingCompanionTransport } from './companion-transport.js'
import { createMcpHandler } from './findmnemo-mcp.js'

function sharedTransport(): RoutingCompanionTransport {
  return {
    recommend: vi.fn().mockResolvedValue({ disposition: 'auto-dispatch-eligible', reasonCode: 'ELIGIBLE', policyVersion: 7, profile: { profileId: 'route:writer' } }),
    dispatch: vi.fn().mockResolvedValue({ disposition: 'completed', output: 'same-call Claude result', receipt: { id: 'receipt-claude', requestedProfileSnapshot: { profileId: 'route:writer' }, actualRoute: { modelId: 'writer' } } }),
    getDispatch: vi.fn(), cancelDispatch: vi.fn(), acknowledgeDelivery: vi.fn().mockResolvedValue({ returnState: 'delivered' }),
  } as unknown as RoutingCompanionTransport
}

describe('Claude Code compatible MCP origin', () => {
  it('uses the same tools and policy while attributing the Claude Code origin', async () => {
    const transport = sharedTransport(); const claude = createMcpHandler(transport, 'claude-code-mcp'); const codex = createMcpHandler(transport, 'codex-mcp')
    const args = { capabilityIds: ['writing'], task: 'Write this', correlationId: 'claude-turn' }
    const result = await claude({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'dispatch_work', arguments: args } })
    expect(JSON.stringify(result)).toContain('same-call Claude result')
    expect(transport.dispatch).toHaveBeenCalledWith(expect.objectContaining({ origin: expect.objectContaining({ adapterId: 'claude-code-mcp', correlationId: 'claude-turn' }) }))
    await claude({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'recommend_route', arguments: { capabilityIds: ['writing'] } } })
    await codex({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'recommend_route', arguments: { capabilityIds: ['writing'] } } })
    expect(transport.recommend).toHaveBeenNthCalledWith(1, expect.objectContaining({ capabilityIds: ['writing'] }))
    expect(transport.recommend).toHaveBeenNthCalledWith(2, expect.objectContaining({ capabilityIds: ['writing'] }))
  })

  it('returns permission/transport failures as tool-call errors without silent retry', async () => {
    const transport = sharedTransport(); vi.mocked(transport.dispatch).mockRejectedValueOnce(new Error('ROUTING_INTEGRATION_UNAUTHORIZED'))
    const response = await createMcpHandler(transport, 'claude-code-mcp')({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dispatch_work', arguments: { capabilityIds: ['writing'], task: 'Never retried' } } })
    expect(response).toMatchObject({ error: { message: 'ROUTING_INTEGRATION_UNAUTHORIZED' } })
    expect(transport.dispatch).toHaveBeenCalledTimes(1)
  })
})
