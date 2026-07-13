import type { DestinationAdapter, DestinationExecutionEvent } from '../adapter-contract.js'

export class FakeDestinationAdapter implements DestinationAdapter {
  readonly manifest = { adapterId: 'fake', displayName: 'Fake destination', executableLabel: 'fake', versionArgs: ['--version'], supportedRange: '1.x', testedCapabilities: ['execution', 'cancellation'], controllability: 'controllable' as const, installationGuidance: '', authenticationGuidance: '' }
  calls = 0
  private readonly behavior: 'complete' | 'fail' | 'mismatch' | 'hang' | 'malformed'
  constructor(behavior: 'complete' | 'fail' | 'mismatch' | 'hang' | 'malformed' = 'complete') { this.behavior = behavior }
  async detect() { return { adapterId: 'fake', displayName: 'Fake destination', installation: 'detected' as const, compatibility: 'supported' as const, controllability: 'controllable' as const, readiness: 'unchecked' as const, executableLabel: 'fake', installedVersion: '1.0.0', supportedRange: '1.x', testedCapabilities: ['execution'], evidenceAt: new Date(0).toISOString(), reasonCode: null, guidance: '' } }
  async *execute(profile: Parameters<NonNullable<DestinationAdapter['execute']>>[0], task: string, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent> {
    this.calls += 1
    const actualRoute = { destinationAdapterId: profile.destinationAdapterId, destinationInstanceId: profile.destinationInstanceId, providerId: profile.providerId, modelId: this.behavior === 'mismatch' ? 'different-model' : profile.modelId, effort: profile.effort }
    yield { type: 'started', actualRoute }
    if (this.behavior === 'fail') { yield { type: 'failed', code: 'FAKE_FAILURE' }; return }
    if (this.behavior === 'malformed') return
    if (this.behavior === 'hang') await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    if (signal.aborted) throw new Error('ABORTED')
    yield { type: 'completed', text: `fake:${task}`, actualRoute }
  }
}
