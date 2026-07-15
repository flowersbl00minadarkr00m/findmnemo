import { randomUUID } from 'node:crypto'
import { get as httpGet } from 'node:http'
import type { AgentKind, AssignmentEventV1 } from '../../shared/agent-activity-contract.js'
import { manualReportDraft, type ManualReportInput, type ManualReportReceipt } from '../agent-activity/manual-reporting-service.js'
import type { SecretStore } from '../auth/secret-store.js'
import { ReporterSanitizer } from '../agent-activity/reporter/sanitizer.js'
import { ResilientActivityReporter, RetrySpool, type RetryReceipt } from '../agent-activity/reporter/retry-spool.js'

export type ManualActivityResult = ManualReportReceipt | { outcome: 'queued'; supportLevel: 'manual'; evidenceKind: 'mcp-tool' | 'manual-command'; queued: true }
export interface ManualActivityTransport { report(input: ManualReportInput): Promise<ManualActivityResult> }

export class HttpAssignmentEventTransport {
  private readonly spool: RetrySpool
  private readonly token: string
  private readonly integrationId: string
  private readonly baseUrl: string
  constructor(token: string, integrationId: string, store: SecretStore, baseUrl = 'http://127.0.0.1:3210/api/v1/integration/agent-activity') { this.token = token; this.integrationId = integrationId; this.baseUrl = baseUrl; this.spool = new RetrySpool({ store, integrationId }) }

  async submit(events: readonly AssignmentEventV1[]): Promise<void> {
    for (const event of events) {
      if (event.integrationId !== this.integrationId) throw new Error('ACTIVITY_INTEGRATION_MISMATCH')
      const result = await new ResilientActivityReporter(this.spool).submit(event, (candidate, signal) => this.send(candidate, signal))
      if (!result.delivered) continue
    }
  }

  async recovery(): Promise<{ assignments: Array<{ assignmentKey: string; expectedSequence: number }>; snapshots: Array<{ requestId: string; mode: string; state: string }> }> {
    const url = `${this.baseUrl}/recovery?integrationId=${encodeURIComponent(this.integrationId)}`
    const body = await loopbackJson(url, this.token) as { assignments?: unknown; snapshots?: unknown }
    if (!Array.isArray(body.assignments) || !Array.isArray(body.snapshots)) throw new Error('ACTIVITY_RECOVERY_INVALID')
    return body as { assignments: Array<{ assignmentKey: string; expectedSequence: number }>; snapshots: Array<{ requestId: string; mode: string; state: string }> }
  }

  private async send(input: AssignmentEventV1, signal: AbortSignal, allowRecovery = true): Promise<RetryReceipt> {
    const response = await fetch(`${this.baseUrl}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-findmnemo-activity-token': this.token }, body: JSON.stringify(input), signal, redirect: 'error' })
    const body = await response.json() as RetryReceipt & { expectedSequence?: number }
    if (response.status >= 500) throw new Error('ACTIVITY_COMPANION_UNAVAILABLE')
    if (allowRecovery && (body.reasonCode === 'SEQUENCE_CONFLICT' || body.reasonCode === 'REPLAY' || body.reasonCode === 'FIRST_SEQUENCE_REQUIRED') && Number.isSafeInteger(body.expectedSequence) && Number(body.expectedSequence) > 0 && !signal.aborted) {
      return this.send({ ...input, observation: { ...input.observation, sequence: Number(body.expectedSequence) } }, signal, false)
    }
    return body
  }
}

async function loopbackJson(urlValue: string, token: string): Promise<unknown> {
  const url = new URL(urlValue)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('ACTIVITY_RECOVERY_NON_LOOPBACK')
  return new Promise((resolve, reject) => {
    const request = httpGet(url, { headers: { 'x-findmnemo-activity-token': token } }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('ACTIVITY_RECOVERY_UNAVAILABLE')); return }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
        if (Buffer.byteLength(body) > 64 * 1024) request.destroy(new Error('ACTIVITY_RECOVERY_TOO_LARGE'))
      })
      response.on('end', () => {
        try { resolve(JSON.parse(body) as unknown) } catch { reject(new Error('ACTIVITY_RECOVERY_INVALID')) }
      })
    })
    request.setTimeout(5_000, () => request.destroy(new Error('ACTIVITY_RECOVERY_TIMEOUT')))
    request.on('error', reject)
  })
}

interface HttpManualActivityTransportOptions {
  integrationId: string
  agent: AgentKind
  store: SecretStore
  baseUrl?: string
  clock?: () => Date
}

export class HttpManualActivityTransport implements ManualActivityTransport {
  private readonly token: string
  private readonly baseUrl: string
  private readonly integrationId: string
  private readonly agent: AgentKind
  private readonly clock: () => Date
  private readonly sanitizer = new ReporterSanitizer()
  private readonly spool: RetrySpool

  constructor(token: string, options: HttpManualActivityTransportOptions) {
    this.token = token; this.integrationId = options.integrationId; this.agent = options.agent
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:3210/api/v1/integration/agent-activity'
    this.clock = options.clock ?? (() => new Date())
    this.spool = new RetrySpool({ store: options.store, integrationId: options.integrationId, clock: this.clock })
  }

  async report(input: ManualReportInput): Promise<ManualActivityResult> {
    if (input.integrationId !== this.integrationId || input.agent !== this.agent) throw new Error('ACTIVITY_INTEGRATION_MISMATCH')
    const observedAt = this.clock().toISOString()
    const snapshot = input.action === 'snapshot' && !input.snapshot
      ? { requestId: randomUUID(), mode: 'explicit-report' as const, coverageStartedAt: observedAt }
      : input.snapshot
    const event = this.sanitizer.sanitizeDraft(manualReportDraft(input, randomUUID(), observedAt, snapshot))
    const queued = await this.spool.inspect()
    if (queued.eventCount > 0) {
      await this.spool.enqueue(event)
      await this.spool.replay((candidate) => this.send(candidate, AbortSignal.timeout(150)), 1)
      return { outcome: 'queued', supportLevel: 'manual', evidenceKind: input.evidenceKind, queued: true }
    }
    const result = await new ResilientActivityReporter(this.spool).submit(event, (candidate, signal) => this.send(candidate, signal))
    if (result.delivered && result.receipt) return { ...result.receipt, supportLevel: 'manual', evidenceKind: input.evidenceKind } as ManualReportReceipt
    return { outcome: 'queued', supportLevel: 'manual', evidenceKind: input.evidenceKind, queued: true }
  }

  async replay() { return this.spool.replay((event) => this.send(event, AbortSignal.timeout(150))) }

  private async send(input: AssignmentEventV1, signal: AbortSignal, allowRecovery = true): Promise<RetryReceipt> {
    const response = await fetch(`${this.baseUrl}/events`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-findmnemo-activity-token': this.token }, body: JSON.stringify(input), signal, redirect: 'error',
    })
    const body = await response.json() as RetryReceipt & { expectedSequence?: number }
    if (response.status >= 500) throw new Error('ACTIVITY_COMPANION_UNAVAILABLE')
    if (allowRecovery && (body.reasonCode === 'SEQUENCE_CONFLICT' || body.reasonCode === 'REPLAY' || body.reasonCode === 'FIRST_SEQUENCE_REQUIRED') && Number.isSafeInteger(body.expectedSequence) && Number(body.expectedSequence) > 0 && !signal.aborted) {
      return this.send({ ...input, observation: { ...input.observation, sequence: Number(body.expectedSequence) } }, signal, false)
    }
    return body
  }
}
