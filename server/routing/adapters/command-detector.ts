import type { DestinationDetectionDto } from '../../../shared/companion-contract.js'
import type { AdapterManifest, DestinationAdapter, RoutingProcessRunner } from '../adapter-contract.js'

const VERSION_PATTERN = /\b(?:v)?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/

function major(version: string): number | undefined {
  const value = Number(version.split('.')[0])
  return Number.isInteger(value) ? value : undefined
}

function supported(version: string, range: string): boolean {
  if (range === '*') return version.length > 0
  const detectedMajor = major(version)
  const match = range.match(/^(\d+)\.x$/)
  return detectedMajor !== undefined && match !== null && detectedMajor === Number(match[1])
}

export class CommandDetector implements DestinationAdapter {
  readonly manifest: AdapterManifest
  private readonly runner: RoutingProcessRunner
  private readonly clock: () => Date

  constructor(manifest: AdapterManifest, runner: RoutingProcessRunner, clock: () => Date = () => new Date()) {
    this.manifest = manifest
    this.runner = runner
    this.clock = clock
  }

  async detect(signal: AbortSignal): Promise<DestinationDetectionDto> {
    const base = {
      adapterId: this.manifest.adapterId, displayName: this.manifest.displayName, controllability: this.manifest.controllability,
      readiness: 'unchecked' as const, executableLabel: this.manifest.executableLabel, supportedRange: this.manifest.supportedRange,
      testedCapabilities: [...this.manifest.testedCapabilities], evidenceAt: this.clock().toISOString(),
    }
    const result = await this.runner.run({ executable: this.manifest.executableLabel, args: this.manifest.versionArgs, timeoutMs: 2_000, maxOutputBytes: 8_192, signal })
    if (result.status === 'not-found') return { ...base, installation: 'not-found', compatibility: 'unknown', installedVersion: null, reasonCode: 'TOOL_NOT_FOUND', guidance: this.manifest.installationGuidance }
    if (result.status !== 'completed') return { ...base, installation: 'error', compatibility: 'unknown', installedVersion: null, reasonCode: result.status === 'timed-out' ? 'DETECTION_TIMEOUT' : result.status === 'output-limit' ? 'DETECTION_OUTPUT_LIMIT' : 'DETECTION_FAILED', guidance: 'Close any stuck process and check again.' }
    const version = `${result.stdout}\n${result.stderr}`.match(VERSION_PATTERN)?.[1] ?? null
    if (result.exitCode !== 0 || version === null) return { ...base, installation: 'detected', compatibility: 'unknown', installedVersion: null, reasonCode: 'VERSION_UNREADABLE', guidance: 'The tool was found, but its version could not be verified.' }
    const isSupported = supported(version, this.manifest.supportedRange)
    return { ...base, installation: 'detected', compatibility: isSupported ? 'supported' : 'unsupported', installedVersion: version, reasonCode: isSupported ? null : 'VERSION_UNSUPPORTED', guidance: isSupported ? this.manifest.authenticationGuidance : `Install a supported ${this.manifest.supportedRange} release, then check again.` }
  }
}
