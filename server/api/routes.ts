import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, relative, resolve } from 'node:path'
import {
  COMPANION_PROTOCOL_VERSION,
  SOURCE_IDS,
  type CompanionIdentityDto,
  type OperationalPolicyMigrationPreview,
  type OperationalRoutingPolicy,
  isRoutingClassificationSource,
  type RoutingRequestOverride,
  type SourceId,
} from '../../shared/companion-contract.js'
import { apiFailure, apiSuccess, sendJson } from './http.js'
import type { PairingService } from '../auth/pairing-service.js'
import { assertPrivateBoundary, type OperationalRepository, type StoredTicket } from '../db/operational-repository.js'
import type { GmailServices } from '../gmail/gmail-services.js'
import type { GmailCheckService } from '../gmail/gmail-source.js'
import type { ReconciliationEngine } from '../reconciliation/engine.js'
import type { SafeLogger } from '../observability/logger.js'
import type { SourceRunCapabilityReport } from '../../shared/companion-contract.js'
import { createDiagnosticExport } from '../diagnostics/export.js'
import type { RoutingRepository } from '../routing/routing-repository.js'
import type { DiscoveryService } from '../routing/discovery-service.js'
import type { PiRoutingAdapter } from '../routing/adapters/pi-rpc-adapter.js'
import type { DispatchService } from '../routing/dispatch-service.js'
import type { RoutingIntegrationApi } from '../routing/integration-api.js'
import {
  allowedOrigin,
  applyCors,
  bearerToken,
  readJsonBody,
  validFetchMetadata,
  validLoopbackHost,
  type RequestSecurityOptions,
} from './request-security.js'

export interface RouteDependencies {
  distPath: string
  identity: CompanionIdentityDto
  clock: () => Date
  pairingService: PairingService
  security?: RequestSecurityOptions
  localBootstrapNonce: string
  databasePath: string
  operationalRepository: OperationalRepository
  routingRepository: RoutingRepository
  discoveryService: DiscoveryService
  piRoutingAdapter: PiRoutingAdapter
  dispatchService: DispatchService
  routingIntegrationApi?: RoutingIntegrationApi
  gmailServices: GmailServices
  gmailCheckService: GmailCheckService
  reconciliationEngine: ReconciliationEngine
  logger: SafeLogger
  capabilityReport: SourceRunCapabilityReport
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export function createRequestHandler(dependencies: RouteDependencies) {
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const startedAt = Date.now()
    response.once('finish', () => {
      void dependencies.logger.write({ level: response.statusCode >= 500 ? 'error' : response.statusCode >= 400 ? 'warn' : 'info', code: response.statusCode >= 500 ? 'HTTP_ERROR' : 'HTTP_REQUEST', route: url.pathname, status: response.statusCode, durationMs: Date.now() - startedAt })
        .catch(() => undefined)
    })
    if (url.pathname.startsWith('/api/v1/')) {
      await handleApi(request, response, url, dependencies)
      return
    }
    await serveSpa(response, url.pathname, dependencies.distPath, () => dependencies.pairingService.issueLocalBootstrap())
  }
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: RouteDependencies,
): Promise<void> {
  if (!validLoopbackHost(request) || !validFetchMetadata(request)) {
    sendJson(response, 403, apiFailure({ code: 'ORIGIN_NOT_ALLOWED', message: 'Companion request origin was rejected.', retryable: false }))
    return
  }
  const origin = allowedOrigin(request, dependencies.security)
  if (!origin) {
    sendJson(response, 403, apiFailure({ code: 'ORIGIN_NOT_ALLOWED', message: 'Companion request origin was rejected.', retryable: false }))
    return
  }
  applyCors(response, origin)
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const requestedProtocol = request.headers['x-findmnemo-protocol-version']
  if (requestedProtocol !== COMPANION_PROTOCOL_VERSION) {
    sendJson(response, 426, apiFailure({
      code: 'UNSUPPORTED_PROTOCOL_VERSION',
      message: `Companion protocol ${COMPANION_PROTOCOL_VERSION} is required.`,
      retryable: false,
    }))
    return
  }

  if (url.pathname === '/api/v1/identity' && request.method === 'GET') {
    sendJson(response, 200, apiSuccess(dependencies.identity))
    return
  }

  if (url.pathname === '/api/v1/integration/routing/recommend' && request.method === 'POST') {
    if (!dependencies.routingIntegrationApi) { sendJson(response, 503, apiFailure({ code: 'CREDENTIAL_STORE_UNAVAILABLE', message: 'Routing integration credentials are unavailable.', retryable: true })); return }
    try {
      const body = await readJsonBody(request)
      const input = routingInput(body)
      sendJson(response, 200, apiSuccess(await dependencies.routingIntegrationApi.recommend(headerString(request, 'x-findmnemo-routing-token'), input)))
    } catch (cause) { integrationFailure(response, cause) }
    return
  }

  if (url.pathname === '/api/v1/integration/routing/dispatch' && request.method === 'POST') {
    if (!dependencies.routingIntegrationApi) { sendJson(response, 503, apiFailure({ code: 'CREDENTIAL_STORE_UNAVAILABLE', message: 'Routing integration credentials are unavailable.', retryable: true })); return }
    try {
      const body = await readJsonBody(request)
      const input = routingInput(body)
      if (typeof body.task !== 'string' || typeof body.idempotencyKey !== 'string' || !isRecord(body.origin)) throw new Error('INVALID_REQUEST')
      const origin = body.origin
      if (typeof origin.adapterId !== 'string' || typeof origin.correlationId !== 'string' || (origin.conversationRefHash !== null && typeof origin.conversationRefHash !== 'string')) throw new Error('INVALID_REQUEST')
      const result = await dependencies.routingIntegrationApi.dispatch(headerString(request, 'x-findmnemo-routing-token'), { ...input, task: body.task, idempotencyKey: body.idempotencyKey, origin: { adapterId: origin.adapterId, correlationId: origin.correlationId, conversationRefHash: origin.conversationRefHash }, timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined, retryOfReceiptId: typeof body.retryOfReceiptId === 'string' ? body.retryOfReceiptId : undefined })
      sendJson(response, 200, apiSuccess(result))
    } catch (cause) { integrationFailure(response, cause) }
    return
  }

  const integrationReceiptMatch = url.pathname.match(/^\/api\/v1\/integration\/routing\/dispatches\/([^/]+)(?:\/(cancel|delivered))?$/)
  if (integrationReceiptMatch) {
    if (!dependencies.routingIntegrationApi) { sendJson(response, 503, apiFailure({ code: 'CREDENTIAL_STORE_UNAVAILABLE', message: 'Routing integration credentials are unavailable.', retryable: true })); return }
    try {
      const token = headerString(request, 'x-findmnemo-routing-token')
      const receiptId = decodeURIComponent(integrationReceiptMatch[1])
      const action = integrationReceiptMatch[2]
      const data = action === 'cancel' && request.method === 'POST' ? await dependencies.routingIntegrationApi.cancel(token, receiptId)
        : action === 'delivered' && request.method === 'POST' ? await dependencies.routingIntegrationApi.acknowledgeDelivery(token, receiptId)
          : !action && request.method === 'GET' ? await dependencies.routingIntegrationApi.read(token, receiptId) : undefined
      if (data === undefined) throw new Error('INVALID_REQUEST')
      sendJson(response, 200, apiSuccess(data))
    } catch (cause) { integrationFailure(response, cause) }
    return
  }

  if (url.pathname === '/api/v1/pairing/session' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request)
      const result = dependencies.pairingService.exchange(
        typeof body.code === 'string' ? body.code : '',
        typeof body.browserNonce === 'string' ? body.browserNonce : '',
      )
      if (!result.ok) {
        auditPairing(dependencies, 'pairing-session', result.code, 'rejected')
        sendJson(response, result.code === 'PAIRING_RATE_LIMITED' ? 429 : 401, apiFailure({ code: result.code, message: 'Pairing was not accepted.', retryable: true }))
        return
      }
      auditPairing(dependencies, 'pairing-session', undefined, 'accepted')
      sendJson(response, 200, apiSuccess(result))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Pairing request must be a bounded JSON object.', retryable: false }))
    }
    return
  }

  if (url.pathname === '/api/v1/local-session' && request.method === 'POST') {
    if (origin !== `http://${request.headers.host}`) {
      sendJson(response, 403, apiFailure({ code: 'ORIGIN_NOT_ALLOWED', message: 'Local bootstrap requires the companion origin.', retryable: false }))
      return
    }
    try {
      const body = await readJsonBody(request)
      const result = dependencies.pairingService.exchangeLocalBootstrap(
        typeof body.bootstrapNonce === 'string' ? body.bootstrapNonce : '',
        typeof body.browserNonce === 'string' ? body.browserNonce : '',
      )
      if (!result.ok) {
        auditPairing(dependencies, 'local-session', result.code, 'rejected')
        sendJson(response, 401, apiFailure({ code: result.code, message: 'Local bootstrap was not accepted.', retryable: true }))
        return
      }
      auditPairing(dependencies, 'local-session', undefined, 'accepted')
      sendJson(response, 200, apiSuccess(result))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Local bootstrap request must be a bounded JSON object.', retryable: false }))
    }
    return
  }

  if (url.pathname === '/api/v1/pairing/rotate' && request.method === 'POST') {
    const result = dependencies.pairingService.rotate(bearerToken(request), headerString(request, 'x-findmnemo-browser-nonce'))
    if (!result.ok) {
      auditPairing(dependencies, 'pairing-rotation', result.code, 'rejected')
      sendJson(response, 401, apiFailure({ code: result.code, message: 'Session could not be rotated.', retryable: true }))
      return
    }
    auditPairing(dependencies, 'pairing-rotation', undefined, 'accepted')
    sendJson(response, 200, apiSuccess(result))
    return
  }

  if (url.pathname === '/api/v1/pairing/session' && request.method === 'DELETE') {
    const revoked = dependencies.pairingService.revoke(bearerToken(request))
    auditPairing(dependencies, 'pairing-revocation', revoked ? undefined : 'SESSION_INVALID', revoked ? 'accepted' : 'rejected')
    sendJson(response, revoked ? 200 : 401, revoked
      ? apiSuccess({ revoked: true })
      : apiFailure({ code: 'SESSION_INVALID', message: 'Session is not active.', retryable: false }))
    return
  }

  if (url.pathname === '/api/v1/status' && request.method === 'GET') {
    const session = dependencies.pairingService.validate(bearerToken(request), headerString(request, 'x-findmnemo-browser-nonce'))
    if (!session.ok) {
      sendJson(response, 401, apiFailure({ code: session.code, message: 'Pair this browser before requesting operational status.', retryable: true }))
      return
    }
    sendJson(response, 200, apiSuccess({
      companion: { state: 'connected', version: dependencies.identity.companionVersion, instanceId: dependencies.identity.instanceId },
      database: { state: 'ready' },
      gmail: { state: await dependencies.gmailServices.connected() ? 'connected' : 'disconnected' },
      sources: dependencies.reconciliationEngine.sources(),
      checkedAt: dependencies.clock().toISOString(),
      capabilities: dependencies.capabilityReport,
    }))
    return
  }

  if (url.pathname === '/api/v1/diagnostics' && request.method === 'GET') {
    const session = dependencies.pairingService.validate(bearerToken(request), headerString(request, 'x-findmnemo-browser-nonce'))
    if (!session.ok) {
      sendJson(response, 401, apiFailure({ code: session.code, message: 'Pair this browser before requesting diagnostics.', retryable: true }))
      return
    }
    sendJson(response, 200, apiSuccess({
      listener: { host: '127.0.0.1', port: 3210, state: 'available' },
      database: { state: 'ready', location: 'local-app-data' },
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      companionVersion: dependencies.identity.companionVersion,
      browserSupport: { platforms: ['Windows'], browsers: ['Microsoft Edge', 'Google Chrome'], verification: 'manual-required' },
      recovery: ['retry-identity', 'regenerate-pairing-code', 'open-local-fallback', 'run-companion-doctor'],
      checkedAt: dependencies.clock().toISOString(),
      capabilities: dependencies.capabilityReport,
    }))
    return
  }

  if (url.pathname === '/api/v1/diagnostics/export' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess(await createDiagnosticExport({ logger: dependencies.logger, databasePath: dependencies.databasePath, companionVersion: dependencies.identity.companionVersion })))
    return
  }

  if (url.pathname === '/api/v1/routing/policy' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess({ policy: dependencies.routingRepository.readPolicy() }))
    return
  }

  if (url.pathname === '/api/v1/routing/dispatches' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess(dependencies.routingRepository.listDispatchReceipts()))
    return
  }

  const pairedDispatchAction = url.pathname.match(/^\/api\/v1\/routing\/dispatches\/([^/]+)\/(cancel|retry)$/)
  if (pairedDispatchAction && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    const receiptId = decodeURIComponent(pairedDispatchAction[1])
    if (pairedDispatchAction[2] === 'cancel') {
      const receipt = dependencies.dispatchService.cancel(receiptId)
      if (!receipt) sendJson(response, 404, apiFailure({ code: 'ROUTING_DISPATCH_NOT_FOUND', message: 'Dispatch receipt was not found.', retryable: false }))
      else sendJson(response, 200, apiSuccess(receipt))
      return
    }
    const idempotencyKey = headerString(request, 'idempotency-key')
    if (!idempotencyKey) {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Retry requires a new idempotency key.', retryable: false }))
      return
    }
    const result = await dependencies.dispatchService.retry(receiptId, idempotencyKey)
    if (!result.receipt || result.reasonCode === 'RETRY_NOT_ALLOWED' || result.reasonCode === 'RESULT_CONTENT_UNAVAILABLE') {
      const code = result.reasonCode === 'RESULT_CONTENT_UNAVAILABLE' ? 'RESULT_CONTENT_UNAVAILABLE' : 'RETRY_NOT_ALLOWED'
      sendJson(response, 409, apiFailure({ code, message: code === 'RESULT_CONTENT_UNAVAILABLE' ? 'The original task is no longer available in companion memory. Retry it from the originating chat.' : 'This dispatch state cannot be retried.', retryable: false }))
      return
    }
    sendJson(response, 200, apiSuccess(result.receipt))
    return
  }

  if (url.pathname === '/api/v1/routing/dispatches' && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 403, apiFailure({ code: 'ORIGIN_NOT_ALLOWED', message: 'Dispatch requires a scoped local chat integration. Paired browser sessions cannot send work.', retryable: false }))
    return
  }

  if (url.pathname === '/api/v1/routing/destinations/discover' && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    const discovery = await dependencies.discoveryService.discover()
    sendJson(response, 200, apiSuccess(discovery))
    return
  }

  if (url.pathname === '/api/v1/routing/destinations/pi-rpc/catalog' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    const catalog = dependencies.routingRepository.readCatalog('pi-rpc')
    if (!catalog) sendJson(response, 404, apiFailure({ code: 'ROUTING_DESTINATION_UNAVAILABLE', message: 'The Pi model catalog has not been checked.', retryable: true }))
    else sendJson(response, 200, apiSuccess(catalog))
    return
  }

  if (url.pathname === '/api/v1/routing/destinations/pi-rpc/catalog' && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const catalog = await dependencies.piRoutingAdapter.listModels(AbortSignal.timeout(10_000))
      dependencies.routingRepository.saveCatalog(catalog)
      sendJson(response, 200, apiSuccess(catalog))
    } catch {
      sendJson(response, 503, apiFailure({ code: 'ROUTING_DESTINATION_UNAVAILABLE', message: 'Pi catalog check failed. Check installation, authentication, and version, then retry.', retryable: true }))
    }
    return
  }

  const profileValidationMatch = url.pathname.match(/^\/api\/v1\/routing\/profiles\/([^/]+)\/validate$/)
  if (profileValidationMatch && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const body = await readJsonBody(request)
      const expectedPolicyVersion = Number(body.expectedPolicyVersion)
      const profileId = decodeURIComponent(profileValidationMatch[1])
      const policy = dependencies.routingRepository.readPolicy()
      const profile = policy?.profiles.find((candidate) => candidate.id === profileId)
      if (!profile || !Number.isInteger(expectedPolicyVersion)) throw new Error('ROUTING_PROFILE_NOT_FOUND')
      const readiness = await dependencies.piRoutingAdapter.validate(profile, AbortSignal.timeout(10_000))
      const saved = dependencies.routingRepository.applyReadiness(profileId, readiness, expectedPolicyVersion)
      if (saved.status === 'conflict') {
        sendJson(response, 409, apiFailure({ code: 'ROUTING_POLICY_CONFLICT', message: 'The routing policy changed before validation completed.', retryable: true }))
        return
      }
      sendJson(response, 200, apiSuccess({ readiness, policy: saved.policy }))
    } catch {
      sendJson(response, 404, apiFailure({ code: 'ROUTING_PROFILE_NOT_FOUND', message: 'The requested routing profile was not found.', retryable: false }))
    }
    return
  }

  if (url.pathname === '/api/v1/routing/policy' && request.method === 'PUT') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const body = await readJsonBody(request)
      const expectedPolicyVersion = body.expectedPolicyVersion === null ? null : Number(body.expectedPolicyVersion)
      if (expectedPolicyVersion !== null && (!Number.isInteger(expectedPolicyVersion) || expectedPolicyVersion < 0)) throw new Error('ROUTING_POLICY_INVALID')
      const result = dependencies.routingRepository.compareAndSetPolicy(body.policy as OperationalRoutingPolicy, expectedPolicyVersion)
      if (result.status === 'conflict') {
        sendJson(response, 409, apiFailure({ code: 'ROUTING_POLICY_CONFLICT', message: 'The routing policy changed. Reload it before saving.', retryable: true }))
        return
      }
      dependencies.operationalRepository.appendAudit({ timestamp: dependencies.clock().toISOString(), action: 'routing-policy-update', objectRefs: [`policy-version:${result.policy.policyVersion}`], result: 'saved' })
      sendJson(response, 200, apiSuccess(result.policy))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'ROUTING_POLICY_INVALID', message: 'The routing policy is invalid or contains private data.', retryable: false }))
    }
    return
  }

  if (url.pathname === '/api/v1/routing/policy/export-v1' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    const policy = dependencies.routingRepository.exportV1Compatible()
    if (!policy) sendJson(response, 404, apiFailure({ code: 'ROUTING_POLICY_NOT_FOUND', message: 'No operational routing policy has been created.', retryable: false }))
    else sendJson(response, 200, apiSuccess(policy))
    return
  }

  if ((url.pathname === '/api/v1/routing/migration/preview' || url.pathname === '/api/v1/routing/migration/commit') && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const body = await readJsonBody(request)
      const preview = body.preview as unknown as OperationalPolicyMigrationPreview
      if (url.pathname.endsWith('/preview')) {
        sendJson(response, 200, apiSuccess(dependencies.routingRepository.previewMigration(preview)))
        return
      }
      if (!headerString(request, 'idempotency-key')) throw new Error('ROUTING_MIGRATION_INVALID')
      const policy = dependencies.routingRepository.commitMigration(preview, dependencies.clock().toISOString())
      dependencies.operationalRepository.appendAudit({ timestamp: dependencies.clock().toISOString(), action: 'routing-policy-migration', objectRefs: [`policy-version:${policy.policyVersion}`], result: 'committed' })
      sendJson(response, 200, apiSuccess(policy))
    } catch (cause) {
      const exists = cause instanceof Error && cause.message === 'ROUTING_POLICY_EXISTS'
      sendJson(response, exists ? 409 : 400, apiFailure({ code: exists ? 'ROUTING_POLICY_CONFLICT' : 'ROUTING_MIGRATION_INVALID', message: exists ? 'An operational routing policy already exists.' : 'The routing migration preview is invalid.', retryable: false }))
    }
    return
  }

  if (url.pathname === '/api/v1/sources' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess(dependencies.reconciliationEngine.sources()))
    return
  }

  const sourceConfigMatch = url.pathname.match(/^\/api\/v1\/sources\/([^/]+)$/)
  if (sourceConfigMatch && request.method === 'PATCH') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      if (!origin.startsWith('http://127.0.0.1:')) throw new Error('local confirmation required')
      const sourceId = decodeURIComponent(sourceConfigMatch[1]) as SourceId
      if (!SOURCE_IDS.includes(sourceId)) throw new Error('invalid source')
      const current = dependencies.reconciliationEngine.sources().find((source) => source.id === sourceId)
      if (!current) throw new Error('source unavailable')
      const body = await readJsonBody(request)
      const policy = body.policy ?? current.policy
      if (!['auto-create', 'review', 'exclude'].includes(String(policy))) throw new Error('invalid policy')
      const enabled = typeof body.enabled === 'boolean' ? body.enabled : current.enabled
      const config = typeof body.config === 'object' && body.config !== null && !Array.isArray(body.config) ? body.config as Record<string, unknown> : {}
      if (sourceId === 'agent-ledger' && enabled && (body.confirmed !== true || typeof config.path !== 'string' || typeof config.registrationId !== 'string')) throw new Error('ledger confirmation required')
      if (sourceId === 'project-sdd' && enabled && !Array.isArray(config.projects)) throw new Error('registered projects required')
      const descriptor = { ...current, enabled, policy: policy as typeof current.policy, locationLabel: typeof body.locationLabel === 'string' ? body.locationLabel : current.locationLabel }
      dependencies.operationalRepository.saveConfiguredSource(descriptor, config)
      sendJson(response, 200, apiSuccess(descriptor))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Source configuration requires explicit local confirmation and valid bounded settings.', retryable: false }))
    }
    return
  }

  if (sourceConfigMatch && request.method === 'DELETE') {
    if (!authorizePrivate(request, response, dependencies)) return
    if (!origin.startsWith('http://127.0.0.1:')) {
      sendJson(response, 403, apiFailure({ code: 'ORIGIN_NOT_ALLOWED', message: 'Source removal is available only from the local companion surface.', retryable: false }))
      return
    }
    const sourceId = decodeURIComponent(sourceConfigMatch[1]) as SourceId
    const deleted = SOURCE_IDS.includes(sourceId) && dependencies.operationalRepository.deleteConfiguredSource(sourceId)
    sendJson(response, 200, apiSuccess({ deleted }))
    return
  }

  if (url.pathname === '/api/v1/reconciliation-runs' && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const body = await readJsonBody(request)
      const requested = Array.isArray(body.sourceIds) ? body.sourceIds : undefined
      if (requested && !requested.every((sourceId): sourceId is SourceId => typeof sourceId === 'string' && SOURCE_IDS.includes(sourceId as SourceId))) throw new Error('invalid source')
      sendJson(response, 202, apiSuccess(dependencies.reconciliationEngine.start(requested, 'hosted')))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Reconciliation request is invalid.', retryable: false }))
    }
    return
  }

  if (url.pathname === '/api/v1/reconciliation-runs' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess(dependencies.reconciliationEngine.history(Number(url.searchParams.get('limit') ?? 20))))
    return
  }

  const reconciliationRetryMatch = url.pathname.match(/^\/api\/v1\/reconciliation-runs\/([^/]+)\/retry$/)
  if (reconciliationRetryMatch && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const body = await readJsonBody(request)
      const requested = Array.isArray(body.sourceIds) ? body.sourceIds : undefined
      if (requested && !requested.every((sourceId): sourceId is SourceId => typeof sourceId === 'string' && SOURCE_IDS.includes(sourceId as SourceId))) throw new Error('invalid source')
      const run = dependencies.reconciliationEngine.retry(decodeURIComponent(reconciliationRetryMatch[1]), requested)
      sendJson(response, run ? 202 : 404, run ? apiSuccess(run) : apiFailure({ code: 'RUN_NOT_FOUND', message: 'Reconciliation run does not exist.', retryable: false }))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Reconciliation retry request is invalid.', retryable: false }))
    }
    return
  }

  const reconciliationMatch = url.pathname.match(/^\/api\/v1\/reconciliation-runs\/([^/]+)$/)
  if (reconciliationMatch && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    const run = dependencies.reconciliationEngine.get(decodeURIComponent(reconciliationMatch[1]))
    sendJson(response, run ? 200 : 404, run ? apiSuccess(run) : apiFailure({ code: 'RUN_NOT_FOUND', message: 'Reconciliation run does not exist.', retryable: false }))
    return
  }

  if (url.pathname === '/api/v1/gmail/status' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess({
      configured: dependencies.gmailServices.configured,
      connected: await dependencies.gmailServices.connected(),
      credentialCapability: dependencies.gmailServices.credentialCapability,
      scope: dependencies.gmailServices.scope,
      existingGmcliRequiresReauthentication: Boolean(process.env.LOCALAPPDATA),
      source: dependencies.gmailCheckService.status(),
    }))
    return
  }

  if (url.pathname === '/api/v1/gmail/connect' && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const flow = await dependencies.gmailServices.startConnect()
      sendJson(response, 202, apiSuccess({ connected: false, scope: dependencies.gmailServices.scope, authorizationUrl: flow.authorizationUrl }))
    } catch (cause) {
      const code = gmailErrorCode(cause)
      sendJson(response, code === 'GMAIL_NOT_CONFIGURED' ? 503 : 400, apiFailure({ code, message: 'Gmail connection did not complete.', retryable: code !== 'OAUTH_DENIED' }))
    }
    return
  }

  if (url.pathname === '/api/v1/gmail/connection' && request.method === 'DELETE') {
    if (!authorizePrivate(request, response, dependencies)) return
    await dependencies.gmailServices.revoke()
    sendJson(response, 200, apiSuccess({ connected: false }))
    return
  }

  if (url.pathname === '/api/v1/gmail/checks' && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    if (!await dependencies.gmailServices.connected()) {
      sendJson(response, 409, apiFailure({ code: 'GMAIL_TOKEN_REVOKED', message: 'Connect Gmail before starting a metadata check.', retryable: true }))
      return
    }
    const run = dependencies.gmailCheckService.start()
    sendJson(response, 202, apiSuccess(run))
    return
  }

  const gmailCheckMatch = url.pathname.match(/^\/api\/v1\/gmail\/checks\/([^/]+)$/)
  if (gmailCheckMatch && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    const run = dependencies.gmailCheckService.get(decodeURIComponent(gmailCheckMatch[1]))
    sendJson(response, run ? 200 : 404, run
      ? apiSuccess(run)
      : apiFailure({ code: 'RUN_NOT_FOUND', message: 'Gmail check does not exist.', retryable: false }))
    return
  }

  if (url.pathname === '/api/v1/email/candidates' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess(dependencies.gmailCheckService.records()))
    return
  }

  const candidateDecisionMatch = url.pathname.match(/^\/api\/v1\/email\/candidates\/([^/]+)\/decision$/)
  if (candidateDecisionMatch && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const body = await readJsonBody(request)
      const action = body.action
      const state = action === 'confirm' ? 'confirmed-untracked' : action === 'dismiss' ? 'dismissed' : action === 'defer' ? 'deferred' : undefined
      if (!state || typeof body.accountId !== 'string' || typeof body.expectedVersion !== 'number') throw new Error('invalid decision')
      const threadId = decodeURIComponent(candidateDecisionMatch[1])
      const current = dependencies.operationalRepository.emailThreadState(body.accountId, threadId)
      if (!current.state) {
        sendJson(response, 404, apiFailure({ code: 'INVALID_REQUEST', message: 'Email candidate does not exist.', retryable: false }))
        return
      }
      const updated = dependencies.operationalRepository.updateEmailThreadState(body.accountId, threadId, body.expectedVersion, state, dependencies.clock().toISOString())
      if (!updated) {
        sendJson(response, 409, apiFailure({ code: 'RECORD_CHANGED', message: 'Candidate changed; refresh before retrying.', retryable: true }))
        return
      }
      dependencies.operationalRepository.appendAudit({
        timestamp: dependencies.clock().toISOString(), action: 'gmail-triage', reasonCode: String(action),
        objectRefs: [`email-thread:${threadId}`], result: state,
      })
      sendJson(response, 200, apiSuccess(updated))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Candidate decision is invalid.', retryable: false }))
    }
    return
  }

  const candidateTicketMatch = url.pathname.match(/^\/api\/v1\/email\/candidates\/([^/]+)\/ticket$/)
  if (candidateTicketMatch && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    const idempotencyKey = headerString(request, 'idempotency-key')
    try {
      if (!idempotencyKey || idempotencyKey.length > 200) throw new Error('missing idempotency key')
      const body = await readJsonBody(request)
      if (typeof body.accountId !== 'string' || typeof body.expectedVersion !== 'number') throw new Error('invalid association')
      const threadId = decodeURIComponent(candidateTicketMatch[1])
      const create = body.mode === 'create'
      const ticket = create
        ? storedTicketFromPayload(body.ticket as Record<string, unknown>)
        : dependencies.operationalRepository.getTicket(String(body.ticketId))
      if (!ticket) throw new Error('ticket missing')
      const result = dependencies.operationalRepository.associateEmailThread({
        accountId: body.accountId,
        threadId,
        expectedVersion: body.expectedVersion,
        idempotencyKey,
        ticket,
        create,
        createdAt: dependencies.clock().toISOString(),
      })
      sendJson(response, create && result.created ? 201 : 200, apiSuccess(result))
    } catch (cause) {
      const conflict = cause instanceof Error && (cause.message === 'RECORD_CHANGED' || cause.message.includes('UNIQUE'))
      sendJson(response, conflict ? 409 : 400, apiFailure({
        code: conflict ? 'RECORD_CHANGED' : 'INVALID_REQUEST',
        message: conflict ? 'Email or ticket changed; refresh before retrying.' : 'Email ticket association is invalid.',
        retryable: conflict,
      }))
    }
    return
  }

  if ((url.pathname === '/api/v1/migration/legacy-tickets/preview' || url.pathname === '/api/v1/migration/legacy-tickets/commit') && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const commit = url.pathname.endsWith('/commit')
      const idempotencyKey = headerString(request, 'idempotency-key')
      if (commit && (!idempotencyKey || idempotencyKey.length > 200)) throw new Error('idempotency key required')
      const body = await readJsonBody(request)
      if (!Array.isArray(body.records) || body.records.length > 10_000) throw new Error('invalid records')
      const records = body.records.map((value) => {
        if (typeof value !== 'object' || value === null) return { legacyId: '', excluded: true }
        const record = value as Record<string, unknown>
        const legacyId = typeof record.legacyId === 'string' ? record.legacyId : ''
        if (record.excluded === true || typeof record.ticket !== 'object' || record.ticket === null) return { legacyId, excluded: true }
        const ticket = legacyMigrationTicket(record.ticket as Record<string, unknown>)
        return ticket ? { legacyId, excluded: false, ticket } : { legacyId, excluded: true }
      })
      const result = dependencies.operationalRepository.migrateLegacyTickets(records, idempotencyKey ?? 'preview', commit, dependencies.clock().toISOString())
      sendJson(response, 200, apiSuccess(result))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Legacy migration contains unsupported or private data.', retryable: false }))
    }
    return
  }

  if (url.pathname === '/api/v1/tickets' && request.method === 'GET') {
    if (!authorizePrivate(request, response, dependencies)) return
    sendJson(response, 200, apiSuccess(dependencies.operationalRepository.listTickets().map((ticket) => ticket.payload)))
    return
  }

  if (url.pathname === '/api/v1/tickets' && request.method === 'POST') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const payload = await readJsonBody(request)
      const ticket = storedTicketFromPayload(payload)
      if (dependencies.operationalRepository.getTicket(ticket.id)) {
        sendJson(response, 409, apiFailure({ code: 'RECORD_CHANGED', message: 'Ticket already exists.', retryable: false }))
        return
      }
      dependencies.operationalRepository.saveTicket(ticket)
      sendJson(response, 201, apiSuccess(ticket.payload))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Ticket payload is invalid or contains prohibited private fields.', retryable: false }))
    }
    return
  }

  const ticketMatch = url.pathname.match(/^\/api\/v1\/tickets\/([^/]+)$/)
  if (ticketMatch && request.method === 'PATCH') {
    if (!authorizePrivate(request, response, dependencies)) return
    try {
      const id = decodeURIComponent(ticketMatch[1])
      const current = dependencies.operationalRepository.getTicket(id)
      if (!current) {
        sendJson(response, 404, apiFailure({ code: 'INVALID_REQUEST', message: 'Ticket does not exist.', retryable: false }))
        return
      }
      const changes = await readJsonBody(request)
      if (typeof changes.updatedAt !== 'string' || changes.updatedAt !== current.updatedAt) {
        sendJson(response, 409, apiFailure({ code: 'RECORD_CHANGED', message: 'Ticket changed; refresh before retrying.', retryable: true }))
        return
      }
      const nextPayload = { ...current.payload, ...changes, id, updatedAt: dependencies.clock().toISOString() }
      const ticket = storedTicketFromPayload(nextPayload)
      dependencies.operationalRepository.saveTicket(ticket)
      sendJson(response, 200, apiSuccess(ticket.payload))
    } catch {
      sendJson(response, 400, apiFailure({ code: 'INVALID_REQUEST', message: 'Ticket update is invalid.', retryable: false }))
    }
    return
  }

  if (ticketMatch && request.method === 'DELETE') {
    if (!authorizePrivate(request, response, dependencies)) return
    const removed = dependencies.operationalRepository.deleteTicket(decodeURIComponent(ticketMatch[1]))
    sendJson(response, removed ? 200 : 404, removed
      ? apiSuccess({ deleted: true })
      : apiFailure({ code: 'INVALID_REQUEST', message: 'Ticket does not exist.', retryable: false }))
    return
  }

  sendJson(response, 404, apiFailure({
    code: 'INVALID_REQUEST',
    message: 'The requested companion API route does not exist.',
    retryable: false,
  }))
}

function auditPairing(dependencies: RouteDependencies, action: string, reasonCode: string | undefined, result: string): void {
  dependencies.operationalRepository.appendAudit({
    timestamp: dependencies.clock().toISOString(), action, reasonCode, objectRefs: [], result,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function routingInput(body: Record<string, unknown>) {
  if (!Array.isArray(body.capabilityIds) || !body.capabilityIds.every((value) => typeof value === 'string') || !isRoutingClassificationSource(body.classificationSource) || typeof body.classificationAmbiguous !== 'boolean') throw new Error('INVALID_REQUEST')
  let override: RoutingRequestOverride = { mode: 'none' }
  if (isRecord(body.override)) {
    if (body.override.mode === 'self') override = { mode: 'self' }
    else if (body.override.mode === 'include' && typeof body.override.profileId === 'string') override = { mode: 'include', profileId: body.override.profileId }
    else if (body.override.mode === 'exclude' && Array.isArray(body.override.profileIds) && body.override.profileIds.every((value) => typeof value === 'string')) override = { mode: 'exclude', profileIds: body.override.profileIds as string[] }
    else if (body.override.mode !== 'none') throw new Error('INVALID_REQUEST')
  }
  return { capabilityIds: body.capabilityIds as string[], classificationSource: body.classificationSource, classificationAmbiguous: body.classificationAmbiguous, override }
}

function integrationFailure(response: ServerResponse, cause: unknown): void {
  const unauthorized = cause instanceof Error && cause.message === 'ROUTING_INTEGRATION_UNAUTHORIZED'
  sendJson(response, unauthorized ? 401 : 400, apiFailure({ code: unauthorized ? 'ROUTING_INTEGRATION_UNAUTHORIZED' : 'INVALID_REQUEST', message: unauthorized ? 'Routing integration authentication failed.' : 'Routing integration request is invalid.', retryable: false }))
}

function gmailErrorCode(cause: unknown): 'OAUTH_DENIED' | 'OAUTH_TIMEOUT' | 'OAUTH_STATE_MISMATCH' | 'GMAIL_NOT_CONFIGURED' | 'GMAIL_REFRESH_FAILED' | 'CREDENTIAL_STORE_UNAVAILABLE' | 'CREDENTIAL_PERMISSION_REQUIRED' | 'NATIVE_ADAPTER_UNSUPPORTED' | 'INTERNAL_ERROR' {
  const message = cause instanceof Error ? cause.message : ''
  if (message === 'OAUTH_DENIED' || message === 'OAUTH_TIMEOUT' || message === 'OAUTH_STATE_MISMATCH' || message === 'GMAIL_NOT_CONFIGURED' || message === 'GMAIL_REFRESH_FAILED' || message === 'CREDENTIAL_STORE_UNAVAILABLE' || message === 'CREDENTIAL_PERMISSION_REQUIRED' || message === 'NATIVE_ADAPTER_UNSUPPORTED') return message
  return 'INTERNAL_ERROR'
}

function authorizePrivate(request: IncomingMessage, response: ServerResponse, dependencies: RouteDependencies): boolean {
  const session = dependencies.pairingService.validate(bearerToken(request), headerString(request, 'x-findmnemo-browser-nonce'))
  if (session.ok) return true
  sendJson(response, 401, apiFailure({ code: session.code, message: 'A current paired session is required.', retryable: true }))
  return false
}

function storedTicketFromPayload(payload: Record<string, unknown>): StoredTicket {
  for (const field of ['id', 'status', 'source', 'origin', 'createdAt', 'updatedAt'] as const) {
    if (typeof payload[field] !== 'string' || payload[field].length === 0) throw new Error(`Missing ${field}`)
  }
  return {
    id: payload.id as string,
    status: payload.status as string,
    source: payload.source as string,
    origin: payload.origin as string,
    createdAt: payload.createdAt as string,
    updatedAt: payload.updatedAt as string,
    payload,
  }
}

const LEGACY_TICKET_SOURCES = new Set(['Pi', 'Codex', 'Claude Cowork'])
const LEGACY_TICKET_STATUSES = new Set(['todo', 'in-progress', 'done', 'blocked'])

function legacyMigrationTicket(payload: Record<string, unknown>): StoredTicket | undefined {
  try {
    assertPrivateBoundary(payload)
    if (
      payload.origin === 'demo' ||
      typeof payload.title !== 'string' ||
      !payload.title.trim() ||
      !LEGACY_TICKET_SOURCES.has(String(payload.source)) ||
      !LEGACY_TICKET_STATUSES.has(String(payload.status))
    ) return undefined
    return storedTicketFromPayload({ ...payload, origin: 'imported' })
  } catch {
    return undefined
  }
}

function headerString(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

async function serveSpa(response: ServerResponse, pathname: string, distPath: string, issueLocalBootstrap: () => string): Promise<void> {
  const isAppRoute = pathname === '/'
    || pathname === '/app'
    || pathname.startsWith('/app/')
    || pathname === '/demo'
    || pathname.startsWith('/demo/')
  const requestedPath = isAppRoute ? 'index.html' : pathname.replace(/^\/+/, '')
  const root = resolve(distPath)
  const filePath = resolve(root, requestedPath)
  const relativePath = relative(root, filePath)

  if (relativePath.startsWith('..') || relativePath.includes(':')) {
    sendJson(response, 404, apiFailure({ code: 'INVALID_REQUEST', message: 'Asset path is invalid.', retryable: false }))
    return
  }

  try {
    let file = await readFile(filePath)
    if (filePath.endsWith('index.html')) {
      const meta = `<meta name="findmnemo-local-bootstrap" content="${issueLocalBootstrap()}">`
      const html = file.toString('utf8')
      file = Buffer.from(html.includes('</head>') ? html.replace('</head>', `${meta}</head>`) : `${meta}${html}`)
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': file.byteLength,
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:3210; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    })
    response.end(file)
  } catch {
    sendJson(response, 404, apiFailure({ code: 'INVALID_REQUEST', message: 'Asset was not found.', retryable: false }))
  }
}
