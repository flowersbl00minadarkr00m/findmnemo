import type { AssignmentEventV1 } from '../../../shared/agent-activity-contract.js'
import type { ReporterEventDraft } from '../reporter/sanitizer.js'

const SUPPORTED_VERSION = '0.144.3'
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Notification'])

export interface CodexActivityAdapterOptions {
  integrationId: string
  agentVersion: string
  projectRef: AssignmentEventV1['assignment']['projectRef']
  now?: () => string
  eventId?: () => string
}

export class CodexActivityAdapter {
  private readonly options: CodexActivityAdapterOptions
  private snapshot: { requestId: string; coverageStartedAt: string } | undefined

  constructor(options: CodexActivityAdapterOptions) {
    if (normalizeVersion(options.agentVersion) !== SUPPORTED_VERSION) throw new Error('CODEX_VERSION_UNSUPPORTED')
    this.options = options
  }

  armNextInteractionSnapshot(snapshot: { requestId: string; coverageStartedAt: string }): void { this.snapshot = snapshot }

  selectMany(source: unknown): ReporterEventDraft[] {
    const lifecycle = this.select(source)
    if (!lifecycle) return []
    if (!this.snapshot) return [lifecycle]
    const snapshot = this.snapshot; this.snapshot = undefined
    return [lifecycle, { ...lifecycle, eventId: this.eventId(), kind: 'snapshot', reasonCode: undefined, evidenceKind: 'snapshot', snapshot: { requestId: snapshot.requestId, mode: 'next-interaction', coverageStartedAt: snapshot.coverageStartedAt } }]
  }

  select(source: unknown): ReporterEventDraft | null {
    const input = object(source)
    const eventName = string(input.hook_event_name)
    const sessionId = opaque(input.session_id)
    if (!eventName || !EVENTS.has(eventName) || !sessionId) throw new Error('CODEX_EVENT_INVALID')
    const base: ReporterEventDraft = {
      eventId: this.eventId(), integrationId: this.options.integrationId, agent: 'codex-cli', adapterVersion: '1.0.0', agentVersion: SUPPORTED_VERSION,
      originAssignmentId: sessionId, generation: positiveInteger(input.generation) ?? 1, projectRef: this.options.projectRef,
      kind: 'started', reportedState: 'active', observedAt: this.options.now?.() ?? new Date().toISOString(), evidenceKind: 'codex-hook',
      ...(safeModel(input.model) ? { modelLabel: safeModel(input.model) } : {}),
    }
    if (eventName === 'SessionStart') return { ...base, kind: 'accepted' }
    if (eventName === 'UserPromptSubmit') return base
    if (eventName === 'PreToolUse' || eventName === 'PostToolUse') return { ...base, kind: 'heartbeat' }
    if (eventName === 'PermissionRequest') return { ...base, kind: 'needs-action', reportedState: 'needs-action', reasonCode: 'permission' }
    return { ...base, kind: 'waiting', reportedState: 'waiting', reasonCode: 'explicit-wait' }
  }

  private eventId(): string { return this.options.eventId?.() ?? crypto.randomUUID() }
}

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CODEX_EVENT_INVALID'); return value as Record<string, unknown> }
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function opaque(value: unknown): string | undefined { const text = string(value); return text && /^[a-z0-9._:-]{1,160}$/i.test(text) ? text : undefined }
function safeModel(value: unknown): string | undefined { const text = string(value); return text && /^[a-z0-9._:/+-]{1,80}$/i.test(text) ? text : undefined }
function positiveInteger(value: unknown): number | undefined { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined }
function normalizeVersion(value: string): string { return value.match(/\d+\.\d+\.\d+/)?.[0] ?? value }
