import { createHash } from 'node:crypto'
import { parseAssignmentEventV1, type AssignmentEventV1 } from '../../../shared/agent-activity-contract.js'
import type { SecretStore } from '../../auth/secret-store.js'
import { ReporterSanitizer, type ReporterEventDraft } from './sanitizer.js'

const DEFAULT_LIMITS = { maxEvents: 512, maxBytes: 2 * 1024 * 1024, maxAgeMs: 7 * 24 * 60 * 60_000 }
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 60_000, 300_000] as const

interface RetrySpoolOptions {
  store: SecretStore
  integrationId: string
  clock?: () => Date
  random?: () => number
  limits?: Partial<typeof DEFAULT_LIMITS>
}

interface StoredEvent { event: AssignmentEventV1; enqueuedAt: string; terminal: boolean }
interface StoredSpool { version: 1; integrationId: string; events: StoredEvent[]; gapCount: number; lastGapAt: string | null; attempts: number }
export interface RetryReceipt { outcome: string; reasonCode?: string }
export interface RetryInspection { eventCount: number; terminalCount: number; gapCount: number; totalBytes: number; oldestAt: string | null }
export interface ReplayResult { removed: number; remaining: number; haltReason: 'gap' | 'conflict' | 'unsupported-version' | 'revoked' | 'rejected' | 'unavailable' | null; retryAfterMs: number | null }

export class RetrySpool {
  private readonly store: SecretStore
  private readonly integrationId: string
  private readonly clock: () => Date
  private readonly random: () => number
  private readonly limits: typeof DEFAULT_LIMITS
  private readonly key: string

  constructor(options: RetrySpoolOptions) {
    this.store = options.store
    this.integrationId = options.integrationId
    this.clock = options.clock ?? (() => new Date())
    this.random = options.random ?? Math.random
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    this.key = retrySpoolSecretRef(options.integrationId)
  }

  async enqueueDrafts(drafts: readonly ReporterEventDraft[], sanitizer: ReporterSanitizer): Promise<AssignmentEventV1[]> {
    const events = sanitizer.sanitizeDraftBatch(drafts)
    for (const event of events) await this.enqueue(event)
    return events
  }

  async enqueue(input: AssignmentEventV1): Promise<void> {
    const event = parseAssignmentEventV1(input).event
    if (event.integrationId !== this.integrationId) throw new Error('RETRY_INTEGRATION_MISMATCH')
    const spool = await this.load()
    this.pruneExpired(spool)
    if (!spool.events.some((entry) => entry.event.eventId === event.eventId)) {
      spool.events.push({ event, enqueuedAt: this.clock().toISOString(), terminal: terminal(event) })
    }
    this.enforceBounds(spool)
    spool.attempts = 0
    await this.save(spool)
  }

  async inspect(): Promise<RetryInspection> {
    const spool = await this.load()
    if (this.pruneExpired(spool)) await this.save(spool)
    const serialized = JSON.stringify(spool)
    return {
      eventCount: spool.events.length, terminalCount: spool.events.filter((entry) => entry.terminal).length,
      gapCount: spool.gapCount, totalBytes: Buffer.byteLength(serialized, 'utf8'), oldestAt: spool.events[0]?.enqueuedAt ?? null,
    }
  }

  async replay(send: (event: AssignmentEventV1) => Promise<RetryReceipt>, maxEvents = Number.POSITIVE_INFINITY): Promise<ReplayResult> {
    const spool = await this.load()
    this.pruneExpired(spool)
    let removed = 0
    while (spool.events.length && removed < maxEvents) {
      let receipt: RetryReceipt
      try { receipt = await send(spool.events[0].event) }
      catch {
        spool.attempts += 1
        await this.save(spool)
        return { removed, remaining: spool.events.length, haltReason: 'unavailable', retryAfterMs: jitter(backoff(spool.attempts), this.random()) }
      }
      if (receipt.outcome === 'applied' || receipt.outcome === 'duplicate') {
        spool.events.shift(); removed += 1; spool.attempts = 0; await this.save(spool); continue
      }
      const haltReason = classifyHalt(receipt)
      if (haltReason === 'unavailable') spool.attempts += 1
      await this.save(spool)
      return { removed, remaining: spool.events.length, haltReason, retryAfterMs: haltReason === 'unavailable' ? jitter(backoff(spool.attempts), this.random()) : null }
    }
    await this.save(spool)
    return { removed, remaining: 0, haltReason: null, retryAfterMs: null }
  }

  async clear(): Promise<void> { await this.store.delete(this.key) }

  private async load(): Promise<StoredSpool> {
    const value = await this.store.get(this.key)
    if (!value) return empty(this.integrationId)
    try {
      const parsed = JSON.parse(value) as StoredSpool
      if (parsed.version !== 1 || parsed.integrationId !== this.integrationId || !Array.isArray(parsed.events) || !Number.isSafeInteger(parsed.gapCount) || !Number.isSafeInteger(parsed.attempts)) throw new Error('invalid')
      parsed.events = parsed.events.map((entry) => ({ event: parseAssignmentEventV1(entry.event).event, enqueuedAt: validTime(entry.enqueuedAt), terminal: terminal(entry.event) }))
      return parsed
    } catch {
      await this.store.delete(this.key)
      return empty(this.integrationId)
    }
  }

  private async save(spool: StoredSpool): Promise<void> {
    if (!spool.events.length && spool.gapCount === 0) { await this.store.delete(this.key); return }
    await this.store.set(this.key, JSON.stringify(spool))
  }

  private pruneExpired(spool: StoredSpool): boolean {
    const cutoff = this.clock().getTime() - this.limits.maxAgeMs
    const before = spool.events.length
    spool.events = spool.events.filter((entry) => Date.parse(entry.enqueuedAt) >= cutoff)
    const removed = before - spool.events.length
    if (removed) this.gap(spool, removed)
    return removed > 0
  }

  private enforceBounds(spool: StoredSpool): void {
    while (spool.events.length > this.limits.maxEvents || Buffer.byteLength(JSON.stringify(spool), 'utf8') > this.limits.maxBytes) {
      const nonTerminal = spool.events.findIndex((entry) => !entry.terminal)
      const index = nonTerminal >= 0 ? nonTerminal : 0
      spool.events.splice(index, 1)
      this.gap(spool, 1)
      if (!spool.events.length) break
    }
    while (Buffer.byteLength(JSON.stringify(spool), 'utf8') > this.limits.maxBytes && spool.gapCount > 0) {
      spool.lastGapAt = null
      if (Buffer.byteLength(JSON.stringify(spool), 'utf8') <= this.limits.maxBytes) break
      spool.gapCount = 0
    }
  }

  private gap(spool: StoredSpool, count: number): void {
    spool.gapCount += count
    spool.lastGapAt = this.clock().toISOString()
  }
}

export class ResilientActivityReporter {
  private readonly spool: RetrySpool
  constructor(spool: RetrySpool) { this.spool = spool }

  async submit(event: AssignmentEventV1, send: (event: AssignmentEventV1, signal: AbortSignal) => Promise<RetryReceipt>): Promise<{ delivered: boolean; queued: boolean; outcome: string; receipt?: RetryReceipt }> {
    const started = Date.now()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const receipt = await Promise.race([
        send(event, controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('ACTIVITY_REPORT_TIMEOUT')) }, 150) }),
      ])
      if (receipt.outcome === 'applied' || receipt.outcome === 'duplicate') return { delivered: true, queued: false, outcome: receipt.outcome, receipt }
    } catch { /* queue the already-sanitized event */ }
    finally { if (timer) clearTimeout(timer) }
    const queue = this.spool.enqueue(event).catch(() => undefined)
    const remaining = Math.max(1, 245 - (Date.now() - started))
    await Promise.race([queue, new Promise<void>((resolve) => setTimeout(resolve, remaining))])
    return { delivered: false, queued: true, outcome: 'queued' }
  }
}

export function retrySpoolSecretRef(integrationId: string): string {
  const digest = createHash('sha256').update(integrationId, 'utf8').digest('hex').slice(0, 32)
  return `agent-activity.retry.${digest}.spool.v1`
}

function empty(integrationId: string): StoredSpool { return { version: 1, integrationId, events: [], gapCount: 0, lastGapAt: null, attempts: 0 } }
function terminal(event: AssignmentEventV1): boolean { return event.observation.kind === 'completed' || event.observation.kind === 'failed' || event.observation.kind === 'cancelled' }
function validTime(value: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error('invalid'); return value }
function backoff(attempt: number): number { return BACKOFF_MS[Math.min(BACKOFF_MS.length - 1, Math.max(0, attempt - 1))] }
function jitter(value: number, random: number): number { return Math.round(value * (0.9 + Math.min(1, Math.max(0, random)) * 0.2)) }
function classifyHalt(receipt: RetryReceipt): ReplayResult['haltReason'] {
  if (receipt.outcome === 'gap' || receipt.reasonCode === 'SEQUENCE_GAP') return 'gap'
  if (receipt.reasonCode === 'ACTIVITY_AUTH_INVALID') return 'revoked'
  if (receipt.reasonCode === 'ACTIVITY_CAPABILITY_MISMATCH' || receipt.reasonCode === 'UNSUPPORTED_SCHEMA') return 'unsupported-version'
  if (receipt.outcome === 'conflict' || receipt.reasonCode === 'SEQUENCE_CONFLICT' || receipt.reasonCode === 'REPLAY' || receipt.reasonCode === 'TERMINAL_CONFLICT') return 'conflict'
  return receipt.outcome === 'unavailable' ? 'unavailable' : 'rejected'
}
