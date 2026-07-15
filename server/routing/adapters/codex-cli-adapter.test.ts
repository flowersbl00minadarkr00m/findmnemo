import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { RoutingConnectionDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import type { ProcessRunRequest, ProcessRunResult, RoutingProcessRunner } from '../adapter-contract.js'
import { CodexCliAdapter, parseCodexFinalMessage } from './codex-cli-adapter.js'

class Runner implements RoutingProcessRunner {
  calls: ProcessRunRequest[] = []
  results: ProcessRunResult[]
  constructor(results: ProcessRunResult[]) { this.results = [...results] }
  async run(request: ProcessRunRequest) { this.calls.push(request); return this.results.shift() ?? { status: 'failed' as const } }
}
const connection: RoutingConnectionDto = { id: 'connection:codex', adapterId: 'codex-cli', displayName: 'Codex', enabled: true, authMode: 'tool-owned', authState: 'ready', installedVersion: '0.144.3', supportedRange: '0.x', readinessCheckedAt: null, catalogRefreshedAt: null, config: {}, secretRef: null }
const profile: RoutingProfileV3 = { id: 'route:codex', displayName: 'Codex', kind: 'executable', connectionId: connection.id, providerId: 'openai', modelId: 'gpt-5.4', effort: 'high', readiness: { state: 'ready', checkedAt: null, expiresAt: null, adapterVersion: '1', installedVersion: '0.144.3', reasonCode: null }, enabled: true }
const context = { connection, projectContext: { kind: 'scratch' as const, opaqueId: 'scratch:empty', localPath: 'C:\\safe-scratch' } }

describe('CodexCliAdapter', () => {
  it('checks version and tool-owned login without launching an interactive flow', async () => {
    const runner = new Runner([{ status: 'completed', exitCode: 0, stdout: 'codex-cli 0.144.3', stderr: '' }, { status: 'completed', exitCode: 0, stdout: 'Logged in', stderr: '' }])
    const adapter = new CodexCliAdapter(runner)
    expect(await adapter.detect(new AbortController().signal)).toMatchObject({ compatibility: 'supported', installedVersion: '0.144.3' })
    expect(await adapter.checkAuthentication!(context, new AbortController().signal)).toEqual({ state: 'ready', reasonCode: null })
    expect(runner.calls.map((call) => call.args)).toEqual([['--version'], ['login', 'status']])
  })

  it('passes exact model and effort, sends task only over stdin, and parses structured final output', async () => {
    const output = await readFile(new URL('../fixtures/codex-cli/execution.jsonl', import.meta.url), 'utf8')
    const runner = new Runner([{ status: 'completed', exitCode: 0, stdout: output, stderr: '' }])
    const adapter = new CodexCliAdapter(runner)
    const events = []
    for await (const event of adapter.executeConnectionProfile!(profile, 'private task body', context, new AbortController().signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'completed', text: 'Fixture result.' })
    expect(runner.calls[0]).toMatchObject({ cwd: 'C:\\safe-scratch', stdin: 'private task body', args: ['exec', '--model', 'gpt-5.4', '--sandbox', 'read-only', '--ephemeral', '--json', '-c', 'model_reasoning_effort=high', '-'] })
    expect(runner.calls[0].args.join(' ')).not.toContain('private task body')
    expect(runner.calls[0].args.join(' ')).not.toMatch(/dangerously|bypass/i)
  })

  it('fails closed for malformed output and rejects unsafe model identifiers', async () => {
    expect(parseCodexFinalMessage('{changed schema')).toBeNull()
    const adapter = new CodexCliAdapter(new Runner([]))
    const unsafe = { ...profile, modelId: 'model; remove' }
    await expect(async () => { for await (const _event of adapter.executeConnectionProfile!(unsafe, 'task', context, new AbortController().signal)) { /* consume */ } }).rejects.toThrow('CODEX_REQUEST_INVALID')
  })
})
