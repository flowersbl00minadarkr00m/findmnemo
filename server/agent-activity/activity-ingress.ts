import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ASSIGNMENT_EVENT_MAX_BYTES, parseAssignmentEventV1 } from '../../shared/agent-activity-contract.js'
import { readJsonBody, validLoopbackHost } from '../api/request-security.js'
import { sendJson } from '../api/http.js'
import type { SafeLogger } from '../observability/logger.js'
import type { AgentActivityRepository } from './agent-activity-repository.js'
import type { AgentActivityService } from './agent-activity-service.js'
import type { ActivityCapabilityRegistry } from './capability-manifests.js'
import type { IntegrationAuthService } from './integration-auth-service.js'
import type { ProjectAssociationService } from './project-association-service.js'
import type { SnapshotService } from './snapshot-service.js'
import type { AgentActivityRetentionService } from './retention-service.js'

const ROOT = '/api/v1/integration/agent-activity'
const INTEGRATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

export interface ActivityIngressDependencies {
  auth: IntegrationAuthService
  capabilities: ActivityCapabilityRegistry
  activities: AgentActivityService
  associations: ProjectAssociationService
  repository: AgentActivityRepository
  snapshots?: SnapshotService
  logger: SafeLogger
  retention?: AgentActivityRetentionService
  featureEnabled?: () => boolean
  clock?: () => Date
}

export class ActivityIngress {
  private readonly dependencies: ActivityIngressDependencies
  private readonly clock: () => Date
  private readonly limiter: IntegrationRateLimiter

  constructor(dependencies: ActivityIngressDependencies) {
    this.dependencies = dependencies
    this.clock = dependencies.clock ?? (() => new Date())
    this.limiter = new IntegrationRateLimiter(() => this.clock().getTime())
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith(`${ROOT}/`)) return false
    const startedAt = Date.now()
    if (!validActivityReporterRequest(request)) { this.reject(response, 403, 'ORIGIN_NOT_ALLOWED', startedAt); return true }
    try {
      if (url.pathname === `${ROOT}/events` && request.method === 'POST') await this.events(request, response, startedAt)
      else if (url.pathname === `${ROOT}/context/resolve` && request.method === 'POST') await this.context(request, response, startedAt)
      else if (url.pathname === `${ROOT}/recovery` && request.method === 'GET') await this.recovery(request, response, url, startedAt)
      else this.reject(response, 405, 'ACTIVITY_METHOD_NOT_ALLOWED', startedAt)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      if (message === 'REQUEST_TOO_LARGE') this.reject(response, 413, 'ACTIVITY_REQUEST_TOO_LARGE', startedAt)
      else if (message === 'ACTIVITY_CAPABILITY_MISMATCH' || message === 'ACTIVITY_CAPABILITY_UNSUPPORTED') this.reject(response, 409, 'ACTIVITY_CAPABILITY_MISMATCH', startedAt)
      else this.reject(response, 400, 'ACTIVITY_REQUEST_INVALID', startedAt)
    }
    return true
  }

  private async events(request: IncomingMessage, response: ServerResponse, startedAt: number): Promise<void> {
    const body = await readJsonBody(request, ASSIGNMENT_EVENT_MAX_BYTES)
    const integrationId = integrationIdFrom(body.integrationId)
    if (!await this.authenticate(request, integrationId, response, startedAt) || !this.captureEnabled(integrationId, response, startedAt) || !this.allow(integrationId, response, startedAt)) return
    const parsed = parseAssignmentEventV1(body)
    this.dependencies.capabilities.validate(parsed.event)
    const receipt = this.dependencies.activities.ingestValidated(parsed.event, parsed.receiptCodes)
    if (receipt.outcome === 'applied') {
      try { this.dependencies.retention?.prune() }
      catch { void this.dependencies.logger.write({ level: 'error', code: 'ACTIVITY_RETENTION_FAILED', sourceId: 'agent-activity', agentKind: parsed.event.agent, adapterVersion: parsed.event.adapterVersion }).catch(() => undefined) }
    }
    if (parsed.event.snapshot && this.dependencies.snapshots) this.dependencies.snapshots.recordEvent({ integrationId: parsed.event.integrationId, ...parsed.event.snapshot }, receipt.outcome, receipt.reasonCode)
    const outcome = receipt.outcome === 'applied' || receipt.outcome === 'duplicate' || receipt.outcome === 'gap' ? receipt.outcome : 'rejected'
    const safe = {
      requestId: randomUUID(), outcome,
      assignmentKey: receipt.assignmentKey,
      ticketId: receipt.ticketId,
      ...(receipt.expectedSequence === undefined ? {} : { expectedSequence: receipt.expectedSequence }),
      ...(receipt.reasonCode === undefined ? {} : { reasonCode: receipt.reasonCode }),
    }
    sendJson(response, outcome === 'rejected' ? 409 : 200, safe)
    this.log(outcome === 'rejected' ? 'ACTIVITY_INGRESS_REJECTED' : 'ACTIVITY_INGRESS_ACCEPTED', outcome === 'rejected' ? 409 : 200, startedAt, { agentKind: parsed.event.agent, adapterVersion: parsed.event.adapterVersion, activityOutcome: outcome, reasonCode: receipt.reasonCode })
  }

  private async context(request: IncomingMessage, response: ServerResponse, startedAt: number): Promise<void> {
    const body = await readJsonBody(request, 4 * 1024)
    const integrationId = integrationIdFrom(body.integrationId)
    if (!await this.authenticate(request, integrationId, response, startedAt) || !this.captureEnabled(integrationId, response, startedAt) || !this.allow(integrationId, response, startedAt)) return
    if (Object.keys(body).some((key) => key !== 'integrationId' && key !== 'cwd') || typeof body.cwd !== 'string') throw new Error('ACTIVITY_CONTEXT_INVALID')
    sendJson(response, 200, this.dependencies.associations.resolveContext({ integrationId, cwd: body.cwd }))
    this.log('ACTIVITY_CONTEXT_RESOLVED', 200, startedAt)
  }

  private async recovery(request: IncomingMessage, response: ServerResponse, url: URL, startedAt: number): Promise<void> {
    const integrationId = integrationIdFrom(url.searchParams.get('integrationId'))
    if (!await this.authenticate(request, integrationId, response, startedAt) || !this.captureEnabled(integrationId, response, startedAt) || !this.allow(integrationId, response, startedAt)) return
    sendJson(response, 200, this.dependencies.repository.recovery(integrationId))
    this.log('ACTIVITY_RECOVERY_READ', 200, startedAt)
  }

  private async authenticate(request: IncomingMessage, integrationId: string, response: ServerResponse, startedAt: number): Promise<boolean> {
    if (await this.dependencies.auth.verify(integrationId, header(request, 'x-findmnemo-activity-token'))) return true
    this.reject(response, 401, 'ACTIVITY_AUTH_INVALID', startedAt)
    return false
  }

  private allow(integrationId: string, response: ServerResponse, startedAt: number): boolean {
    if (this.limiter.take(integrationId)) return true
    this.reject(response, 429, 'ACTIVITY_RATE_LIMITED', startedAt)
    return false
  }

  private captureEnabled(integrationId: string, response: ServerResponse, startedAt: number): boolean {
    if (integrationId.startsWith('manual:') || !this.dependencies.featureEnabled || this.dependencies.featureEnabled()) return true
    this.reject(response, 503, 'ACTIVITY_CAPTURE_DISABLED', startedAt)
    return false
  }

  private reject(response: ServerResponse, status: number, reasonCode: string, startedAt: number): void {
    sendJson(response, status, { requestId: randomUUID(), outcome: 'rejected', reasonCode })
    this.log('ACTIVITY_INGRESS_REJECTED', status, startedAt)
  }

  private log(code: string, status: number, startedAt: number, activity: Pick<import('../observability/logger.js').SafeLogEvent, 'agentKind' | 'adapterVersion' | 'activityOutcome' | 'reasonCode'> = {}): void {
    void this.dependencies.logger.write({ level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', code, sourceId: 'agent-activity', status, durationMs: Date.now() - startedAt, ...activity }).catch(() => undefined)
  }
}

class IntegrationRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>()
  private readonly now: () => number

  constructor(now: () => number) { this.now = now }

  take(integrationId: string): boolean {
    const now = this.now()
    const current = this.buckets.get(integrationId) ?? { tokens: 30, updatedAt: now }
    const tokens = Math.min(30, current.tokens + Math.max(0, now - current.updatedAt) * (120 / 60_000))
    if (tokens < 1) { this.buckets.set(integrationId, { tokens, updatedAt: now }); return false }
    this.buckets.set(integrationId, { tokens: tokens - 1, updatedAt: now })
    return true
  }
}

export function validActivityReporterRequest(request: IncomingMessage): boolean {
  if (!validLoopbackHost(request)) return false
  const site = header(request, 'sec-fetch-site')
  const origin = header(request, 'origin')
  if (site === 'cross-site') return false
  if (!origin) return site === undefined || site === 'same-origin'
  return origin === `http://${request.headers.host}` && site === 'same-origin'
}

function integrationIdFrom(value: unknown): string {
  if (typeof value !== 'string' || !INTEGRATION_ID.test(value)) throw new Error('ACTIVITY_INTEGRATION_ID_INVALID')
  return value
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}
