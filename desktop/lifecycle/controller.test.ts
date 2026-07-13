import { describe, expect, it, vi } from 'vitest'
import { LifecycleController, type CompanionHostPort } from './controller.js'

function setup() {
  const host: CompanionHostPort = {
    start: vi.fn().mockResolvedValue({ version: '0.1.0', host: '127.0.0.1', port: 3210 }),
    stop: vi.fn().mockResolvedValue(undefined),
  }
  const controller = new LifecycleController(host, {
    appVersion: '0.1.0', protocolVersion: '1.0.0', instanceId: 'instance-1',
    clock: () => new Date('2026-07-12T12:00:00.000Z'), disclosureAcceptedAt: '2026-07-12T11:00:00.000Z',
  })
  return { host, controller }
}

describe('LifecycleController', () => {
  it('coalesces repeated starts into one authoritative companion', async () => {
    const { host, controller } = setup()
    const [first, second] = await Promise.all([controller.start(), controller.start()])
    expect(host.start).toHaveBeenCalledTimes(1)
    expect(first.state).toEqual(second.state)
    expect(first.state.phase).toBe('healthy')
    expect(first.state.instanceId).toBe('instance-1')
    expect(first.state.startup.enabled).toBe(false)
  })

  it('reports port ownership failure without attempting termination', async () => {
    const { host, controller } = setup()
    vi.mocked(host.start).mockRejectedValue(Object.assign(new Error('occupied'), { code: 'PORT_IN_USE' }))
    const result = await controller.start()
    expect(result.ok).toBe(false)
    expect(result.state.companion.errorCode).toBe('PORT_IN_USE')
    expect(host.stop).not.toHaveBeenCalled()
  })

  it('stops once and removes healthy evidence', async () => {
    const { host, controller } = setup()
    await controller.start()
    const result = await controller.stop()
    expect(host.stop).toHaveBeenCalledTimes(1)
    expect(result.state.phase).toBe('stopped')
    expect(result.state.companion.version).toBeUndefined()
  })

  it('keeps a fresh install stopped until disclosure is accepted with startup default off', async () => {
    const host: CompanionHostPort = { start: vi.fn().mockResolvedValue({ version: '0.1.0', host: '127.0.0.1', port: 3210 }), stop: vi.fn() }
    const preferences = { acceptDisclosure: vi.fn().mockResolvedValue({ startupEnabled: false }), setStartAtLogin: vi.fn() }
    const fresh = new LifecycleController(host, { appVersion: '0.1.0', protocolVersion: '1.0.0', instanceId: 'fresh', preferences, clock: () => new Date('2026-07-12T12:00:00.000Z') })
    expect(fresh.snapshot().phase).toBe('first-run')
    expect((await fresh.start()).errorCode).toBe('DISCLOSURE_REQUIRED')
    expect(host.start).not.toHaveBeenCalled()
    const accepted = await fresh.acceptDisclosure(false)
    expect(accepted.state.phase).toBe('stopped')
    expect(accepted.state.startup).toMatchObject({ enabled: false, consentedAt: '2026-07-12T12:00:00.000Z' })
    expect(preferences.acceptDisclosure).toHaveBeenCalledWith('1.0.0', '2026-07-12T12:00:00.000Z', false)
  })
})
