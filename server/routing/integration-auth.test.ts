import { describe, expect, it } from 'vitest'
import { MemorySecretStore } from '../auth/secret-store.js'
import { RoutingIntegrationAuthService } from './integration-auth.js'

describe('RoutingIntegrationAuthService', () => {
  it('keeps a scoped token in the protected-store seam and invalidates it on rotation', async () => {
    const store = new MemorySecretStore(); const auth = new RoutingIntegrationAuthService(store)
    const first = await auth.ensure()
    expect(await auth.verify(first, 'routing:dispatch')).toBe(true)
    expect(await auth.verify('wrong', 'routing:read')).toBe(false)
    const rotated = await auth.rotate()
    expect(rotated).not.toBe(first)
    expect(await auth.verify(first, 'routing:cancel')).toBe(false)
    expect(await auth.verify(rotated, 'routing:cancel')).toBe(true)
    expect(JSON.stringify(store)).not.toContain(rotated)
  })

  it('rejects expired and wrong-scope credentials', async () => {
    let now = new Date('2026-07-12T00:00:00.000Z'); const auth = new RoutingIntegrationAuthService(new MemorySecretStore(), () => now)
    const token = await auth.issue(['routing:read'], 1_000)
    expect(await auth.verify(token, 'routing:read')).toBe(true)
    expect(await auth.verify(token, 'routing:dispatch')).toBe(false)
    now = new Date('2026-07-12T00:00:02.000Z')
    expect(await auth.verify(token, 'routing:read')).toBe(false)
  })
})
