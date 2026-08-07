import { createHash, randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { createPlatformSecretStore, type PlatformSecretStoreResult } from '../auth/platform-secret-store.js'
import type { SecretStore } from '../auth/secret-store.js'
import { RoutingIntegrationAuthService } from '../routing/integration-auth.js'
import { activityTokenReference } from '../agent-activity/integration-auth-service.js'
import type { AgentFamily, AgentKind, PreciseExecutionSurface } from '../../shared/agent-activity-contract.js'
import { HttpManualActivityTransport, type ManualActivityTransport } from './activity-transport.js'
import { HttpRoutingCompanionTransport, type RoutingCompanionTransport, type RoutingOriginInput } from './companion-transport.js'

const MCP_PROTOCOL_VERSION = '2025-06-18'
const INSTRUCTIONS = 'Use recommend_route before eligible delegated work unless the user explicitly says to handle it yourself. Pass the smallest plain-language capability label that fits (for example writing, coding, debugging, web research, or data analysis); FindMnemo resolves supported labels to the current stable policy IDs and fails unknown values closed. dispatch_work returns the destination result in this same tool call. Recommendation-only, ambiguous, stale, unavailable, and excluded outcomes never dispatch. report_active_work is the consolidated explicit manual lifecycle action. Legacy active-work names remain compatible aliases during release trains N and N+1 and may be removed no earlier than N+2 through a separately reviewed change. Active-work reporting never claims automatic coverage and accepts only a short safe summary plus an opaque project ID or Unassigned. FindMnemo cannot inject results into an inactive chat; use these tools from the originating conversation.'

interface RpcMessage { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
type OriginAdapterId = 'codex-mcp' | 'claude-code-mcp'

export interface McpProcessIo {
  args: readonly string[]
  input: NodeJS.ReadableStream
  writeStdout: (line: string) => void
}

interface McpActivityTransportOptions {
  integrationId: string
  agent: AgentKind
  agentFamily?: AgentFamily
  executionSurface?: PreciseExecutionSurface
  store: SecretStore
}

export interface McpProcessDependencies {
  createSecretStore?: () => Promise<PlatformSecretStoreResult>
  createRoutingTransport?: (token: string) => RoutingCompanionTransport
  createActivityTransport?: (token: string, options: McpActivityTransportOptions) => ManualActivityTransport
}

export interface McpActivityBinding {
  integrationId: string
  agentFamily: AgentFamily
  executionSurface: PreciseExecutionSurface
}

export interface McpServerConstruction {
  originAdapterId: OriginAdapterId
  agent: AgentKind
  integrationId: string
  activityBinding?: McpActivityBinding
}

export function createMcpHandler(
  transport: RoutingCompanionTransport,
  originAdapterId: OriginAdapterId = 'codex-mcp',
  activity?: ManualActivityTransport,
  activityBinding?: McpActivityBinding,
) {
  return async (message: RpcMessage): Promise<Record<string, unknown> | undefined> => {
    if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return undefined
    const id = message.id ?? null
    try {
      if (message.method === 'initialize') return ok(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'findmnemo-routing', version: '0.1.0' }, instructions: INSTRUCTIONS })
      if (message.method === 'ping') return ok(id, {})
      if (message.method === 'tools/list') return ok(id, { tools: toolDefinitions() })
      if (message.method === 'tools/call') return ok(id, await callTool(transport, message.params, originAdapterId, activity, activityBinding))
      return failure(id, -32601, 'Method not found')
    } catch (cause) {
      return failure(id, -32000, cause instanceof Error ? cause.message : 'FindMnemo routing failed')
    }
  }
}

async function callTool(
  transport: RoutingCompanionTransport,
  params: Record<string, unknown> | undefined,
  originAdapterId: OriginAdapterId,
  activity?: ManualActivityTransport,
  activityBinding?: McpActivityBinding,
) {
  const name = params?.name
  const args = isRecord(params?.arguments) ? params?.arguments : {}
  if (name === 'recommend_route') return toolJson(await transport.recommend(originInput(args)))
  if (name === 'dispatch_work') {
    if (process.env.FINDMNEMO_CHILD_DISPATCH === '1') throw new Error('recursive-dispatch-blocked')
    if (typeof args.task !== 'string' || args.task.length === 0) throw new Error('task is required')
    const correlationId = typeof args.correlationId === 'string' ? args.correlationId : randomUUID()
    const result = await transport.dispatch({ ...originInput(args), task: args.task, idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : randomUUID(), timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined, projectFolderId: typeof args.projectFolderId === 'string' ? args.projectFolderId : undefined, origin: { adapterId: originAdapterId, correlationId, conversationRefHash: typeof args.conversationRef === 'string' ? createHash('sha256').update(args.conversationRef).digest('hex') : null } })
    if (result.disposition === 'completed' && result.receipt && result.output !== undefined) await transport.acknowledgeDelivery(result.receipt.id)
    return toolJson({ ...result, attribution: result.receipt ? { requested: result.receipt.requestedProfileSnapshot, actual: result.receipt.actualRoute, receiptId: result.receipt.id } : undefined })
  }
  if (name === 'get_dispatch') {
    if (typeof args.receiptId !== 'string') throw new Error('receiptId is required')
    return toolJson(await transport.getDispatch(args.receiptId))
  }
  if (name === 'cancel_dispatch') {
    if (typeof args.receiptId !== 'string') throw new Error('receiptId is required')
    return toolJson(await transport.cancelDispatch(args.receiptId))
  }
  const consolidated = name === 'report_active_work'
  const action = consolidated ? args.action : MANUAL_TOOL_ACTIONS[String(name)]
  if (action) {
    if (!activity) throw new Error('ACTIVITY_REPORTING_UNAVAILABLE')
    if (!MANUAL_ACTIONS.has(action as ManualAction)) throw new Error('active-work action is invalid')
    if (typeof args.assignmentId !== 'string' || typeof args.summary !== 'string') throw new Error('assignmentId and safe summary are required')
    const allowedKeys = consolidated ? CONSOLIDATED_ARGUMENT_KEYS : LEGACY_ARGUMENT_KEYS
    if (Object.keys(args).some((key) => !allowedKeys.has(key))) throw new Error('active-work arguments are invalid')
    if (args.generation !== undefined && (!Number.isSafeInteger(args.generation) || Number(args.generation) < 1)) throw new Error('active-work arguments are invalid')
    if (args.projectId !== undefined && typeof args.projectId !== 'string') throw new Error('active-work arguments are invalid')
    if (args.modelLabel !== undefined && typeof args.modelLabel !== 'string') throw new Error('active-work arguments are invalid')
    const agent = activityBinding ? legacyAgentForFamily(activityBinding.agentFamily) : legacyAgentForOrigin(originAdapterId)
    const receipt = await activity.report({
      integrationId: activityBinding?.integrationId ?? `manual:${agent}`,
      agent,
      ...(activityBinding ? { agentFamily: activityBinding.agentFamily, executionSurface: activityBinding.executionSurface } : {}),
      action: action as ManualAction, assignmentId: args.assignmentId,
      generation: typeof args.generation === 'number' ? args.generation : 1, summary: args.summary,
      projectRef: typeof args.projectId === 'string' ? { kind: 'approved-project', id: args.projectId } : { kind: 'unassigned' },
      ...(typeof args.modelLabel === 'string' ? { modelLabel: args.modelLabel } : {}),
      evidenceKind: 'mcp-tool',
    })
    return toolJson(activityBinding ? {
      ...receipt,
      agentFamily: activityBinding.agentFamily,
      executionSurface: activityBinding.executionSurface,
    } : receipt)
  }
  throw new Error('Unknown routing tool')
}

function originInput(args: Record<string, unknown>): RoutingOriginInput {
  if (!Array.isArray(args.capabilityIds) || !args.capabilityIds.every((value) => typeof value === 'string')) throw new Error('capabilityIds are required')
  const override = args.self === true ? { mode: 'self' as const }
    : typeof args.includeProfileId === 'string' ? { mode: 'include' as const, profileId: args.includeProfileId }
      : Array.isArray(args.excludeProfileIds) && args.excludeProfileIds.every((value) => typeof value === 'string') ? { mode: 'exclude' as const, profileIds: args.excludeProfileIds as string[] }
        : { mode: 'none' as const }
  return { capabilityIds: args.capabilityIds as string[], classificationSource: args.userConfirmed === true ? 'user-confirmed' : 'explicit', classificationAmbiguous: args.ambiguous === true, override }
}

function toolDefinitions() {
  const routingProperties = { capabilityIds: { type: 'array', description: 'Smallest set of stable IDs or plain-language capability labels that fit the request. Common labels include writing, coding, debugging, web research, and data analysis. Unknown values fail closed.', items: { type: 'string' }, minItems: 1 }, ambiguous: { type: 'boolean' }, userConfirmed: { type: 'boolean' }, self: { type: 'boolean' }, includeProfileId: { type: 'string' }, excludeProfileIds: { type: 'array', items: { type: 'string' } } }
  const manualProperties = { assignmentId: { type: 'string', description: 'Stable opaque ID for this assignment.' }, summary: { type: 'string', maxLength: 160, description: 'Short safe task summary; never include a prompt, response, transcript, reasoning, credential, path, or raw log.' }, generation: { type: 'integer', minimum: 1 }, projectId: { type: 'string', description: 'Optional opaque approved FindMnemo project ID. Omit for Unassigned.' }, modelLabel: { type: 'string', description: 'Optional bounded provider/model label. Invalid labels are ignored and never block lifecycle reporting.' } }
  const action = { type: 'string', enum: [...MANUAL_ACTIONS], description: 'Explicit lifecycle action. Only complete, fail, and cancel are terminal.' }
  return [
    { name: 'recommend_route', description: 'Read the current FindMnemo policy and explain the exact route or stop state without sending work.', inputSchema: { type: 'object', properties: routingProperties, required: ['capabilityIds'], additionalProperties: false } },
    { name: 'dispatch_work', description: 'Send work only when current FindMnemo policy and explicit overrides allow an exact ready route; return the result in this call.', inputSchema: { type: 'object', properties: { ...routingProperties, task: { type: 'string' }, idempotencyKey: { type: 'string' }, correlationId: { type: 'string' }, conversationRef: { type: 'string' }, timeoutMs: { type: 'number' }, projectFolderId: { type: 'string', description: 'Optional opaque FindMnemo project-folder ID. Raw filesystem paths are not accepted.' } }, required: ['capabilityIds', 'task'], additionalProperties: false } },
    { name: 'get_dispatch', description: 'Read metadata-only lifecycle evidence for a prior dispatch.', inputSchema: { type: 'object', properties: { receiptId: { type: 'string' } }, required: ['receiptId'], additionalProperties: false } },
    { name: 'cancel_dispatch', description: 'Cancel an active FindMnemo dispatch.', inputSchema: { type: 'object', properties: { receiptId: { type: 'string' } }, required: ['receiptId'], additionalProperties: false } },
    { name: 'report_active_work', description: 'Report one explicit manual active-work lifecycle action. This does not claim automatic coverage.', inputSchema: { type: 'object', properties: { action, ...manualProperties }, required: ['action', 'assignmentId', 'summary'], additionalProperties: false } },
    ...Object.keys(MANUAL_TOOL_ACTIONS).map((name) => ({ name, description: `${name.replaceAll('_', ' ')} as a deprecated compatibility alias during release trains N and N+1; use report_active_work for new setup. This does not claim automatic coverage.`, inputSchema: { type: 'object', properties: manualProperties, required: ['assignmentId', 'summary'], additionalProperties: false } })),
  ]
}

type ManualAction = 'start' | 'update' | 'wait' | 'block' | 'needs-action' | 'complete' | 'fail' | 'cancel' | 'snapshot'
const MANUAL_ACTIONS = new Set<ManualAction>(['start', 'update', 'wait', 'block', 'needs-action', 'complete', 'fail', 'cancel', 'snapshot'])
const MANUAL_TOOL_ACTIONS: Record<string, ManualAction> = {
  start_active_work: 'start', update_active_work: 'update', wait_active_work: 'wait', block_active_work: 'block',
  request_action_active_work: 'needs-action', complete_active_work: 'complete', fail_active_work: 'fail', cancel_active_work: 'cancel', snapshot_active_work: 'snapshot',
}
const LEGACY_ARGUMENT_KEYS = new Set(['assignmentId', 'summary', 'generation', 'projectId', 'modelLabel'])
const CONSOLIDATED_ARGUMENT_KEYS = new Set(['action', ...LEGACY_ARGUMENT_KEYS])

function legacyAgentForOrigin(originAdapterId: OriginAdapterId): AgentKind {
  return originAdapterId === 'claude-code-mcp' ? 'claude-code' : 'codex-cli'
}

function legacyAgentForFamily(family: AgentFamily): AgentKind {
  return family === 'claude' ? 'claude-code' : family === 'pi' ? 'pi' : 'codex-cli'
}

const SURFACE_CONSTRUCTION = {
  'claude-desktop-code': { originAdapterId: 'claude-code-mcp', agentFamily: 'claude' },
  'claude-desktop-home': { originAdapterId: 'claude-code-mcp', agentFamily: 'claude' },
  'claude-code-cli': { originAdapterId: 'claude-code-mcp', agentFamily: 'claude' },
  'codex-desktop': { originAdapterId: 'codex-mcp', agentFamily: 'codex' },
  'codex-cli': { originAdapterId: 'codex-mcp', agentFamily: 'codex' },
  'pi-cli': { originAdapterId: null, agentFamily: 'pi' },
} as const satisfies Record<PreciseExecutionSurface, { originAdapterId: OriginAdapterId | null; agentFamily: AgentFamily }>

export function resolveMcpServerConstruction(args: readonly string[]): McpServerConstruction {
  const originValue = fixedLaunchArgument(args, 'origin', 'ACTIVITY_ORIGIN_INVALID')
  const surfaceValue = fixedLaunchArgument(args, 'surface', 'ACTIVITY_SURFACE_INVALID')
  if (originValue !== undefined && originValue !== 'codex-mcp' && originValue !== 'claude-code-mcp') throw new Error('ACTIVITY_ORIGIN_INVALID')
  const originAdapterId = originValue ?? 'codex-mcp'
  const agent = legacyAgentForOrigin(originAdapterId)
  if (surfaceValue === undefined) return { originAdapterId, agent, integrationId: `manual:${agent}` }
  if (originValue === undefined) throw new Error('ACTIVITY_SURFACE_ORIGIN_REQUIRED')
  if (!Object.hasOwn(SURFACE_CONSTRUCTION, surfaceValue)) throw new Error('ACTIVITY_SURFACE_INVALID')
  const executionSurface = surfaceValue as PreciseExecutionSurface
  const expected = SURFACE_CONSTRUCTION[executionSurface]
  if (expected.originAdapterId === null || expected.originAdapterId !== originAdapterId) throw new Error('ACTIVITY_SURFACE_ORIGIN_MISMATCH')
  const integrationId = `surface:${executionSurface}`
  return {
    originAdapterId,
    agent: legacyAgentForFamily(expected.agentFamily),
    integrationId,
    activityBinding: {
      integrationId,
      agentFamily: expected.agentFamily,
      executionSurface,
    },
  }
}

function fixedLaunchArgument(args: readonly string[], name: 'origin' | 'surface', errorCode: string): string | undefined {
  const prefix = `--${name}=`
  const matches = args.filter((value) => value === `--${name}` || value.startsWith(prefix))
  if (matches.length > 1 || matches[0] === `--${name}`) throw new Error(errorCode)
  if (!matches.length) return undefined
  const value = matches[0].slice(prefix.length)
  if (!value) throw new Error(errorCode)
  return value
}

function toolJson(value: unknown) { return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: isRecord(value) ? value : { value }, isError: false } }
function ok(id: RpcMessage['id'], result: unknown) { return { jsonrpc: '2.0', id, result } }
function failure(id: RpcMessage['id'], code: number, message: string) { return { jsonrpc: '2.0', id, error: { code, message } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

export async function runMcpProcess(io: McpProcessIo, dependencies: McpProcessDependencies = {}): Promise<void> {
  try {
    const secret = await (dependencies.createSecretStore ?? createPlatformSecretStore)()
    if (!secret.store) throw new Error('CREDENTIAL_STORE_UNAVAILABLE')
    const token = await new RoutingIntegrationAuthService(secret.store).ensure()
    const construction = resolveMcpServerConstruction(io.args)
    const activityToken = await secret.store.get(activityTokenReference(construction.integrationId))
    const activityOptions: McpActivityTransportOptions = {
      integrationId: construction.integrationId,
      agent: construction.agent,
      ...(construction.activityBinding ? {
        agentFamily: construction.activityBinding.agentFamily,
        executionSurface: construction.activityBinding.executionSurface,
      } : {}),
      store: secret.store,
    }
    const activity = activityToken
      ? (dependencies.createActivityTransport ?? ((value, options) => new HttpManualActivityTransport(value, options)))(activityToken, activityOptions)
      : undefined
    const routing = (dependencies.createRoutingTransport ?? ((value) => new HttpRoutingCompanionTransport(value)))(token)
    const handle = createMcpHandler(routing, construction.originAdapterId, activity, construction.activityBinding)
    const lines = createInterface({ input: io.input, crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line.trim()) continue
      let message: RpcMessage
      try {
        message = JSON.parse(line) as RpcMessage
      } catch {
        io.writeStdout(`${JSON.stringify(failure(null, -32700, 'Parse error'))}\n`)
        continue
      }
      const response = await handle(message)
      if (response) io.writeStdout(`${JSON.stringify(response)}\n`)
    }
  } catch (cause) {
    throw new Error(mcpProcessFailureCode(cause), { cause })
  }
}

export function mcpProcessFailureCode(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : ''
  return MCP_PROCESS_FAILURE_CODES.has(code) ? code : 'MCP_STARTUP_FAILED'
}

const MCP_PROCESS_FAILURE_CODES = new Set([
  'ACTIVITY_ORIGIN_INVALID',
  'ACTIVITY_SURFACE_INVALID',
  'ACTIVITY_SURFACE_ORIGIN_REQUIRED',
  'ACTIVITY_SURFACE_ORIGIN_MISMATCH',
  'CREDENTIAL_STORE_UNAVAILABLE',
  'MCP_STARTUP_FAILED',
])

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  void runMcpProcess({
    args: process.argv.slice(2),
    input: process.stdin,
    writeStdout: (line) => { process.stdout.write(line) },
  }).catch((error) => {
    process.stderr.write(`${mcpProcessFailureCode(error)}\n`)
    process.exitCode = 1
  })
}
