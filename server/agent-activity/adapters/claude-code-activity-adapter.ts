import type { AssignmentEventV1 } from '../../../shared/agent-activity-contract.js'
import type { ReporterEventDraft } from '../reporter/sanitizer.js'

const SUPPORTED_VERSION = '2.1.207'
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'StopFailure', 'SessionEnd', 'TaskCreated', 'TaskCompleted'])

export interface ClaudeCodeActivityAdapterOptions {
  integrationId: string
  agentVersion: string
  projectRef: AssignmentEventV1['assignment']['projectRef']
  now?: () => string
  eventId?: () => string
}

export class ClaudeCodeActivityAdapter {
  private readonly options: ClaudeCodeActivityAdapterOptions
  private snapshot: { requestId: string; coverageStartedAt: string } | undefined

  constructor(options: ClaudeCodeActivityAdapterOptions) {
    if (normalizeVersion(options.agentVersion) !== SUPPORTED_VERSION) throw new Error('CLAUDE_VERSION_UNSUPPORTED')
    this.options = options
  }

  armNextInteractionSnapshot(snapshot: { requestId: string; coverageStartedAt: string }): void { this.snapshot = snapshot }

  selectMany(source: unknown): ReporterEventDraft[] {
    const lifecycle = this.select(source)
    if (!lifecycle) return []
    if (!this.snapshot) return [lifecycle]
    const snapshot = this.snapshot
    this.snapshot = undefined
    return [lifecycle, {
      ...lifecycle,
      eventId: this.eventId(),
      kind: 'snapshot',
      reportedState: lifecycle.reportedState ?? 'active',
      reasonCode: undefined,
      terminalEvidence: undefined,
      evidenceKind: 'snapshot',
      snapshot: { requestId: snapshot.requestId, mode: 'next-interaction', coverageStartedAt: snapshot.coverageStartedAt },
    }]
  }

  select(source: unknown): ReporterEventDraft | null {
    const input = object(source)
    const eventName = string(input.hook_event_name)
    const sessionId = opaque(input.session_id)
    if (!eventName || !EVENTS.has(eventName) || !sessionId) throw new Error('CLAUDE_EVENT_INVALID')
    if (eventName === 'SessionEnd') return null
    const taskId = opaque(input.task_id)
    if ((eventName === 'TaskCreated' || eventName === 'TaskCompleted') && !taskId) return null
    const taskEvent = eventName === 'TaskCreated' || eventName === 'TaskCompleted'
    const base: ReporterEventDraft = {
      eventId: this.eventId(), integrationId: this.options.integrationId, agent: 'claude-code', adapterVersion: '1.0.0', agentVersion: SUPPORTED_VERSION,
      originAssignmentId: taskEvent ? taskId! : sessionId, generation: positiveInteger(input.generation) ?? 1,
      ...(taskEvent && safeSubject(input.task_subject) ? { summary: { text: safeSubject(input.task_subject)!, source: 'claude-task-subject' } } : {}),
      projectRef: this.options.projectRef, kind: 'started', reportedState: 'active', observedAt: this.now(),
      evidenceKind: taskEvent ? 'claude-task-hook' : 'claude-hook', ...(safeModel(input.model) ? { modelLabel: safeModel(input.model) } : {}),
    }
    if (eventName === 'SessionStart') return { ...base, kind: 'accepted' }
    if (eventName === 'UserPromptSubmit') return base
    if (eventName === 'Stop') return { ...base, kind: 'waiting', reportedState: 'waiting', reasonCode: 'explicit-wait' }
    if (eventName === 'StopFailure') return { ...base, kind: 'blocked', reportedState: 'blocked', reasonCode: 'agent-api-error' }
    if (eventName === 'Notification') return notification(base, input.notification_type)
    if (eventName === 'TaskCreated') return { ...base, kind: 'accepted' }
    return { ...base, kind: 'completed', reportedState: undefined, terminalEvidence: { kind: 'claude-task-completed', outcome: 'completed' } }
  }

  private now(): string { return this.options.now?.() ?? new Date().toISOString() }
  private eventId(): string { return this.options.eventId?.() ?? crypto.randomUUID() }
}

function notification(base: ReporterEventDraft, category: unknown): ReporterEventDraft | null {
  if (category === 'permission_prompt' || category === 'elicitation_dialog') return { ...base, kind: 'needs-action', reportedState: 'needs-action', reasonCode: 'input-required' }
  if (category === 'idle_prompt') return { ...base, kind: 'waiting', reportedState: 'waiting', reasonCode: 'explicit-wait' }
  return null
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CLAUDE_EVENT_INVALID'); return value as Record<string, unknown> }
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function opaque(value: unknown): string | undefined { const text = string(value); return text && /^[a-z0-9._:-]{1,160}$/i.test(text) ? text : undefined }
function safeModel(value: unknown): string | undefined { const text = string(value); return text && /^[a-z0-9._:/+-]{1,80}$/i.test(text) ? text : undefined }
function safeSubject(value: unknown): string | undefined { const text = string(value)?.trim(); return text && ![...text].some((character) => (character.codePointAt(0) ?? 0) < 32) ? [...text].slice(0, 160).join('') : undefined }
function positiveInteger(value: unknown): number | undefined { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined }
function normalizeVersion(value: string): string { return value.match(/\d+\.\d+\.\d+/)?.[0] ?? value }
