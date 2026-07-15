import { describe, expect, it } from 'vitest'
import type { ReporterEventDraft } from './sanitizer.js'
import { ReporterSanitizer } from './sanitizer.js'

describe('ReporterSanitizer', () => {
  it('selects safe fields from full hook fixtures, coalesces heartbeats before sequencing, and never serializes source payloads', () => {
    const source = {
      event_id: '018f6f7e-6f52-7e54-8aa5-000000000001', session_id: 'session-private-origin', event: 'started', observed_at: '2026-07-14T20:00:00.000Z', model: 'gpt-5-codex',
      cwd: 'C:\\Users\\private\\secret-project', prompt: 'private prompt marker', response: 'private response marker', transcript_path: 'private transcript marker', reasoning: 'private reasoning marker', credential: 'credential-private-marker',
      toJSON() { throw new Error('source payload must never be serialized') },
    }
    const heartbeat = { ...source, toJSON: source.toJSON, event_id: '018f6f7e-6f52-7e54-8aa5-000000000002', event: 'heartbeat', observed_at: '2026-07-14T20:00:01.000Z' }
    const latestHeartbeat = { ...heartbeat, event_id: '018f6f7e-6f52-7e54-8aa5-000000000003', observed_at: '2026-07-14T20:00:02.000Z' }
    const sanitizer = new ReporterSanitizer()
    const events = sanitizer.sanitizeBatch([source, heartbeat, latestHeartbeat], selectCodex)

    expect(events).toHaveLength(2)
    expect(events.map((event) => [event.eventId, event.observation.sequence, event.observation.kind])).toEqual([
      ['018f6f7e-6f52-7e54-8aa5-000000000001', 1, 'started'],
      ['018f6f7e-6f52-7e54-8aa5-000000000003', 2, 'heartbeat'],
    ])
    expect(events[0]).toMatchObject({
      schema: 'findmnemo.assignment-event.v1', integrationId: 'integration-codex-1', agent: 'codex-cli', adapterVersion: '1.0.0', agentVersion: '0.144.3', modelLabel: 'gpt-5-codex',
      assignment: { summary: { text: 'Codex work — name this assignment', source: 'placeholder' }, projectRef: { kind: 'unassigned' } },
    })
    const serialized = JSON.stringify(events)
    for (const prohibited of ['secret-project', 'private prompt', 'private response', 'private transcript', 'private reasoning', 'private-credential']) expect(serialized).not.toContain(prohibited)
  })

  it('runs selected summaries through V1 minimization rather than forwarding unsafe text', () => {
    const sanitizer = new ReporterSanitizer()
    const event = sanitizer.sanitize({ event_id: '018f6f7e-6f52-7e54-8aa5-000000000004', session_id: 'session-2', event: 'started', observed_at: '2026-07-14T20:00:00.000Z', model: null }, (source): ReporterEventDraft => ({
      ...selectCodex(source),
      summary: { text: 'password=private-value-that-must-disappear', source: 'explicit-user' },
    }))
    expect(event.assignment.summary).toEqual({ text: 'Codex work — name this assignment', source: 'placeholder' })
    expect(JSON.stringify(event)).not.toContain('private-value')
  })
})

function selectCodex(value: unknown): ReporterEventDraft {
  const source = value as Record<string, unknown>
  return {
    eventId: String(source.event_id), integrationId: 'integration-codex-1', agent: 'codex-cli', adapterVersion: '1.0.0', agentVersion: '0.144.3',
    originAssignmentId: String(source.session_id), generation: 1, projectRef: { kind: 'unassigned' },
    kind: source.event === 'heartbeat' ? 'heartbeat' : 'started', observedAt: String(source.observed_at), evidenceKind: 'codex-hook',
    modelLabel: source.model === null ? null : String(source.model),
  }
}
