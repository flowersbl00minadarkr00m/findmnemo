import type { AssignmentEventV1, TerminalOutcome } from '../../../shared/agent-activity-contract.js'
import type { ReporterEventDraft } from '../reporter/sanitizer.js'

const SUPPORTED_VERSION = '0.80.3'
const SAFE_EVENTS = new Set(['session_start', 'before_agent_start', 'agent_start', 'agent_end', 'agent_settled', 'session_shutdown', 'heartbeat', 'complete', 'failed', 'cancelled'])

export interface PiActivityAdapterOptions {
  integrationId: string
  agentVersion: string
  projectRef: AssignmentEventV1['assignment']['projectRef']
  now?: () => string
  eventId?: () => string
}

export class PiActivityAdapter {
  readonly heartbeatMilliseconds = 45_000
  readonly freshnessWindowSeconds = 120
  private readonly options: Required<Pick<PiActivityAdapterOptions, 'integrationId' | 'agentVersion' | 'projectRef'>> & Pick<PiActivityAdapterOptions, 'now' | 'eventId'>
  private snapshot: { requestId: string; coverageStartedAt: string } | undefined

  constructor(options: PiActivityAdapterOptions) {
    if (normalizeVersion(options.agentVersion) !== SUPPORTED_VERSION) throw new Error('PI_VERSION_UNSUPPORTED')
    this.options = options
  }

  armCurrentSessionSnapshot(snapshot: { requestId: string; coverageStartedAt: string }): void { this.snapshot = snapshot }

  select(source: unknown): ReporterEventDraft | null {
    const input = object(source)
    const eventName = string(input.event_name)
    const sessionId = opaque(input.session_id)
    if (!eventName || !SAFE_EVENTS.has(eventName) || !sessionId) throw new Error('PI_EVENT_INVALID')
    if (eventName === 'agent_end' || eventName === 'session_shutdown') return null
    const observedAt = this.options.now?.() ?? new Date().toISOString()
    const base: ReporterEventDraft = {
      eventId: this.options.eventId?.() ?? crypto.randomUUID(),
      integrationId: this.options.integrationId,
      agent: 'pi',
      adapterVersion: '1.0.0',
      agentVersion: SUPPORTED_VERSION,
      originAssignmentId: sessionId,
      generation: positiveInteger(input.generation) ?? 1,
      projectRef: this.options.projectRef,
      kind: 'started',
      reportedState: 'active',
      observedAt,
      evidenceKind: 'pi-extension',
      ...(safeModel(input.model) ? { modelLabel: safeModel(input.model) } : {}),
    }
    if (eventName === 'session_start') {
      const snapshot = this.snapshot ?? { requestId: `pi-${eventIdFragment(base.eventId)}`, coverageStartedAt: observedAt }
      this.snapshot = undefined
      return { ...base, kind: 'snapshot', snapshot: { requestId: snapshot.requestId, mode: 'current-session', coverageStartedAt: snapshot.coverageStartedAt } }
    }
    if (eventName === 'before_agent_start' || eventName === 'agent_start') return base
    if (eventName === 'heartbeat') return { ...base, kind: 'heartbeat' }
    if (eventName === 'agent_settled') return { ...base, kind: 'waiting', reportedState: 'waiting', reasonCode: 'explicit-wait' }
    if (input.explicit !== true) throw new Error('PI_TERMINAL_NOT_EXPLICIT')
    const outcome = ({ complete: 'completed', failed: 'failed', cancelled: 'cancelled' } as const)[eventName as 'complete' | 'failed' | 'cancelled']
    return terminal(base, outcome)
  }
}

export class PiHeartbeatController {
  private readonly adapter: PiActivityAdapter
  private readonly send: (draft: ReporterEventDraft) => void
  private timer: ReturnType<typeof setInterval> | undefined
  private current: { sessionId: string; model?: string } | undefined

  constructor(adapter: PiActivityAdapter, send: (draft: ReporterEventDraft) => void) { this.adapter = adapter; this.send = send }

  observe(source: unknown): void {
    const input = object(source)
    const eventName = string(input.event_name)
    const draft = this.adapter.select(source)
    if (draft) this.send(draft)
    if ((eventName === 'before_agent_start' || eventName === 'agent_start') && draft) {
      this.current = { sessionId: draft.originAssignmentId, ...(draft.modelLabel ? { model: draft.modelLabel } : {}) }
      this.start()
    } else if (eventName === 'agent_settled' || eventName === 'session_shutdown') this.stop()
  }

  shutdown(): void { this.stop() }

  private start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      if (!this.current) return
      const draft = this.adapter.select({ event_name: 'heartbeat', session_id: this.current.sessionId, ...(this.current.model ? { model: this.current.model } : {}) })
      if (draft) this.send(draft)
    }, this.adapter.heartbeatMilliseconds)
  }

  private stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.current = undefined }
}

function terminal(base: ReporterEventDraft, outcome: TerminalOutcome): ReporterEventDraft {
  return { ...base, kind: outcome, reportedState: undefined, terminalEvidence: { kind: 'agent-explicit', outcome } }
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PI_EVENT_INVALID'); return value as Record<string, unknown> }
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function opaque(value: unknown): string | undefined { const text = string(value); return text && /^[a-z0-9._:-]{1,160}$/i.test(text) ? text : undefined }
function safeModel(value: unknown): string | undefined { const text = string(value); return text && /^[a-z0-9._:/+-]{1,80}$/i.test(text) ? text : undefined }
function positiveInteger(value: unknown): number | undefined { return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined }
function normalizeVersion(value: string): string { return value.match(/\d+\.\d+\.\d+/)?.[0] ?? value }
function eventIdFragment(value: string): string { return value.replace(/[^a-z0-9]/gi, '').slice(-32) }
