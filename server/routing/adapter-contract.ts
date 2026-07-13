import type { DestinationDetectionDto, RoutingExecutionProfile } from '../../shared/companion-contract.js'

export interface AdapterManifest {
  adapterId: string
  displayName: string
  executableLabel: string
  versionArgs: readonly string[]
  supportedRange: string
  testedCapabilities: readonly string[]
  controllability: 'controllable' | 'detection-only'
  installationGuidance: string
  authenticationGuidance: string
}

export interface ProcessRunRequest {
  executable: string
  args: readonly string[]
  timeoutMs: number
  maxOutputBytes: number
  signal: AbortSignal
}

export type ProcessRunResult =
  | { status: 'completed'; exitCode: number; stdout: string; stderr: string }
  | { status: 'not-found' | 'timed-out' | 'output-limit' | 'failed' }

export interface RoutingProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>
}

export interface DestinationAdapter {
  manifest: AdapterManifest
  detect(signal: AbortSignal): Promise<DestinationDetectionDto>
  listModels?(signal: AbortSignal): Promise<unknown>
  validate?(profile: RoutingExecutionProfile, signal: AbortSignal): Promise<unknown>
  execute?(profile: RoutingExecutionProfile, task: string, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent>
  cancel?(dispatchId: string): Promise<void>
}

export type DestinationExecutionEvent =
  | { type: 'started'; actualRoute: { destinationAdapterId: string; destinationInstanceId: string; providerId: string | null; modelId: string; effort: string | null } }
  | { type: 'completed'; text: string; actualRoute: { destinationAdapterId: string; destinationInstanceId: string; providerId: string | null; modelId: string; effort: string | null } }
  | { type: 'failed'; code: string }
