import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { RoutingConnectionDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import type { ProcessRunRequest, ProcessRunResult, RoutingProcessRunner } from '../adapter-contract.js'
import { ClaudeCodeCliAdapter, parseClaudeResult } from './claude-code-cli-adapter.js'

class Runner implements RoutingProcessRunner { calls: ProcessRunRequest[] = []; results: ProcessRunResult[]; constructor(results: ProcessRunResult[]) { this.results = [...results] } async run(request: ProcessRunRequest) { this.calls.push(request); return this.results.shift() ?? { status: 'failed' as const } } }
const connection: RoutingConnectionDto = { id: 'connection:claude', adapterId: 'claude-code-cli', displayName: 'Claude', enabled: true, authMode: 'tool-owned', authState: 'ready', installedVersion: '2.1.207', supportedRange: '2.x', readinessCheckedAt: null, catalogRefreshedAt: null, config: {}, secretRef: null }
const profile: RoutingProfileV3 = { id: 'route:claude', displayName: 'Claude', kind: 'executable', connectionId: connection.id, providerId: 'anthropic', modelId: 'sonnet', effort: 'high', readiness: { state: 'ready', checkedAt: null, expiresAt: null, adapterVersion: '1', installedVersion: '2.1.207', reasonCode: null }, enabled: true }
const context = { connection, projectContext: { kind: 'scratch' as const, opaqueId: 'scratch:empty', localPath: 'C:\\safe-scratch' } }

describe('ClaudeCodeCliAdapter', () => {
  it('uses machine-readable auth and fails closed on schema drift', async () => {
    const ready = new ClaudeCodeCliAdapter(new Runner([{ status: 'completed', exitCode: 0, stdout: '{"loggedIn":true}', stderr: '' }]))
    expect(await ready.checkAuthentication!(context, new AbortController().signal)).toEqual({ state: 'ready', reasonCode: null })
    const changed = new ClaudeCodeCliAdapter(new Runner([{ status: 'completed', exitCode: 0, stdout: 'changed', stderr: '' }]))
    expect(await changed.checkAuthentication!(context, new AbortController().signal)).toEqual({ state: 'unsupported', reasonCode: 'CLAUDE_AUTH_SCHEMA_CHANGED' })
  })
  it('uses exact model/effort, safe tools, stdin task, and structured result', async () => {
    const output = await readFile(new URL('../fixtures/claude-code/result.json', import.meta.url), 'utf8')
    const runner = new Runner([{ status: 'completed', exitCode: 0, stdout: output, stderr: '' }])
    const adapter = new ClaudeCodeCliAdapter(runner)
    const events = []
    for await (const event of adapter.executeConnectionProfile!(profile, 'private task', context, new AbortController().signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'completed', text: 'Fixture result.', actualRoute: { modelId: 'claude-sonnet-4-6' } })
    expect(runner.calls[0]).toMatchObject({ stdin: 'private task', args: ['--print', '--input-format', 'text', '--output-format', 'json', '--no-session-persistence', '--model', 'sonnet', '--permission-mode', 'dontAsk', '--allowedTools', 'Read,Grep,Glob', '--effort', 'high'] })
    expect(runner.calls[0].args.join(' ')).not.toMatch(/dangerously|bypassPermissions|private task/i)
  })
  it('rejects malformed output and unsafe exact model IDs', async () => {
    expect(parseClaudeResult('{changed')).toBeNull()
    const adapter = new ClaudeCodeCliAdapter(new Runner([]))
    await expect(async () => { for await (const _event of adapter.executeConnectionProfile!({ ...profile, modelId: 'bad & id' }, 'task', context, new AbortController().signal)) { /* consume */ } }).rejects.toThrow('CLAUDE_REQUEST_INVALID')
  })
})
