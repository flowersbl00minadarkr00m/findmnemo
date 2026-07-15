import type { DestinationModelCatalogDto, RoutingProfileV3 } from '../../../shared/companion-contract.js'
import type { AdapterConnectionContext, AdapterManifest, DestinationAdapter, DestinationExecutionEvent, RoutingProcessRunner } from '../adapter-contract.js'
import { ROUTING_COMPATIBILITY_MANIFESTS } from '../compatibility-manifests.js'
import { CommandDetector } from './command-detector.js'

const VERSION = '1.0.0'
const MODELS = [
  { providerId: 'openai', modelId: 'gpt-5.4', displayName: 'GPT-5.4', reasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'] },
  { providerId: 'openai', modelId: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', reasoning: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'] },
]
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const SAFE_EFFORT = new Set(['low', 'medium', 'high', 'xhigh'])

export class CodexCliAdapter implements DestinationAdapter {
  readonly manifest: AdapterManifest
  private readonly runner: RoutingProcessRunner
  private readonly detector: CommandDetector
  private readonly clock: () => Date

  constructor(runner: RoutingProcessRunner, clock: () => Date = () => new Date()) {
    this.runner = runner; this.clock = clock
    this.manifest = { adapterId: 'codex-cli', displayName: 'Codex CLI', executableLabel: process.platform === 'win32' ? 'codex.cmd' : 'codex', versionArgs: ['--version'], supportedRange: '0.x', testedCapabilities: ['detection', 'authentication', 'catalog', 'validation', 'execution', 'cancellation'], controllability: 'controllable', installationGuidance: 'Install the official Codex CLI, then check again.', authenticationGuidance: 'Run codex login in a terminal, then check again.', qualification: ROUTING_COMPATIBILITY_MANIFESTS['codex-cli'] }
    this.detector = new CommandDetector(this.manifest, runner, clock)
  }
  detect(signal: AbortSignal) { return this.detector.detect(signal) }
  async checkAuthentication(_context: AdapterConnectionContext, signal: AbortSignal) {
    const result = await this.runner.run({ executable: this.manifest.executableLabel, args: ['login', 'status'], timeoutMs: 5_000, maxOutputBytes: 8_192, signal })
    return result.status === 'completed' && result.exitCode === 0 ? { state: 'ready' as const, reasonCode: null } : { state: 'required' as const, reasonCode: 'CODEX_LOGIN_REQUIRED' }
  }
  async listConnectionModels(context: AdapterConnectionContext, signal: AbortSignal): Promise<DestinationModelCatalogDto> {
    const detection = await this.detect(signal)
    if (detection.compatibility !== 'supported' || !detection.installedVersion) throw new Error('CODEX_VERSION_UNSUPPORTED')
    const now = this.clock()
    return { adapterId: context.connection.adapterId, adapterVersion: VERSION, installedVersion: detection.installedVersion, checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60_000).toISOString(), models: MODELS }
  }
  async validateConnectionProfile(profile: RoutingProfileV3, context: AdapterConnectionContext, signal: AbortSignal) {
    const catalog = await this.listConnectionModels(context, signal)
    const known = catalog.models.some((model) => model.modelId === profile.modelId && (profile.effort === null || model.supportedEfforts.includes(profile.effort)))
    return { valid: known || SAFE_MODEL.test(profile.modelId) && (profile.effort === null || SAFE_EFFORT.has(profile.effort)), reasonCode: known ? null : SAFE_MODEL.test(profile.modelId) ? 'CUSTOM_MODEL_UNVERIFIED' : 'MODEL_INVALID' }
  }
  async *executeConnectionProfile(profile: RoutingProfileV3, task: string, context: AdapterConnectionContext, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent> {
    if (!SAFE_MODEL.test(profile.modelId) || profile.effort !== null && !SAFE_EFFORT.has(profile.effort) || !context.projectContext || task.length > 200_000) throw new Error('CODEX_REQUEST_INVALID')
    const args = ['exec', '--model', profile.modelId, '--sandbox', 'read-only', '--ephemeral', '--json']
    if (profile.effort) args.push('-c', `model_reasoning_effort=${profile.effort}`)
    args.push('-')
    yield { type: 'started', actualRoute: { destinationAdapterId: 'codex-cli', destinationInstanceId: context.connection.id, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort } }
    const result = await this.runner.run({ executable: this.manifest.executableLabel, args, cwd: context.projectContext.localPath, env: childDispatchEnvironment(context), stdin: task, timeoutMs: 10 * 60_000, maxOutputBytes: 2 * 1024 * 1024, signal })
    if (result.status !== 'completed' || result.exitCode !== 0) { yield { type: 'failed', code: result.status === 'timed-out' ? 'CODEX_TIMEOUT' : result.status === 'output-limit' ? 'CODEX_OUTPUT_LIMIT' : 'CODEX_EXECUTION_FAILED' }; return }
    const text = parseCodexFinalMessage(result.stdout)
    if (text === null) { yield { type: 'failed', code: 'CODEX_OUTPUT_MALFORMED' }; return }
    yield { type: 'completed', text, actualRoute: { destinationAdapterId: 'codex-cli', destinationInstanceId: context.connection.id, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort } }
  }
}

function childDispatchEnvironment(context: AdapterConnectionContext): NodeJS.ProcessEnv | undefined {
  return context.dispatchChain ? { ...process.env, FINDMNEMO_CHILD_DISPATCH: '1', FINDMNEMO_DISPATCH_CHAIN_ID: context.dispatchChain.id, FINDMNEMO_DISPATCH_CHAIN_DEPTH: String(context.dispatchChain.depth), FINDMNEMO_DISPATCH_CHAIN_TOKEN: context.dispatchChain.token } : undefined
}

export function parseCodexFinalMessage(output: string): string | null {
  let final: string | null = null
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as Record<string, unknown>
      const item = typeof event.item === 'object' && event.item !== null ? event.item as Record<string, unknown> : undefined
      if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') final = item.text
    } catch { return null }
  }
  return final
}
