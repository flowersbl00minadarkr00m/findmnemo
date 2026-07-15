import { describe, expect, it, vi } from 'vitest'
import { ReporterSanitizer } from '../reporter/sanitizer.js'
import { PiActivityAdapter, PiHeartbeatController } from './pi-activity-adapter.js'

const base = {
  integrationId: 'pi-auto',
  agentVersion: '0.80.3',
  projectRef: { kind: 'approved-project', id: 'project-1' } as const,
  now: () => '2026-07-14T20:00:00.000Z',
  eventId: (() => { let value = 0; return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}` })(),
}

describe('Pi activity adapter', () => {
  it('selects only safe fields and maps the documented lifecycle conservatively', () => {
    const adapter = new PiActivityAdapter(base)
    const sanitizer = new ReporterSanitizer()
    const privateCanary = 'PRIVATE-CANARY-MUST-NOT-CROSS'
    const payload = (eventName: string) => ({
      event_name: eventName,
      session_id: 'pi-session-1',
      model: 'openai/gpt-5',
      prompt: privateCanary,
      context: [{ content: privateCanary }],
      messages: [{ text: privateCanary }],
      tool_results: [{ content: privateCanary }],
      session_file: `C:/private/${privateCanary}.jsonl`,
      reasoning: privateCanary,
      raw_rpc: { body: privateCanary },
    })

    const start = adapter.select(payload('session_start'))
    const before = adapter.select(payload('before_agent_start'))
    const active = adapter.select(payload('agent_start'))
    const ended = adapter.select(payload('agent_end'))
    const settled = adapter.select(payload('agent_settled'))
    const shutdown = adapter.select(payload('session_shutdown'))

    expect(start?.kind).toBe('snapshot')
    expect(start?.snapshot?.mode).toBe('current-session')
    expect(before?.kind).toBe('started')
    expect(active?.reportedState).toBe('active')
    expect(ended).toBeNull()
    expect(settled).toMatchObject({ kind: 'waiting', reportedState: 'waiting' })
    expect(shutdown).toBeNull()

    for (const draft of [start, before, active, settled]) {
      const event = sanitizer.sanitizeDraft(draft!)
      expect(JSON.stringify(event)).not.toContain(privateCanary)
      expect(event.assignment.originAssignmentId).toBe('pi-session-1')
      expect(event.observation.evidenceKind).toBe('pi-extension')
    }
  })

  it('uses explicit commands for terminal outcomes and rejects version mismatch', () => {
    const adapter = new PiActivityAdapter(base)
    expect(adapter.select({ event_name: 'complete', session_id: 'pi-session-1', explicit: true })?.terminalEvidence)
      .toEqual({ kind: 'agent-explicit', outcome: 'completed' })
    expect(adapter.select({ event_name: 'failed', session_id: 'pi-session-1', explicit: true })?.terminalEvidence)
      .toEqual({ kind: 'agent-explicit', outcome: 'failed' })
    expect(adapter.select({ event_name: 'cancelled', session_id: 'pi-session-1', explicit: true })?.terminalEvidence)
      .toEqual({ kind: 'agent-explicit', outcome: 'cancelled' })
    expect(() => new PiActivityAdapter({ ...base, agentVersion: '0.80.7' })).toThrow('PI_VERSION_UNSUPPORTED')
  })

  it('uses an armed management snapshot receipt on the next session start', () => {
    const adapter = new PiActivityAdapter(base)
    adapter.armCurrentSessionSnapshot({ requestId: 'requested-snapshot', coverageStartedAt: '2026-07-14T00:00:00.000Z' })
    const draft = adapter.select({ event_name: 'session_start', session_id: 'pi-session-1' })
    expect(draft?.snapshot).toEqual({ requestId: 'requested-snapshot', mode: 'current-session', coverageStartedAt: '2026-07-14T00:00:00.000Z' })
  })

  it('emits 45-second heartbeats only while active and stops cleanly', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const controller = new PiHeartbeatController(new PiActivityAdapter(base), send)
    controller.observe({ event_name: 'agent_start', session_id: 'pi-session-1' })
    vi.advanceTimersByTime(90_000)
    expect(send.mock.calls.filter(([draft]) => draft.kind === 'heartbeat')).toHaveLength(2)
    controller.observe({ event_name: 'agent_settled', session_id: 'pi-session-1' })
    vi.advanceTimersByTime(90_000)
    expect(send.mock.calls.filter(([draft]) => draft.kind === 'heartbeat')).toHaveLength(2)
    controller.shutdown()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
