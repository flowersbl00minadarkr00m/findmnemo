import { COMPANION_PROTOCOL_VERSION, type CompanionApiResponse, type RoutingDispatchReceiptDto, type RoutingRequestOverride } from '../../shared/companion-contract.js'
import type { DispatchResult, RoutingPreflightDecision } from '../routing/dispatch-service.js'

export interface RoutingOriginInput {
  capabilityIds: string[]
  classificationSource: 'explicit' | 'origin-inferred' | 'user-confirmed'
  classificationAmbiguous: boolean
  override: RoutingRequestOverride
}

export interface RoutingCompanionTransport {
  recommend(input: RoutingOriginInput): Promise<RoutingPreflightDecision>
  dispatch(input: RoutingOriginInput & { task: string; idempotencyKey: string; origin: { adapterId: string; correlationId: string; conversationRefHash: string | null }; timeoutMs?: number }): Promise<DispatchResult>
  getDispatch(receiptId: string): Promise<RoutingDispatchReceiptDto | null>
  cancelDispatch(receiptId: string): Promise<RoutingDispatchReceiptDto | null>
  acknowledgeDelivery(receiptId: string): Promise<RoutingDispatchReceiptDto>
}

export class HttpRoutingCompanionTransport implements RoutingCompanionTransport {
  private readonly token: string
  private readonly baseUrl: string
  constructor(token: string, baseUrl = 'http://127.0.0.1:3210/api/v1/integration/routing') { this.token = token; this.baseUrl = baseUrl }
  recommend(input: RoutingOriginInput) { return this.request<RoutingPreflightDecision>('/recommend', { method: 'POST', body: JSON.stringify(input) }) }
  dispatch(input: RoutingOriginInput & { task: string; idempotencyKey: string; origin: { adapterId: string; correlationId: string; conversationRefHash: string | null }; timeoutMs?: number }) { return this.request<DispatchResult>('/dispatch', { method: 'POST', body: JSON.stringify(input) }) }
  getDispatch(receiptId: string) { return this.request<RoutingDispatchReceiptDto | null>(`/dispatches/${encodeURIComponent(receiptId)}`) }
  cancelDispatch(receiptId: string) { return this.request<RoutingDispatchReceiptDto | null>(`/dispatches/${encodeURIComponent(receiptId)}/cancel`, { method: 'POST', body: '{}' }) }
  acknowledgeDelivery(receiptId: string) { return this.request<RoutingDispatchReceiptDto>(`/dispatches/${encodeURIComponent(receiptId)}/delivered`, { method: 'POST', body: '{}' }) }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('origin', 'http://127.0.0.1:3210')
    headers.set('x-findmnemo-protocol-version', COMPANION_PROTOCOL_VERSION)
    headers.set('x-findmnemo-routing-token', this.token)
    if (init.body) headers.set('content-type', 'application/json')
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(10 * 60_000), redirect: 'error' })
    const body = await response.json() as CompanionApiResponse<T>
    if (!response.ok || body.error || body.data === null) throw new Error(body.error?.code ?? 'ROUTING_COMPANION_UNAVAILABLE')
    return body.data
  }
}
