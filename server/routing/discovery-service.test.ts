import { describe, expect, it } from 'vitest'
import type { AdapterManifest, DestinationAdapter, ProcessRunRequest, ProcessRunResult, RoutingProcessRunner } from './adapter-contract.js'
import { createPiDetectionAdapter } from './adapters/pi-rpc-adapter.js'
import { CommandDetector } from './adapters/command-detector.js'
import { DiscoveryService } from './discovery-service.js'

const NOW = () => new Date('2026-07-12T21:00:00.000Z')

class FakeRunner implements RoutingProcessRunner {
  private readonly results: Record<string, ProcessRunResult | (() => Promise<ProcessRunResult>)>
  constructor(results: Record<string, ProcessRunResult | (() => Promise<ProcessRunResult>)>) { this.results = results }
  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const value = this.results[request.executable] ?? { status: 'not-found' }
    return typeof value === 'function' ? value() : value
  }
}

const manifest: AdapterManifest = {
  adapterId: 'fake', displayName: 'Fake', executableLabel: 'fake', versionArgs: ['--version'], supportedRange: '1.x',
  testedCapabilities: ['detection'], controllability: 'detection-only', installationGuidance: 'Install Fake.', authenticationGuidance: 'Configure Fake.',
}

describe('routing destination discovery', () => {
  it.each([
    [{ status: 'not-found' } as const, { installation: 'not-found', compatibility: 'unknown', reasonCode: 'TOOL_NOT_FOUND' }],
    [{ status: 'completed', exitCode: 0, stdout: 'fake 1.2.3', stderr: '' } as const, { installation: 'detected', compatibility: 'supported', installedVersion: '1.2.3' }],
    [{ status: 'completed', exitCode: 0, stdout: 'fake 2.0.0', stderr: '' } as const, { installation: 'detected', compatibility: 'unsupported', installedVersion: '2.0.0' }],
    [{ status: 'completed', exitCode: 0, stdout: 'changed protocol', stderr: '' } as const, { installation: 'detected', compatibility: 'unknown', reasonCode: 'VERSION_UNREADABLE' }],
    [{ status: 'timed-out' } as const, { installation: 'error', reasonCode: 'DETECTION_TIMEOUT' }],
    [{ status: 'output-limit' } as const, { installation: 'error', reasonCode: 'DETECTION_OUTPUT_LIMIT' }],
  ])('maps bounded process evidence without exposing raw output (%#)', async (result, expected) => {
    const detector = new CommandDetector(manifest, new FakeRunner({ fake: result }), NOW)
    const detection = await detector.detect(new AbortController().signal)
    expect(detection).toMatchObject(expected)
    expect(JSON.stringify(detection)).not.toMatch(/changed protocol|stdout|stderr|C:\\Users|environment|secret/i)
    expect(detection.readiness).toBe('unchecked')
  })

  it('checks adapters concurrently and scopes one failure without enabling anything', async () => {
    const found = { status: 'completed', exitCode: 0, stdout: 'pi 0.80.3', stderr: '' } as const
    const runner = new FakeRunner({ pi: found, 'pi.cmd': found })
    const broken: DestinationAdapter = {
      manifest: { ...manifest, adapterId: 'broken', executableLabel: 'broken' },
      detect: async () => { throw new Error('private C:\\Users\\henry\\tool.exe output') },
    }
    const result = await new DiscoveryService([createPiDetectionAdapter(runner, NOW), broken], NOW).discover()
    expect(result.complete).toBe(true)
    expect(result.destinations).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapterId: 'pi-rpc', installation: 'detected', compatibility: 'supported', controllability: 'controllable', readiness: 'unchecked' }),
      expect.objectContaining({ adapterId: 'broken', installation: 'error', reasonCode: 'DETECTION_FAILED', readiness: 'unchecked' }),
    ]))
    expect(JSON.stringify(result)).not.toContain('C:\\Users\\henry')
  })
})
