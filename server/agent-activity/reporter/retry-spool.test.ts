import { describe, expect, it } from 'vitest'
import type { SecretStore } from '../../auth/secret-store.js'
import type { ReporterEventDraft } from './sanitizer.js'
import { ReporterSanitizer } from './sanitizer.js'
import { ResilientActivityReporter, RetrySpool, retrySpoolSecretRef } from './retry-spool.js'

class CapturingStore implements SecretStore {
  readonly values = new Map<string, string>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: string) { this.values.set(key, value) }
  async delete(key: string) { this.values.delete(key) }
  async has(key: string) { return this.values.has(key) }
}

let id = 0
function draft(kind: ReporterEventDraft['kind'], observedAt = '2026-07-14T23:00:00.000Z'): ReporterEventDraft {
  const terminal = kind === 'completed' || kind === 'failed' || kind === 'cancelled'
  return {
    eventId: `018f6f7e-6f52-7e54-8aa5-${String(++id).padStart(12, '0')}`, integrationId: 'manual:codex-cli', agent: 'codex-cli', adapterVersion: 'manual-1.0.0', agentVersion: null,
    originAssignmentId: 'retry-work-1', generation: 1, summary: { text: 'Safe queued work', source: 'explicit-user' }, projectRef: { kind: 'unassigned' },
    kind, ...(kind === 'heartbeat' ? { reportedState: 'active' as const } : {}), observedAt, evidenceKind: 'manual-command',
    ...(terminal ? { terminalEvidence: { kind: 'agent-explicit' as const, outcome: kind } } : {}),
  }
}

describe('RetrySpool', () => {
  it('coalesces heartbeats before sequence allocation and stores only validated V1 events in the protected store', async () => {
    const store = new CapturingStore(); const spool = new RetrySpool({ store, integrationId: 'manual:codex-cli', clock: () => new Date('2026-07-14T23:00:03.000Z') })
    await spool.enqueueDrafts([draft('started'), draft('heartbeat', '2026-07-14T23:00:01.000Z'), draft('heartbeat', '2026-07-14T23:00:02.000Z')], new ReporterSanitizer())
    expect(await spool.inspect()).toMatchObject({ eventCount: 2, gapCount: 0 })
    const serialized = store.values.get(retrySpoolSecretRef('manual:codex-cli')) ?? ''
    expect(serialized).toContain('findmnemo.assignment-event.v1')
    expect(serialized).not.toMatch(/prompt|response|transcript|reasoning|credential/i)
    expect(JSON.parse(serialized).events.map((entry: { event: { observation: { sequence: number } } }) => entry.event.observation.sequence)).toEqual([1, 2])
  })

  it('keeps strict bounds, prioritizes terminal events, records content-free gaps, and prunes seven-day-old entries', async () => {
    const store = new CapturingStore(); let now = new Date('2026-07-14T23:00:00.000Z')
    const spool = new RetrySpool({ store, integrationId: 'manual:codex-cli', clock: () => now, limits: { maxEvents: 2, maxBytes: 32 * 1024, maxAgeMs: 7 * 24 * 60 * 60_000 } })
    const sanitizer = new ReporterSanitizer()
    await spool.enqueueDrafts([draft('started'), draft('waiting'), draft('completed')], sanitizer)
    expect(await spool.inspect()).toMatchObject({ eventCount: 2, terminalCount: 1, gapCount: 1 })
    now = new Date('2026-07-22T23:00:01.000Z'); expect(await spool.inspect()).toMatchObject({ eventCount: 0, gapCount: 3 })
  })

  it('replays sequentially, clears duplicates, and stops visibly on gaps or revoked credentials', async () => {
    const store = new CapturingStore(); const spool = new RetrySpool({ store, integrationId: 'manual:codex-cli' })
    await spool.enqueueDrafts([draft('started'), draft('waiting'), draft('completed')], new ReporterSanitizer())
    const seen: number[] = []
    const result = await spool.replay(async (event) => { seen.push(event.observation.sequence); return event.observation.sequence === 1 ? { outcome: 'duplicate' } : { outcome: 'gap', reasonCode: 'SEQUENCE_GAP' } })
    expect(seen).toEqual([1, 2]); expect(result).toMatchObject({ removed: 1, remaining: 2, haltReason: 'gap' })
    const revoked = await spool.replay(async () => ({ outcome: 'rejected', reasonCode: 'ACTIVITY_AUTH_INVALID' }))
    expect(revoked).toMatchObject({ remaining: 2, haltReason: 'revoked' })
  })

  it.each([
    [{ outcome: 'conflict', reasonCode: 'SEQUENCE_CONFLICT' }, 'conflict'],
    [{ outcome: 'rejected', reasonCode: 'ACTIVITY_CAPABILITY_MISMATCH' }, 'unsupported-version'],
    [{ outcome: 'rejected', reasonCode: 'ACTIVITY_AUTH_INVALID' }, 'revoked'],
  ] as const)('keeps the queued event and exposes %s recovery state', async (receipt, haltReason) => {
    const spool = new RetrySpool({ store: new CapturingStore(), integrationId: 'manual:codex-cli' })
    await spool.enqueueDrafts([draft('started')], new ReporterSanitizer())
    expect(await spool.replay(async () => receipt)).toMatchObject({ removed: 0, remaining: 1, haltReason })
  })

  it('never throws into the originating hook and returns inside the 250 ms total budget', async () => {
    const spool = new RetrySpool({ store: new CapturingStore(), integrationId: 'manual:codex-cli' })
    const event = new ReporterSanitizer().sanitizeDraft(draft('started'))
    const reporter = new ResilientActivityReporter(spool)
    const started = performance.now(); const result = await reporter.submit(event, async () => new Promise(() => undefined)); const elapsed = performance.now() - started
    expect(result).toMatchObject({ delivered: false, queued: true })
    expect(elapsed).toBeGreaterThanOrEqual(140); expect(elapsed).toBeLessThan(250)
  })
})
