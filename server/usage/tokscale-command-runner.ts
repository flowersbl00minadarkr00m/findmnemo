import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import type { UsageCapabilityDto } from '../../shared/companion-contract.js'
import type { BoundedProcessRequest, BoundedProcessRunner } from '../process/bounded-process-runner.js'
import { NodeBoundedProcessRunner } from '../process/bounded-process-runner.js'
import { resolveTokscaleCompatibility, TOKSCALE_COMPATIBILITY_MANIFEST } from './tokscale-compatibility.js'
import { resolveTokscaleInvocation, type TokscaleInvocation, type TokscaleResolutionOptions } from './tokscale-executable.js'

export const TOKSCALE_RECIPE_IDS = [
  'version',
  'clients',
  'canonical-graph',
  'session-attribution',
  'workspace-attribution',
] as const

export type TokscaleRecipeId = (typeof TOKSCALE_RECIPE_IDS)[number]

export type TokscaleRecipeInput =
  | { recipeId: 'version' }
  | { recipeId: 'clients' }
  | { recipeId: 'canonical-graph'; since: string; until: string }
  | { recipeId: 'session-attribution' | 'workspace-attribution'; since: string; until: string }

export type TokscaleCommandCode =
  | 'TOKSCALE_NOT_INSTALLED'
  | 'TOKSCALE_EMBEDDED_MISSING'
  | 'TOKSCALE_EMBEDDED_UNSUPPORTED_PLATFORM'
  | 'TOKSCALE_EXTERNAL_RECOVERY_INVALID'
  | 'TOKSCALE_EXTERNAL_RECOVERY_UNAVAILABLE'
  | 'TOKSCALE_TIMEOUT'
  | 'TOKSCALE_OUTPUT_LIMIT'
  | 'TOKSCALE_PROCESS_FAILED'
  | 'TOKSCALE_COMMAND_FAILED'
  | 'TOKSCALE_OUTPUT_MISSING'
  | 'TOKSCALE_OUTPUT_UNSAFE'

export type TokscaleCommandOutcome =
  | { ok: true; recipeId: TokscaleRecipeId; json: string; durationMs: number; outputBytes?: number }
  | { ok: false; recipeId: TokscaleRecipeId; code: TokscaleCommandCode; durationMs: number; outputBytes?: null }

const RECIPE_BUDGETS: Record<TokscaleRecipeId, { timeoutMs: number; maxOutputBytes: number }> = {
  version: { timeoutMs: 5_000, maxOutputBytes: 8 * 1024 },
  clients: { timeoutMs: 30_000, maxOutputBytes: 4 * 1024 * 1024 },
  'canonical-graph': { timeoutMs: 300_000, maxOutputBytes: 128 * 1024 * 1024 },
  'session-attribution': { timeoutMs: 300_000, maxOutputBytes: 64 * 1024 * 1024 },
  'workspace-attribution': { timeoutMs: 300_000, maxOutputBytes: 64 * 1024 * 1024 },
}

const ENV_ALLOWLIST = [
  'APPDATA', 'ComSpec', 'HOME', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'SystemRoot',
  'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE',
] as const

export interface TokscaleCommandRunnerOptions extends TokscaleResolutionOptions {
  invocation?: TokscaleInvocation
}

export function minimizedTokscaleEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const key of ENV_ALLOWLIST) {
    if (source[key] !== undefined) result[key] = source[key]
  }
  return result
}

export class TokscaleCommandRunner {
  private readonly processRunner: BoundedProcessRunner
  private readonly clock: () => Date
  private readonly home: string
  private readonly invocation: TokscaleInvocation

  constructor(
    processRunner: BoundedProcessRunner = new NodeBoundedProcessRunner(),
    clock: () => Date = () => new Date(),
    home: string = homedir(),
    options: TokscaleCommandRunnerOptions = {},
  ) {
    this.processRunner = processRunner
    this.clock = clock
    this.home = home
    this.invocation = options.invocation ?? resolveTokscaleInvocation({
      ...options,
      externalRecoveryExecutable: options.externalRecoveryExecutable ?? process.env.FINDMNEMO_TOKSCALE_EXTERNAL_PATH,
    })
  }

  async capability(signal: AbortSignal): Promise<UsageCapabilityDto> {
    const outcome = await this.run({ recipeId: 'version' }, signal)
    const base = {
      schema: 'findmnemo.usage-capability.v1' as const,
      executableLabel: 'tokscale' as const,
      collectorSource: this.invocation.source,
      supportedRange: TOKSCALE_COMPATIBILITY_MANIFEST.supportedRange,
      checkedAt: this.clock().toISOString(),
      lastSuccessfulRefreshAt: null,
      sources: [],
      guidance: {
        summary: capabilityGuidance(this.invocation),
        installationUrl: 'https://github.com/flowersbl00minadarkr00m/findmnemo#model-usage',
        automaticInstall: false as const,
      },
    }
    if (!outcome.ok) {
      return {
        ...base,
        state: outcome.code === 'TOKSCALE_NOT_INSTALLED' ? 'not-installed' : 'detection-failed',
        installedVersion: null,
        adapterId: null,
        reasonCode: outcome.code,
      }
    }
    const version = parseVersion(outcome.json)
    if (!version) return { ...base, state: 'installed-contract-unverified', installedVersion: null, adapterId: null, reasonCode: 'TOKSCALE_VERSION_UNPARSEABLE' }
    const compatibility = resolveTokscaleCompatibility(version)
    return {
      ...base,
      state: compatibility.state === 'supported' ? 'installed-supported'
        : compatibility.state === 'unsupported' ? 'installed-unsupported-version'
          : 'installed-contract-unverified',
      installedVersion: compatibility.installedVersion,
      adapterId: compatibility.adapterId,
      reasonCode: compatibility.reasonCode,
    }
  }

  async run(input: TokscaleRecipeInput, signal: AbortSignal): Promise<TokscaleCommandOutcome> {
    const startedAt = Date.now()
    if (!this.invocation.ok) return { ok: false, recipeId: input.recipeId, code: this.invocation.reasonCode, durationMs: Date.now() - startedAt, outputBytes: null }
    if (input.recipeId === 'canonical-graph') return this.runGraph(input, signal, startedAt)
    const request = this.requestFor(input, signal)
    const result = await this.processRunner.run(request)
    return processOutcome(input.recipeId, result, startedAt)
  }

  private requestFor(input: Exclude<TokscaleRecipeInput, { recipeId: 'canonical-graph' }>, signal: AbortSignal): BoundedProcessRequest {
    const args = input.recipeId === 'version' ? ['--version']
      : input.recipeId === 'clients' ? ['--home', this.home, 'clients', '--json']
        : ['--home', this.home, 'models', '--json', '--group-by', input.recipeId === 'session-attribution' ? 'client,session,model' : 'workspace,model', '--since', input.since, '--until', input.until, '--no-spinner']
    return {
      executable: this.invocation.ok ? this.invocation.executable : '',
      args: [...(this.invocation.ok ? this.invocation.prefixArgs : []), ...args],
      signal,
      env: minimizedTokscaleEnvironment(),
      ...RECIPE_BUDGETS[input.recipeId],
    }
  }

  private async runGraph(input: Extract<TokscaleRecipeInput, { recipeId: 'canonical-graph' }>, signal: AbortSignal, startedAt: number): Promise<TokscaleCommandOutcome> {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-tokscale-'))
    const outputPath = join(directory, 'graph.json')
    try {
      assertContained(directory, outputPath)
      const result = await this.processRunner.run({
        executable: this.invocation.ok ? this.invocation.executable : '',
        args: [...(this.invocation.ok ? this.invocation.prefixArgs : []), '--home', this.home, 'graph', '--output', outputPath, '--since', input.since, '--until', input.until, '--no-spinner'],
        signal,
        env: minimizedTokscaleEnvironment(),
        ...RECIPE_BUDGETS['canonical-graph'],
      })
      const processResult = processOutcome('canonical-graph', result, startedAt)
      if (!processResult.ok) return processResult
      try {
        const stat = await lstat(outputPath)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > RECIPE_BUDGETS['canonical-graph'].maxOutputBytes) {
          return { ok: false, recipeId: 'canonical-graph', code: 'TOKSCALE_OUTPUT_UNSAFE', durationMs: Date.now() - startedAt, outputBytes: null }
        }
        const json = await readFile(outputPath, 'utf8')
        return { ok: true, recipeId: 'canonical-graph', json, durationMs: Date.now() - startedAt, outputBytes: Buffer.byteLength(json) }
      } catch {
        return { ok: false, recipeId: 'canonical-graph', code: 'TOKSCALE_OUTPUT_MISSING', durationMs: Date.now() - startedAt, outputBytes: null }
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }
}

function processOutcome(recipeId: TokscaleRecipeId, result: Awaited<ReturnType<BoundedProcessRunner['run']>>, startedAt: number): TokscaleCommandOutcome {
  const durationMs = Date.now() - startedAt
  if (result.status === 'completed') {
    if (result.exitCode !== 0) return { ok: false, recipeId, code: 'TOKSCALE_COMMAND_FAILED', durationMs, outputBytes: null }
    return { ok: true, recipeId, json: result.stdout, durationMs, outputBytes: Buffer.byteLength(result.stdout) }
  }
  const code: TokscaleCommandCode = result.status === 'not-found' ? 'TOKSCALE_NOT_INSTALLED'
    : result.status === 'timed-out' ? 'TOKSCALE_TIMEOUT'
      : result.status === 'output-limit' ? 'TOKSCALE_OUTPUT_LIMIT'
        : 'TOKSCALE_PROCESS_FAILED'
  return { ok: false, recipeId, code, durationMs, outputBytes: null }
}

function capabilityGuidance(invocation: TokscaleInvocation): string {
  if (invocation.ok && invocation.source === 'embedded') return 'Built-in collector ready. FindMnemo owns its version and does not need a separate Tokscale installation.'
  if (invocation.ok) return 'External recovery selected. The same version, command, timeout, and privacy checks still apply.'
  if (invocation.reasonCode.startsWith('TOKSCALE_EXTERNAL_RECOVERY')) return 'The external recovery collector is invalid or unavailable. Remove that override or choose an existing absolute executable path.'
  if (invocation.reasonCode === 'TOKSCALE_EMBEDDED_UNSUPPORTED_PLATFORM') return 'This operating-system or processor build does not contain a qualified collector. Use the documented source-run path on a supported platform.'
  return 'The built-in collector is missing or damaged. Repair or reinstall this FindMnemo build; a separate global Tokscale installation is not required.'
}

function parseVersion(output: string): string | null {
  const match = /(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/.exec(output.trim())
  return match?.[1] ?? null
}

function assertContained(directory: string, path: string): void {
  const child = relative(directory, path)
  if (isAbsolute(child) || child.startsWith('..')) throw new Error('TOKSCALE_OUTPUT_PATH_ESCAPE')
}
