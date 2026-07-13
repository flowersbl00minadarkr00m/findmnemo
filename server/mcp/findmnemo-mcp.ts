import { createHash, randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { createPlatformSecretStore } from '../auth/platform-secret-store.js'
import { RoutingIntegrationAuthService } from '../routing/integration-auth.js'
import { HttpRoutingCompanionTransport, type RoutingCompanionTransport, type RoutingOriginInput } from './companion-transport.js'

const MCP_PROTOCOL_VERSION = '2025-06-18'
const INSTRUCTIONS = 'Use recommend_route before eligible delegated work unless the user explicitly says to handle it yourself. Pass the smallest plain-language capability label that fits (for example writing, coding, debugging, web research, or data analysis); FindMnemo resolves supported labels to the current stable policy IDs and fails unknown values closed. dispatch_work returns the destination result in this same tool call. Recommendation-only, ambiguous, stale, unavailable, and excluded outcomes never dispatch. FindMnemo cannot inject results into an inactive chat; use these tools from the originating conversation.'

interface RpcMessage { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

export function createMcpHandler(transport: RoutingCompanionTransport, originAdapterId: 'codex-mcp' | 'claude-code-mcp' = 'codex-mcp') {
  return async (message: RpcMessage): Promise<Record<string, unknown> | undefined> => {
    if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return undefined
    const id = message.id ?? null
    try {
      if (message.method === 'initialize') return ok(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'findmnemo-routing', version: '0.1.0' }, instructions: INSTRUCTIONS })
      if (message.method === 'ping') return ok(id, {})
      if (message.method === 'tools/list') return ok(id, { tools: toolDefinitions() })
      if (message.method === 'tools/call') return ok(id, await callTool(transport, message.params, originAdapterId))
      return failure(id, -32601, 'Method not found')
    } catch (cause) {
      return failure(id, -32000, cause instanceof Error ? cause.message : 'FindMnemo routing failed')
    }
  }
}

async function callTool(transport: RoutingCompanionTransport, params: Record<string, unknown> | undefined, originAdapterId: 'codex-mcp' | 'claude-code-mcp') {
  const name = params?.name
  const args = isRecord(params?.arguments) ? params?.arguments : {}
  if (name === 'recommend_route') return toolJson(await transport.recommend(originInput(args)))
  if (name === 'dispatch_work') {
    if (typeof args.task !== 'string' || args.task.length === 0) throw new Error('task is required')
    const correlationId = typeof args.correlationId === 'string' ? args.correlationId : randomUUID()
    const result = await transport.dispatch({ ...originInput(args), task: args.task, idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : randomUUID(), timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined, origin: { adapterId: originAdapterId, correlationId, conversationRefHash: typeof args.conversationRef === 'string' ? createHash('sha256').update(args.conversationRef).digest('hex') : null } })
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
  return [
    { name: 'recommend_route', description: 'Read the current FindMnemo policy and explain the exact route or stop state without sending work.', inputSchema: { type: 'object', properties: routingProperties, required: ['capabilityIds'], additionalProperties: false } },
    { name: 'dispatch_work', description: 'Send work only when current FindMnemo policy and explicit overrides allow an exact ready route; return the result in this call.', inputSchema: { type: 'object', properties: { ...routingProperties, task: { type: 'string' }, idempotencyKey: { type: 'string' }, correlationId: { type: 'string' }, conversationRef: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['capabilityIds', 'task'], additionalProperties: false } },
    { name: 'get_dispatch', description: 'Read metadata-only lifecycle evidence for a prior dispatch.', inputSchema: { type: 'object', properties: { receiptId: { type: 'string' } }, required: ['receiptId'], additionalProperties: false } },
    { name: 'cancel_dispatch', description: 'Cancel an active FindMnemo dispatch.', inputSchema: { type: 'object', properties: { receiptId: { type: 'string' } }, required: ['receiptId'], additionalProperties: false } },
  ]
}

function toolJson(value: unknown) { return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: isRecord(value) ? value : { value }, isError: false } }
function ok(id: RpcMessage['id'], result: unknown) { return { jsonrpc: '2.0', id, result } }
function failure(id: RpcMessage['id'], code: number, message: string) { return { jsonrpc: '2.0', id, error: { code, message } } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

async function main() {
  const secret = await createPlatformSecretStore()
  if (!secret.store) throw new Error('CREDENTIAL_STORE_UNAVAILABLE')
  const token = await new RoutingIntegrationAuthService(secret.store).ensure()
  const originArgument = process.argv.find((value) => value.startsWith('--origin='))?.slice('--origin='.length)
  const originAdapterId = originArgument === 'claude-code-mcp' ? 'claude-code-mcp' : 'codex-mcp'
  const handle = createMcpHandler(new HttpRoutingCompanionTransport(token), originAdapterId)
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let message: RpcMessage
    try { message = JSON.parse(line) as RpcMessage } catch { process.stdout.write(`${JSON.stringify(failure(null, -32700, 'Parse error'))}\n`); continue }
    const response = await handle(message)
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : 'MCP failed'}\n`); process.exitCode = 1 })
