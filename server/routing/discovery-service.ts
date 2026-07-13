import type { DestinationDiscoveryDto } from '../../shared/companion-contract.js'
import type { DestinationAdapter } from './adapter-contract.js'

export class DiscoveryService {
  private readonly adapters: readonly DestinationAdapter[]
  private readonly clock: () => Date
  private readonly timeoutMs: number

  constructor(adapters: readonly DestinationAdapter[], clock: () => Date = () => new Date(), timeoutMs = 2_500) {
    this.adapters = adapters
    this.clock = clock
    this.timeoutMs = timeoutMs
  }

  async discover(signal?: AbortSignal): Promise<DestinationDiscoveryDto> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, this.timeoutMs)
    try {
      const destinations = await Promise.all(this.adapters.map(async (adapter) => {
        try { return await adapter.detect(controller.signal) } catch {
          return {
            adapterId: adapter.manifest.adapterId, displayName: adapter.manifest.displayName, installation: 'error' as const,
            compatibility: 'unknown' as const, controllability: adapter.manifest.controllability, readiness: 'unchecked' as const,
            executableLabel: adapter.manifest.executableLabel, installedVersion: null, supportedRange: adapter.manifest.supportedRange,
            testedCapabilities: [...adapter.manifest.testedCapabilities], evidenceAt: this.clock().toISOString(), reasonCode: 'DETECTION_FAILED',
            guidance: 'This tool could not be checked. Other tools were checked normally.',
          }
        }
      }))
      return { checkedAt: this.clock().toISOString(), complete: !controller.signal.aborted, destinations }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
