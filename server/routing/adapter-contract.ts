import type { DestinationDetectionDto, RoutingConnectionDto, RoutingExecutionProfile, RoutingProfileV3 } from '../../shared/companion-contract.js'

export interface AdapterQualificationManifest {
  adapterId: RoutingConnectionDto['adapterId']
  support: 'controllable' | 'detection-only'
  supportedVersions: string
  authMode: RoutingConnectionDto['authMode']
  catalogMode: 'live-rpc' | 'live-http' | 'installed-local' | 'tested-manifest'
  actualRouteEvidence: readonly ('model' | 'provider' | 'effort')[]
  cancellation: 'abort-request' | 'process-tree' | 'both'
}

export interface AdapterConnectionContext {
  connection: RoutingConnectionDto
  projectContext?: { kind: 'project' | 'scratch'; opaqueId: string; localPath: string }
  dispatchChain?: { id: string; depth: number; token: string }
}
export interface AdapterAuthEvidence { state: RoutingConnectionDto['authState']; reasonCode: string | null }

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
  qualification?: AdapterQualificationManifest
}

export interface ProcessRunRequest {
  executable: string
  args: readonly string[]
  timeoutMs: number
  maxOutputBytes: number
  signal: AbortSignal
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string
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
  checkAuthentication?(context: AdapterConnectionContext, signal: AbortSignal): Promise<AdapterAuthEvidence>
  listConnectionModels?(context: AdapterConnectionContext, signal: AbortSignal): Promise<unknown>
  validateConnectionProfile?(profile: RoutingProfileV3, context: AdapterConnectionContext, signal: AbortSignal): Promise<unknown>
  executeConnectionProfile?(profile: RoutingProfileV3, task: string, context: AdapterConnectionContext, signal: AbortSignal): AsyncIterable<DestinationExecutionEvent>
}

export type DestinationExecutionEvent =
  | { type: 'started'; actualRoute: { destinationAdapterId: string; destinationInstanceId: string; providerId: string | null; modelId: string; effort: string | null } }
  | { type: 'completed'; text: string; actualRoute: { destinationAdapterId: string; destinationInstanceId: string; providerId: string | null; modelId: string; effort: string | null } }
  | { type: 'failed'; code: string }
