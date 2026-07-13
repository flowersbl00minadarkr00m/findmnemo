import type { RoutingDispatchReceiptDto } from '../../shared/companion-contract.js'
import type { DispatchRequest, DispatchResult } from './dispatch-service.js'
import { DispatchService } from './dispatch-service.js'
import { RoutingIntegrationAuthService } from './integration-auth.js'
import { RoutingRepository } from './routing-repository.js'

export class RoutingIntegrationApi {
  private readonly auth: RoutingIntegrationAuthService
  private readonly dispatches: DispatchService
  private readonly repository: RoutingRepository
  constructor(auth: RoutingIntegrationAuthService, dispatches: DispatchService, repository: RoutingRepository) { this.auth = auth; this.dispatches = dispatches; this.repository = repository }

  async dispatch(token: string | undefined, request: DispatchRequest): Promise<DispatchResult> {
    if (!await this.auth.verify(token, 'routing:dispatch')) throw new Error('ROUTING_INTEGRATION_UNAUTHORIZED')
    return this.dispatches.dispatch(request)
  }

  async recommend(token: string | undefined, request: Pick<DispatchRequest, 'capabilityIds' | 'classificationSource' | 'classificationAmbiguous' | 'override'>) {
    if (!await this.auth.verify(token, 'routing:read')) throw new Error('ROUTING_INTEGRATION_UNAUTHORIZED')
    return this.dispatches.preflight(request)
  }

  async read(token: string | undefined, receiptId: string): Promise<RoutingDispatchReceiptDto | null> {
    if (!await this.auth.verify(token, 'routing:read')) throw new Error('ROUTING_INTEGRATION_UNAUTHORIZED')
    return this.repository.getDispatchReceipt(receiptId)
  }

  async cancel(token: string | undefined, receiptId: string): Promise<RoutingDispatchReceiptDto | null> {
    if (!await this.auth.verify(token, 'routing:cancel')) throw new Error('ROUTING_INTEGRATION_UNAUTHORIZED')
    return this.dispatches.cancel(receiptId)
  }

  async acknowledgeDelivery(token: string | undefined, receiptId: string): Promise<RoutingDispatchReceiptDto> {
    if (!await this.auth.verify(token, 'routing:read')) throw new Error('ROUTING_INTEGRATION_UNAUTHORIZED')
    return this.dispatches.markDelivered(receiptId)
  }
}
