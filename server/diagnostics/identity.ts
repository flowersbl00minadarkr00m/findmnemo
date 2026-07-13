import { randomUUID } from 'node:crypto'
import {
  COMPANION_PROTOCOL_VERSION,
  type CompanionIdentityDto,
} from '../../shared/companion-contract.js'

export interface IdentityDependencies {
  companionVersion: string
  instanceId?: string
}

export function createCompanionIdentity({
  companionVersion,
  instanceId = randomUUID(),
}: IdentityDependencies): CompanionIdentityDto {
  return {
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    companionVersion,
    instanceId,
    pairingRequired: true,
  }
}
