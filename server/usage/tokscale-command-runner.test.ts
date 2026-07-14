import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { BoundedProcessRequest, BoundedProcessResult, BoundedProcessRunner } from '../process/bounded-process-runner.js'
import { minimizedTokscaleEnvironment, TokscaleCommandRunner } from './tokscale-command-runner.js'
import type { TokscaleInvocation } from './tokscale-executable.js'

const NOW = () => new Date('2026-07-13T12:00:00.000Z')
const TEST_INVOCATION: TokscaleInvocation = { ok: true, source: 'external-recovery', variant: 'external', executable: 'C:\\tools\\tokscale.exe', prefixArgs: [] }

class FakeRunner implements BoundedProcessRunner {
  requests: BoundedProcessRequest[] = []
  private readonly result: BoundedProcessResult
  private readonly graphJson: string | undefined

  constructor(result: BoundedProcessResult, graphJson?: string) {
    this.result = result
    this.graphJson = graphJson
  }
  async run(request: BoundedProcessRequest): Promise<BoundedProcessResult> {
    this.requests.push(request)
    const outputIndex = request.args.indexOf('--output')
    if (outputIndex >= 0 && this.graphJson !== undefined) await writeFile(request.args[outputIndex + 1], this.graphJson)
    return this.result
  }
}

describe('Tokscale closed command boundary', () => {
  it.each([
    [{ status: 'not-found' } as const, 'not-installed', 'TOKSCALE_NOT_INSTALLED'],
    [{ status: 'timed-out' } as const, 'detection-failed', 'TOKSCALE_TIMEOUT'],
    [{ status: 'completed', exitCode: 0, stdout: 'tokscale 4.3.0', stderr: 'private text' } as const, 'installed-unsupported-version', 'TOKSCALE_VERSION_UNSUPPORTED'],
    [{ status: 'completed', exitCode: 0, stdout: 'tokscale 4.5.2', stderr: '' } as const, 'installed-supported', null],
    [{ status: 'completed', exitCode: 0, stdout: 'changed', stderr: '' } as const, 'installed-contract-unverified', 'TOKSCALE_VERSION_UNPARSEABLE'],
  ])('returns a safe capability state (%#)', async (processResult, state, reasonCode) => {
    const runner = new FakeRunner(processResult)
    const capability = await new TokscaleCommandRunner(runner, NOW, 'C:\\bounded-home', { invocation: TEST_INVOCATION }).capability(new AbortController().signal)
    expect(capability).toMatchObject({ state, reasonCode, collectorSource: 'external-recovery', supportedRange: '4.4.1 or 4.5.2', lastSuccessfulRefreshAt: null })
    expect(JSON.stringify(capability)).not.toMatch(/private text|stdout|stderr|bounded-home/i)
    expect(runner.requests[0]).toMatchObject({ executable: 'C:\\tools\\tokscale.exe', args: ['--version'], timeoutMs: 5_000, maxOutputBytes: 8192 })
  })

  it('generates only fixed recipes with explicit home and a minimized environment', async () => {
    const runner = new FakeRunner({ status: 'completed', exitCode: 0, stdout: '{"clients":[]}', stderr: '' }, '{"data":[]}')
    const commands = new TokscaleCommandRunner(runner, NOW, 'C:\\bounded-home', { invocation: TEST_INVOCATION })
    await commands.run({ recipeId: 'clients' }, new AbortController().signal)
    const graph = await commands.run({ recipeId: 'canonical-graph', since: '2026-07-01', until: '2026-07-13' }, new AbortController().signal)
    await commands.run({ recipeId: 'session-attribution', since: '2026-07-01', until: '2026-07-13' }, new AbortController().signal)
    await commands.run({ recipeId: 'workspace-attribution', since: '2026-07-01', until: '2026-07-13' }, new AbortController().signal)

    expect(graph).toMatchObject({ ok: true, recipeId: 'canonical-graph', json: '{"data":[]}' })
    expect(runner.requests.map((request) => request.args)).toEqual([
      ['--home', 'C:\\bounded-home', 'clients', '--json'],
      ['--home', 'C:\\bounded-home', 'graph', '--output', expect.stringMatching(/graph\.json$/), '--since', '2026-07-01', '--until', '2026-07-13', '--no-spinner'],
      ['--home', 'C:\\bounded-home', 'models', '--json', '--group-by', 'client,session,model', '--since', '2026-07-01', '--until', '2026-07-13', '--no-spinner'],
      ['--home', 'C:\\bounded-home', 'models', '--json', '--group-by', 'workspace,model', '--since', '2026-07-01', '--until', '2026-07-13', '--no-spinner'],
    ])
    expect(JSON.stringify(runner.requests.map((request) => request.args))).not.toMatch(/login|submit|leaderboard|social|quota|sync|account/i)
    for (const request of runner.requests) {
      expect(request.env).not.toHaveProperty('OPENAI_API_KEY')
      expect(request.env).not.toHaveProperty('TOKSCALE_API_TOKEN')
    }
  })

  it('does not inherit provider or Tokscale credentials', () => {
    expect(minimizedTokscaleEnvironment({ PATH: 'safe', OPENAI_API_KEY: 'no', TOKSCALE_API_TOKEN: 'no' })).toEqual({ PATH: 'safe' })
  })
})
