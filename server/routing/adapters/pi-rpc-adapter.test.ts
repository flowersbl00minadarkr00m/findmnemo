import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ProcessRunRequest, ProcessRunResult, RoutingProcessRunner } from '../adapter-contract.js'
import type { PiRpcResponse, PiRpcSession, PiRpcSessionFactory } from '../pi-rpc-client.js'
import { PiRoutingAdapter } from './pi-rpc-adapter.js'

const NOW = () => new Date('2026-07-12T21:30:00.000Z')

class Runner implements RoutingProcessRunner {
  async run(_request: ProcessRunRequest): Promise<ProcessRunResult> { return { status: 'completed', exitCode: 0, stdout: '0.80.3', stderr: '' } }
}

class SessionFactory implements PiRpcSessionFactory {
  private readonly response: PiRpcResponse | Error
  constructor(response: PiRpcResponse | Error) { this.response = response }
  async open(_signal: AbortSignal): Promise<PiRpcSession> {
    const response = this.response
    return { request: async () => { if (response instanceof Error) throw response; return response }, onEvent: () => () => undefined, close: async () => undefined }
  }
}

function profile(modelId = 'anthropic/claude-sonnet-4', effort: string | null = 'high') {
  return { id: 'route:writer', displayName: 'Writer', destinationAdapterId: 'pi-rpc', destinationInstanceId: 'pi:default', providerId: 'openrouter', modelId, effort, capabilityIds: ['writing'], enabled: true, behavior: 'auto-exact' as const, fallbackOrder: 0, readiness: { state: 'unchecked' as const, checkedAt: null, expiresAt: null, adapterVersion: null, installedVersion: null, reasonCode: null } }
}

async function fixtureResponse(): Promise<PiRpcResponse> {
  const content = await readFile(new URL('../fixtures/pi-rpc-catalog.jsonl', import.meta.url), 'utf8')
  return JSON.parse(content.split('\n')[0]) as PiRpcResponse
}

describe('Pi RPC catalog and readiness', () => {
  it('normalizes a sanitized catalog and exposes only supported effort values', async () => {
    const adapter = new PiRoutingAdapter(new Runner(), new SessionFactory(await fixtureResponse()), NOW)
    const catalog = await adapter.listModels(new AbortController().signal)
    expect(catalog).toMatchObject({ adapterId: 'pi-rpc', adapterVersion: '1.0.0', installedVersion: '0.80.3' })
    expect(catalog.models).toEqual([
      { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4', displayName: 'Anthropic: Claude Sonnet 4', reasoning: true, supportedEfforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
      { providerId: 'ollama', modelId: 'qwen3:8b', displayName: 'Qwen3 8B Local via Ollama', reasoning: false, supportedEfforts: ['off'] },
    ])
    expect(JSON.stringify(catalog)).not.toMatch(/baseUrl|cost|apiKey|token|credential|session/i)
  })

  it('validates an exact provider/model/effort without sending user work', async () => {
    const adapter = new PiRoutingAdapter(new Runner(), new SessionFactory(await fixtureResponse()), NOW)
    await expect(adapter.validate(profile(), new AbortController().signal)).resolves.toMatchObject({ state: 'ready', reasonCode: null, installedVersion: '0.80.3' })
    await expect(adapter.validate(profile('missing'), new AbortController().signal)).resolves.toMatchObject({ state: 'unavailable', reasonCode: 'MODEL_NOT_FOUND' })
    await expect(adapter.validate(profile(undefined, 'impossible'), new AbortController().signal)).resolves.toMatchObject({ state: 'unsupported', reasonCode: 'EFFORT_UNSUPPORTED' })
  })

  it('fails closed for changed protocol and authentication-empty catalogs', async () => {
    const malformed = new PiRoutingAdapter(new Runner(), new SessionFactory({ type: 'response', command: 'get_available_models', success: true, data: { changed: [] } }), NOW)
    await expect(malformed.validate(profile(), new AbortController().signal)).resolves.toMatchObject({ state: 'unsupported', reasonCode: 'PI_RPC_PROTOCOL_CHANGED' })
    const empty = new PiRoutingAdapter(new Runner(), new SessionFactory({ type: 'response', command: 'get_available_models', success: true, data: { models: [] } }), NOW)
    await expect(empty.validate(profile(), new AbortController().signal)).resolves.toMatchObject({ state: 'auth-required', reasonCode: 'PI_AUTH_REQUIRED' })
  })

  it('selects and reads back the exact route before returning one assistant result', async () => {
    const listeners = new Set<(event: PiRpcResponse) => void>()
    const session: PiRpcSession = {
      request: async (command) => {
        if (command.type === 'set_model' || command.type === 'set_thinking_level' || command.type === 'prompt') {
          if (command.type === 'prompt') queueMicrotask(() => { for (const listener of listeners) listener({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Finished writing' }] }] } as never) })
          return { type: 'response', success: true }
        }
        return { type: 'response', success: true, data: { model: { provider: 'openrouter', id: 'anthropic/claude-sonnet-4' }, thinkingLevel: 'high' } }
      },
      onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
      close: async () => undefined,
    }
    const factory: PiRpcSessionFactory = { open: async () => session }
    const adapter = new PiRoutingAdapter(new Runner(), factory, NOW)
    const events = []
    for await (const event of adapter.execute(profile(), 'Private prompt', new AbortController().signal)) events.push(event)
    expect(events).toEqual([
      expect.objectContaining({ type: 'started', actualRoute: expect.objectContaining({ providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4', effort: 'high' }) }),
      expect.objectContaining({ type: 'completed', text: 'Finished writing' }),
    ])
  })

  it('fails on actual-route mismatch before submitting a prompt', async () => {
    let promptCalls = 0
    const session: PiRpcSession = {
      request: async (command) => {
        if (command.type === 'prompt') promptCalls += 1
        return command.type === 'get_state'
          ? { type: 'response', success: true, data: { model: { provider: 'openrouter', id: 'different-model' }, thinkingLevel: 'high' } }
          : { type: 'response', success: true }
      }, onEvent: () => () => undefined, close: async () => undefined,
    }
    const adapter = new PiRoutingAdapter(new Runner(), { open: async () => session }, NOW)
    const consume = async () => { for await (const _event of adapter.execute(profile(), 'Never sent', new AbortController().signal)) { /* inspect route */ } }
    await expect(consume()).rejects.toThrow('ACTUAL_ROUTE_MISMATCH')
    expect(promptCalls).toBe(0)
  })
})
