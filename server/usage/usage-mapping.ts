import { createHash, createHmac } from 'node:crypto'

export function opaqueUsageIdentity(rawIdentity: string, salt: Buffer): string {
  if (!rawIdentity || salt.byteLength < 32) throw new Error('USAGE_IDENTITY_INPUT_INVALID')
  return `usage_${createHmac('sha256', salt).update(rawIdentity, 'utf8').digest('hex')}`
}

export function usageIdentityKey(input: { clientId: string; providerId: string | null; modelId: string }): string {
  return `model_${createHash('sha256').update(`${input.clientId}\u0000${input.providerId ?? ''}\u0000${input.modelId}`).digest('hex')}`
}
