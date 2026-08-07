import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { RoutingCompanionTransport } from './companion-transport.js'
import type { ManualActivityTransport } from './activity-transport.js'
import { MemorySecretStore } from '../auth/secret-store.js'
import { activityTokenReference } from '../agent-activity/integration-auth-service.js'
import { createMcpHandler, resolveMcpServerConstruction, runMcpProcess } from './findmnemo-mcp.js'

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
  it('runs the existing handler with injected platform secrets and protocol-pure STDIO until EOF', async () => {
    const store = new MemorySecretStore()
    const credentialCanary = 'MCP_CREDENTIAL_PRIVATE_CANARY'
    await store.set(activityTokenReference('surface:codex-cli'), credentialCanary)
    const activityReport = vi.fn().mockResolvedValue({
      outcome: 'applied',
      supportLevel: 'manual',
      evidenceKind: 'mcp-tool',
      modelLabel: null,
      receiptCodes: [],
    })
    const stdout: string[] = []
    const input = Readable.from([
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`,
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`,
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'report_active_work',
          arguments: { action: 'snapshot', assignmentId: 'safe-assignment', summary: 'Safe validation snapshot' },
        },
      })}\n`,
    ])

    await runMcpProcess({
      args: ['--origin=codex-mcp', '--surface=codex-cli'],
      input,
      writeStdout: (line) => { stdout.push(line) },
    }, {
      createSecretStore: vi.fn().mockResolvedValue({
        capability: {
          backend: 'windows-dpapi',
          state: 'available',
          code: 'CREDENTIAL_STORE_AVAILABLE',
          guidance: 'available',
        },
        store,
      }),
      createRoutingTransport: () => transport(),
      createActivityTransport: (token) => {
        expect(token).toBe(credentialCanary)
        return { report: activityReport }
      },
    })

    expect(stdout).toHaveLength(3)
    expect(stdout.every((line) => line.endsWith('\n'))).toBe(true)
    expect(stdout.map((line) => JSON.parse(line))).toMatchObject([
      { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, result: { tools: expect.any(Array) } },
      { jsonrpc: '2.0', id: 3, result: { structuredContent: { outcome: 'applied', executionSurface: 'codex-cli' } } },
    ])
    expect(activityReport).toHaveBeenCalledTimes(1)
    expect(stdout.join('')).not.toContain(credentialCanary)
  })

  it('maps injected startup failures to one allowlisted safe code without STDIO leakage', async () => {
    const stdout: string[] = []
    await expect(runMcpProcess({
      args: ['--origin=codex-mcp', '--surface=codex-cli'],
      input: Readable.from([]),
      writeStdout: (line) => { stdout.push(line) },
    }, {
      createSecretStore: vi.fn().mockRejectedValue(new Error('private path and credential detail')),
    })).rejects.toThrow('MCP_STARTUP_FAILED')
    expect(stdout).toEqual([])
  })

  it('resolves the actual process launch binding precisely while preserving no-surface legacy compatibility', () => {
    expect(resolveMcpServerConstruction([])).toEqual({
      originAdapterId: 'codex-mcp',
      agent: 'codex-cli',
      integrationId: 'manual:codex-cli',
    })
    expect(resolveMcpServerConstruction(['--origin=claude-code-mcp'])).toEqual({
      originAdapterId: 'claude-code-mcp',
      agent: 'claude-code',
      integrationId: 'manual:claude-code',
    })
    expect(resolveMcpServerConstruction(['--origin=codex-mcp', '--surface=codex-desktop'])).toEqual({
      originAdapterId: 'codex-mcp',
      agent: 'codex-cli',
      integrationId: 'surface:codex-desktop',
      activityBinding: {
        integrationId: 'surface:codex-desktop',
        agentFamily: 'codex',
        executionSurface: 'codex-desktop',
      },
    })
    expect(resolveMcpServerConstruction(['--origin=codex-mcp', '--surface=codex-cli'])).toEqual({
      originAdapterId: 'codex-mcp',
      agent: 'codex-cli',
      integrationId: 'surface:codex-cli',
      activityBinding: {
        integrationId: 'surface:codex-cli',
        agentFamily: 'codex',
        executionSurface: 'codex-cli',
      },
    })
    expect(resolveMcpServerConstruction(['--surface=claude-desktop-code', '--origin=claude-code-mcp'])).toEqual({
      originAdapterId: 'claude-code-mcp',
      agent: 'claude-code',
      integrationId: 'surface:claude-desktop-code',
      activityBinding: {
        integrationId: 'surface:claude-desktop-code',
        agentFamily: 'claude',
        executionSurface: 'claude-desktop-code',
      },
    })
  })

  it.each([
    [['--surface=codex-desktop'], 'ACTIVITY_SURFACE_ORIGIN_REQUIRED'],
    [['--origin=codex-mcp', '--surface=claude-desktop-code'], 'ACTIVITY_SURFACE_ORIGIN_MISMATCH'],
    [['--origin=claude-code-mcp', '--surface=codex-cli'], 'ACTIVITY_SURFACE_ORIGIN_MISMATCH'],
    [['--origin=codex-mcp', '--surface=pi-cli'], 'ACTIVITY_SURFACE_ORIGIN_MISMATCH'],
    [['--origin=unknown', '--surface=codex-cli'], 'ACTIVITY_ORIGIN_INVALID'],
    [['--origin=codex-mcp', '--surface=unknown'], 'ACTIVITY_SURFACE_INVALID'],
    [['--origin=codex-mcp', '--origin=codex-mcp'], 'ACTIVITY_ORIGIN_INVALID'],
    [['--origin=codex-mcp', '--surface=codex-cli', '--surface=codex-cli'], 'ACTIVITY_SURFACE_INVALID'],
  ] as const)('rejects invalid fixed launch binding %j', (args, code) => {
    expect(() => resolveMcpServerConstruction(args)).toThrow(code)
  })

  it('advertises stable tools and honest same-call instructions', async () => {
    const handle = createMcpHandler(transport())
    const initialized = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(initialized).toMatchObject({ result: { serverInfo: { name: 'findmnemo-routing' }, capabilities: { tools: {} } } })
    expect(JSON.stringify(initialized)).toMatch(/same tool call/i)
    expect(JSON.stringify(initialized)).toMatch(/plain-language capability label/i)
    const tools = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    if (!tools) throw new Error('tools/list response missing')
    expect((tools.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([
      'recommend_route', 'dispatch_work', 'get_dispatch', 'cancel_dispatch', 'report_active_work', 'start_active_work', 'update_active_work', 'wait_active_work',
      'block_active_work', 'request_action_active_work', 'complete_active_work', 'fail_active_work', 'cancel_active_work', 'snapshot_active_work',
    ])
    const definitions = (tools.result as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }).tools
    expect(definitions.slice(0, 6).map((tool) => tool.name)).toEqual([
      'recommend_route', 'dispatch_work', 'get_dispatch', 'cancel_dispatch', 'report_active_work', 'start_active_work',
    ])
    expect(definitions[4]).toMatchObject({
      name: 'report_active_work',
      inputSchema: {
        required: ['action', 'assignmentId', 'summary'],
        additionalProperties: false,
        properties: {
          action: { enum: ['start', 'update', 'wait', 'block', 'needs-action', 'complete', 'fail', 'cancel', 'snapshot'] },
          modelLabel: { type: 'string' },
        },
      },
    })
    expect(definitions.slice(5).every((tool) => /release trains N and N\+1/i.test(tool.description))).toBe(true)
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

  it('binds precise activity attribution at handler construction and rejects caller-selected or private fields', async () => {
    const activity: ManualActivityTransport = { report: vi.fn().mockResolvedValue({ outcome: 'applied', supportLevel: 'manual', evidenceKind: 'mcp-tool' }) }
    const handle = createMcpHandler(transport(), 'claude-code-mcp', activity, {
      integrationId: 'surface:claude-desktop-code',
      agentFamily: 'claude',
      executionSurface: 'claude-desktop-code',
    })
    const response = await handle({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'report_active_work',
        arguments: {
          action: 'start',
          assignmentId: 'desktop-work-1',
          summary: 'Safe explicit desktop work',
          modelLabel: 'anthropic/claude-sonnet-4',
        },
      },
    })
    expect(response).toMatchObject({ result: { structuredContent: { outcome: 'applied' } } })
    expect(activity.report).toHaveBeenCalledWith({
      integrationId: 'surface:claude-desktop-code',
      agent: 'claude-code',
      agentFamily: 'claude',
      executionSurface: 'claude-desktop-code',
      action: 'start',
      assignmentId: 'desktop-work-1',
      generation: 1,
      summary: 'Safe explicit desktop work',
      projectRef: { kind: 'unassigned' },
      modelLabel: 'anthropic/claude-sonnet-4',
      evidenceKind: 'mcp-tool',
    })

    for (const forbidden of [
      { executionSurface: 'claude-code-cli' },
      { prompt: 'private prompt' },
      { unknown: true },
    ]) {
      const rejected = await handle({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'report_active_work', arguments: { action: 'update', assignmentId: 'desktop-work-1', summary: 'Safe update', ...forbidden } },
      })
      expect(rejected).toMatchObject({ error: { message: 'active-work arguments are invalid' } })
    }
    expect(activity.report).toHaveBeenCalledTimes(1)
  })

  it('routes the consolidated action and every N/N+1 legacy alias through one reporting path', async () => {
    const report = vi.fn().mockResolvedValue({ outcome: 'applied', supportLevel: 'manual', evidenceKind: 'mcp-tool' })
    const handle = createMcpHandler(transport(), 'codex-mcp', { report })
    const tools = [
      ['report_active_work', 'start'],
      ['start_active_work', 'start'],
      ['update_active_work', 'update'],
      ['wait_active_work', 'wait'],
      ['block_active_work', 'block'],
      ['request_action_active_work', 'needs-action'],
      ['complete_active_work', 'complete'],
      ['fail_active_work', 'fail'],
      ['cancel_active_work', 'cancel'],
      ['snapshot_active_work', 'snapshot'],
    ] as const
    for (const [name, action] of tools) {
      const args = name === 'report_active_work'
        ? { action, assignmentId: `work-${action}`, summary: 'Safe lifecycle report' }
        : { assignmentId: `work-${action}`, summary: 'Safe lifecycle report' }
      await handle({ jsonrpc: '2.0', id: action, method: 'tools/call', params: { name, arguments: args } })
    }
    expect(report.mock.calls.map(([input]) => input.action)).toEqual(tools.map(([, action]) => action))
  })
})
