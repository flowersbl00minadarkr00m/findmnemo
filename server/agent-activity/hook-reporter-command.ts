import { createPlatformSecretStore } from '../auth/platform-secret-store.js'
import { HttpAssignmentEventTransport } from '../mcp/activity-transport.js'
import { activityTokenReference } from './integration-auth-service.js'
import { ReporterSanitizer, type ReporterEventDraft } from './reporter/sanitizer.js'
import { CodexActivityAdapter } from './adapters/codex-activity-adapter.js'
import { ClaudeCodeActivityAdapter } from './adapters/claude-code-activity-adapter.js'
import { PiActivityAdapter } from './adapters/pi-activity-adapter.js'

export type ActivityHookReporterOutcome = 'submitted' | 'submitted:snapshot' | `submitted:recovery-unavailable:${string}` | 'submitted:no-waiting-snapshot' | 'ignored' | 'failed:arguments' | 'failed:secret' | 'failed:adapter' | 'failed:sanitize' | 'failed:submit'

export async function runActivityHookReporter(values: string[] = process.argv.slice(2)): Promise<ActivityHookReporterOutcome> {
  let stage: 'arguments' | 'secret' | 'adapter' | 'sanitize' | 'submit' = 'arguments'
  try {
    const args = argumentsFrom(values)
    const payload = args.safeEventBase64
      ? JSON.parse(Buffer.from(args.safeEventBase64, 'base64').toString('utf8')) as unknown
      : args.safeEvent ? JSON.parse(args.safeEvent) as unknown : JSON.parse(await readStdin()) as unknown
    const integrationId = `auto:${args.agent}`
    const options = { integrationId, agentVersion: versionFor(args.agent), projectRef: { kind: 'unassigned' as const } }
    stage = 'secret'
    const secret = await createPlatformSecretStore()
    if (!secret.store) return 'ignored'
    const token = await secret.store.get(activityTokenReference(integrationId))
    if (!token) return 'ignored'
    const transport = new HttpAssignmentEventTransport(token, integrationId, secret.store)
    let recoveryFailure: string | undefined
    const recovery = await transport.recovery().catch((error: unknown) => { recoveryFailure = safeRecoveryFailure(error); return undefined })
    stage = 'adapter'
    let drafts: ReporterEventDraft[]
    if (args.agent === 'pi') {
      const adapter = new PiActivityAdapter(options)
      const snapshot = recovery?.snapshots.find((candidate) => candidate.mode === 'current-session')
      if (snapshot) adapter.armCurrentSessionSnapshot({ requestId: snapshot.requestId, coverageStartedAt: new Date().toISOString() })
      drafts = optional(adapter.select(payload))
    } else if (args.agent === 'claude-code') {
      const adapter = new ClaudeCodeActivityAdapter(options)
      const snapshot = recovery?.snapshots.find((candidate) => candidate.mode === 'next-interaction')
      if (snapshot) adapter.armNextInteractionSnapshot({ requestId: snapshot.requestId, coverageStartedAt: new Date().toISOString() })
      drafts = adapter.selectMany(payload)
    } else {
      const adapter = new CodexActivityAdapter(options)
      const snapshot = recovery?.snapshots.find((candidate) => candidate.mode === 'next-interaction')
      if (snapshot) adapter.armNextInteractionSnapshot({ requestId: snapshot.requestId, coverageStartedAt: new Date().toISOString() })
      drafts = adapter.selectMany(payload)
    }
    if (!drafts.length) return 'ignored'
    stage = 'sanitize'
    const events = new ReporterSanitizer().sanitizeDraftBatch(drafts)
    stage = 'submit'
    await transport.submit(events)
    if (events.some((event) => event.observation.kind === 'snapshot')) return 'submitted:snapshot'
    if (recoveryFailure) return `submitted:recovery-unavailable:${recoveryFailure}`
    return recovery?.snapshots.length ? 'submitted:no-waiting-snapshot' : 'submitted'
  } catch { return `failed:${stage}` /* Hooks must never block or fail the agent's work. */ }
}

function argumentsFrom(values: string[]): { agent: 'codex-cli' | 'claude-code' | 'pi'; safeEvent?: string; safeEventBase64?: string } {
  const at = (name: string): string | undefined => { const prefixes = [`--${name}=`, `-${name}=`]; const equal = values.find((value) => prefixes.some((prefix) => value.startsWith(prefix))); if (equal) return equal.slice(equal.indexOf('=') + 1); const index = values.findIndex((value) => value === `--${name}` || value === `-${name}`); return index >= 0 ? values[index + 1] : undefined }
  const adapter = at('adapter') ?? at('Agent')
  const agent = adapter === 'pi' ? 'pi' : adapter === 'claude-code' ? 'claude-code' : adapter === 'codex-cli' ? 'codex-cli' : undefined
  if (!agent) throw new Error('ACTIVITY_ADAPTER_INVALID')
  return { agent, ...(at('safe-event') ? { safeEvent: at('safe-event') } : {}), ...(at('safe-event-base64') ? { safeEventBase64: at('safe-event-base64') } : {}) }
}
function versionFor(agent: 'codex-cli' | 'claude-code' | 'pi'): string { return agent === 'codex-cli' ? '0.144.3' : agent === 'claude-code' ? '2.1.207' : '0.80.3' }
function optional(value: ReporterEventDraft | null): ReporterEventDraft[] { return value ? [value] : [] }
async function readStdin(): Promise<string> { let value = ''; for await (const chunk of process.stdin) { value += String(chunk); if (Buffer.byteLength(value) > 2 * 1024 * 1024) throw new Error('HOOK_PAYLOAD_TOO_LARGE') } return value }
function safeRecoveryFailure(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) return code
  const message = error instanceof Error ? error.message : ''
  return /^ACTIVITY_RECOVERY_[A-Z_]+$/.test(message) ? message : 'UNKNOWN'
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) void runActivityHookReporter()
