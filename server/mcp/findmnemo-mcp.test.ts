import { describe, expect, it, vi } from 'vitest'
import type { RoutingCompanionTransport } from './companion-transport.js'
import type { ManualActivityTransport } from './activity-transport.js'
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
    expect((tools.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([
      'recommend_route', 'dispatch_work', 'get_dispatch', 'cancel_dispatch', 'start_active_work', 'update_active_work', 'wait_active_work',
      'block_active_work', 'request_action_active_work', 'complete_active_work', 'fail_active_work', 'cancel_active_work', 'snapshot_active_work',
    ])
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

  it('rejects inherited child dispatch before calling the companion', async () => {
    const fake = transport(); const handle = createMcpHandler(fake)
    const prior = process.env.FINDMNEMO_CHILD_DISPATCH
    process.env.FINDMNEMO_CHILD_DISPATCH = '1'
    try {
      const response = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'dispatch_work', arguments: { capabilityIds: ['writing'], task: 'Do not recurse' } } })
      expect(response).toMatchObject({ error: { message: 'recursive-dispatch-blocked' } })
      expect(fake.dispatch).not.toHaveBeenCalled()
    } finally {
      if (prior === undefined) delete process.env.FINDMNEMO_CHILD_DISPATCH
      else process.env.FINDMNEMO_CHILD_DISPATCH = prior
    }
  })

  it('advertises explicit manual lifecycle tools and sends only safe inferred-agent metadata', async () => {
    const activity: ManualActivityTransport = { report: vi.fn().mockResolvedValue({ outcome: 'applied', supportLevel: 'manual', evidenceKind: 'mcp-tool' }) }
    const handle = createMcpHandler(transport(), 'codex-mcp', activity)
    const listed = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} })
    expect(JSON.stringify(listed)).toContain('start_active_work')
    expect(JSON.stringify(listed)).toContain('snapshot_active_work')
    const response = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'complete_active_work', arguments: { assignmentId: 'work-1', summary: 'Safe explicit work', projectId: 'project-safe' } } })
    expect(response).toMatchObject({ result: { structuredContent: { outcome: 'applied', supportLevel: 'manual' } } })
    expect(activity.report).toHaveBeenCalledWith({ integrationId: 'manual:codex-cli', agent: 'codex-cli', action: 'complete', assignmentId: 'work-1', generation: 1, summary: 'Safe explicit work', projectRef: { kind: 'approved-project', id: 'project-safe' }, evidenceKind: 'mcp-tool' })
    expect(JSON.stringify(vi.mocked(activity.report).mock.calls)).not.toMatch(/cwd|path|prompt|response|transcript|reasoning/i)
  })
})
