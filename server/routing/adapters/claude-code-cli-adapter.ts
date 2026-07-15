import type { DestinationModelCatalogDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import type { AdapterConnectionContext, AdapterManifest, DestinationAdapter, DestinationExecutionEvent, RoutingProcessRunner } from '../adapter-contract.js'
import { ROUTING_COMPATIBILITY_MANIFESTS } from '../compatibility-manifests.js'
import { CommandDetector } from './command-detector.js'

const VERSION = '1.0.0'
const MODELS = ['sonnet', 'opus', 'haiku'].map((modelId) => ({ providerId: 'anthropic', modelId, displayName: `Claude ${modelId[0].toUpperCase()}${modelId.slice(1)}`, reasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }))
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const SAFE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export class ClaudeCodeCliAdapter implements DestinationAdapter {
  readonly manifest: AdapterManifest
  private readonly runner: RoutingProcessRunner
  private readonly detector: CommandDetector
  private readonly clock: () => Date
  constructor(runner: RoutingProcessRunner, clock: () => Date = () => new Date()) {
    this.runner = runner; this.clock = clock
    this.manifest = { adapterId: 'claude-code-cli', displayName: 'Claude Code', executableLabel: process.platform === 'win32' ? 'claude.cmd' : 'claude', versionArgs: ['--version'], supportedRange: '2.x', testedCapabilities: ['detection', 'authentication', 'catalog', 'validation', 'execution', 'cancellation'], controllability: 'controllable', installationGuidance: 'Install the official Claude Code CLI, then check again.', authenticationGuidance: 'Run claude login in a terminal, then check again.', qualification: ROUTING_COMPATIBILITY_MANIFESTS['claude-code-cli'] }
    this.detector = new CommandDetector(this.manifest, runner, clock)
  }
  detect(signal: AbortSignal) { return this.detector.detect(signal) }
  async checkAuthentication(_context: AdapterConnectionContext, signal: AbortSignal) {
    const result = await this.runner.run({ executable: this.manifest.executableLabel, args: ['auth', 'status', '--json'], timeoutMs: 5_000, maxOutputBytes: 16_384, signal })
    if (result.status !== 'completed' || result.exitCode !== 0) return { state: 'required' as const, reasonCode: 'CLAUDE_LOGIN_REQUIRED' }
    try { const status = JSON.parse(result.stdout) as { loggedIn?: unknown }; return status.loggedIn === true ? { state: 'ready' as const, reasonCode: null } : { state: 'required' as const, reasonCode: 'CLAUDE_LOGIN_REQUIRED' } } catch { return { state: 'unsupported' as const, reasonCode: 'CLAUDE_AUTH_SCHEMA_CHANGED' } }
  }
  async listConnectionModels(context: AdapterConnectionContext, signal: AbortSignal): Promise<DestinationModelCatalogDto> {
    const detection = await this.detect(signal)
    if (detection.compatibility !== 'supported' || !detection.installedVersion) throw new Error('CLAUDE_VERSION_UNSUPPORTED')
    const now = this.clock()
    return { adapterId: context.connection.adapterId, adapterVersion: VERSION, installedVersion: detection.installedVersion, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(), models: MODELS }
  }
  async validateConnectionProfile(profile: RoutingProfileV3, context: AdapterConnectionContext, signal: AbortSignal) {
    const catalog = await this.listConnectionModels(context, signal)
    const known = catalog.models.some((model) => model.modelId === profile.modelId && (profile.effort === null || model.supportedEfforts.includes(profile.effort)))
    return { valid: known || SAFE_MODEL.test(profile.modelId) && (profile.effort === null || SAFE_EFFORT.has(profile.effort)), reasonCode: known ? null : SAFE_MODEL.test(profile.modelId) ? 'CUSTOM_MODEL_UNVERIFIED' : 'MODEL_INVALID' }
  }
  async *executeConnectionProfile(profile: RoutingProfileV3, task: string, context: AdapterConnectionContext, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent> {
    if (!SAFE_MODEL.test(profile.modelId) || profile.effort !== null && !SAFE_EFFORT.has(profile.effort) || !context.projectContext || task.length > 200_000) throw new Error('CLAUDE_REQUEST_INVALID')
    const args = ['--print', '--input-format', 'text', '--output-format', 'json', '--no-session-persistence', '--model', profile.modelId, '--permission-mode', 'dontAsk', '--allowedTools', 'Read,Grep,Glob']
    if (profile.effort) args.push('--effort', profile.effort)
    const actualRoute = { destinationAdapterId: 'claude-code-cli', destinationInstanceId: context.connection.id, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort }
    yield { type: 'started', actualRoute }
    const result = await this.runner.run({ executable: this.manifest.executableLabel, args, cwd: context.projectContext.localPath, env: childDispatchEnvironment(context), stdin: task, timeoutMs: 10 * 60_000, maxOutputBytes: 2 * 1024 * 1024, signal })
    if (result.status !== 'completed' || result.exitCode !== 0) { yield { type: 'failed', code: result.status === 'timed-out' ? 'CLAUDE_TIMEOUT' : result.status === 'output-limit' ? 'CLAUDE_OUTPUT_LIMIT' : 'CLAUDE_EXECUTION_FAILED' }; return }
    const parsed = parseClaudeResult(result.stdout)
    if (!parsed) { yield { type: 'failed', code: 'CLAUDE_OUTPUT_MALFORMED' }; return }
    yield { type: 'completed', text: parsed.text, actualRoute: { ...actualRoute, modelId: parsed.modelId ?? profile.modelId } }
  }
}

function childDispatchEnvironment(context: AdapterConnectionContext): NodeJS.ProcessEnv | undefined {
  return context.dispatchChain ? { ...process.env, FINDMNEMO_CHILD_DISPATCH: '1', FINDMNEMO_DISPATCH_CHAIN_ID: context.dispatchChain.id, FINDMNEMO_DISPATCH_CHAIN_DEPTH: String(context.dispatchChain.depth), FINDMNEMO_DISPATCH_CHAIN_TOKEN: context.dispatchChain.token } : undefined
}

export function parseClaudeResult(output: string): { text: string; modelId: string | null } | null {
  try {
    const value = JSON.parse(output) as Record<string, unknown>
    if (value.type !== 'result' || value.is_error === true || typeof value.result !== 'string') return null
    const usage = typeof value.modelUsage === 'object' && value.modelUsage !== null && !Array.isArray(value.modelUsage) ? Object.keys(value.modelUsage) : []
    return { text: value.result, modelId: usage.length === 1 ? usage[0] : null }
  } catch { return null }
}
