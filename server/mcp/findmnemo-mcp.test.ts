import { describe, expect, it, vi } from 'vitest'
import type { RoutingCompanionTransport } from './companion-transport.js'
import { createMcpHandler } from './findmnemo-mcp.js'

function transport(): RoutingCompanionTransport {
  return {
    recommend: vi.fn().mockResolvedValue({ disposition: 'auto-dispatch-eligible', reasonCode: 'ELIGIBLE', policyVersion: 3, profile: { profileId: 'route:writer' } }),
    dispatch: vi.fn().mockResolvedValue({ disposition: 'completed', output: 'Pi result', receipt: { id: 'receipt-1', requestedProfileSnapshot: { profileId: 'route:writer' }, actualRoute: { modelId: 'writer' } } }),
    getDispatch: vi.fn().mockResolvedValue({ id: 'receipt-1', state: 'completed' }),
    cancelDispatch: vi.fn().mockResolvedValue({ id: 'receipt-1', state: 'cancelled' }),
    acknowledgeDelivery: vi.fn().mockResolvedValue({ id: 'receipt-1', returnState: 'delivered' }),
  } as unknown as RoutingCompanionTransport
}

describe('FindMnemo MCP origin', () => {
  it('advertises stable tools and honest same-call instructions', async () => {
    const handle = createMcpHandler(transport())
    const initialized = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(initialized).toMatchObject({ result: { serverInfo: { name: 'findmnemo-routing' }, capabilities: { tools: {} } } })
    expect(JSON.stringify(initialized)).toMatch(/same tool call/i)
    expect(JSON.stringify(initialized)).toMatch(/plain-language capability label/i)
    const tools = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    if (!tools) throw new Error('tools/list response missing')
    expect((tools.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(['recommend_route', 'dispatch_work', 'get_dispatch', 'cancel_dispatch'])
  })

  it('returns fake destination output and attribution through the originating call before acknowledging delivery', async () => {
    const fake = transport(); const handle = createMcpHandler(fake)
    const response = await handle({ jsonrpc: '2.0', id: 'call-1', method: 'tools/call', params: { name: 'dispatch_work', arguments: { capabilityIds: ['writing'], task: 'Private task', correlationId: 'origin-turn' } } })
    if (!response) throw new Error('tools/call response missing')
    const text = ((response.result as { content: Array<{ text: string }> }).content[0].text)
    expect(JSON.parse(text)).toMatchObject({ disposition: 'completed', output: 'Pi result', attribution: { receiptId: 'receipt-1', requested: { profileId: 'route:writer' }, actual: { modelId: 'writer' } } })
    expect(fake.dispatch).toHaveBeenCalledWith(expect.objectContaining({ origin: expect.objectContaining({ adapterId: 'codex-mcp', correlationId: 'origin-turn' }), task: 'Private task' }))
    expect(fake.acknowledgeDelivery).toHaveBeenCalledWith('receipt-1')
  })

  it('applies self/include/exclude overrides and distinct recommendation outcomes without dispatch', async () => {
    const fake = transport(); const handle = createMcpHandler(fake)
    await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'recommend_route', arguments: { capabilityIds: ['writing'], self: true } } })
    expect(fake.recommend).toHaveBeenCalledWith(expect.objectContaining({ override: { mode: 'self' } }))
    expect(fake.dispatch).not.toHaveBeenCalled()
  })
})
