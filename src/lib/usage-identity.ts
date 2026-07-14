export async function usageIdentityKeyForBrowser(input: { clientId: string; providerId: string | null; modelId: string }): Promise<string> {
  const value = `${input.clientId}\u0000${input.providerId ?? ''}\u0000${input.modelId}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `model_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
