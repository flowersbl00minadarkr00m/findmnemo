import type { CredentialCapabilityDto, SourceRunCapabilityReport } from '../../shared/companion-contract.js'

export type LinuxEnvironment = 'ubuntu-24.04-desktop' | 'glibc' | 'musl' | 'wsl' | 'headless'

export interface PlatformCapabilityInput {
  platform?: NodeJS.Platform
  architecture?: string
  nodeVersion?: string
  linuxEnvironment?: LinuxEnvironment
  cleanHostAccepted?: boolean
  filesystem: SourceRunCapabilityReport['filesystem']
  listener: SourceRunCapabilityReport['listener']
  database: SourceRunCapabilityReport['database']
  gmailConfigured: boolean
  credentialCapability: CredentialCapabilityDto
  generatedAt?: string
}

export function createSourceRunCapabilityReport(input: PlatformCapabilityInput): SourceRunCapabilityReport {
  const platform = input.platform ?? process.platform
  const architecture = input.architecture ?? process.arch
  const detected = input.nodeVersion ?? process.version
  const nodeSupported = nodeMajor(detected) === 24
  let supportLevel = matrixSupport(platform, architecture, input.linuxEnvironment, input.cleanHostAccepted === true)
  if (supportLevel === 'supported' && (!nodeSupported || !input.filesystem.dataRootWritable || input.credentialCapability.state !== 'available')) {
    supportLevel = 'experimental'
  }
  return {
    schemaVersion: 1,
    platform,
    architecture,
    supportLevel,
    node: { detected: safeVersion(detected), requiredMajor: 24, supported: nodeSupported, code: nodeSupported ? 'NODE_VERSION_SUPPORTED' : 'NODE_VERSION_UNSUPPORTED' },
    filesystem: input.filesystem,
    listener: input.listener,
    database: input.database,
    gmail: { configured: input.gmailConfigured && input.credentialCapability.state === 'available', credentialStore: input.credentialCapability },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  }
}

function matrixSupport(platform: NodeJS.Platform, architecture: string, linuxEnvironment: LinuxEnvironment | undefined, accepted: boolean): SourceRunCapabilityReport['supportLevel'] {
  if (platform === 'win32') return architecture === 'x64' ? 'supported' : 'unsupported'
  if (platform === 'darwin') return architecture === 'x64' || architecture === 'arm64' ? (accepted ? 'supported' : 'experimental') : 'unsupported'
  if (platform !== 'linux' || (architecture !== 'x64' && architecture !== 'arm64')) return 'unsupported'
  if (linuxEnvironment === 'musl' || linuxEnvironment === 'wsl' || linuxEnvironment === 'headless') return 'unsupported'
  if (linuxEnvironment === 'ubuntu-24.04-desktop') return accepted ? 'supported' : 'experimental'
  return 'experimental'
}

function nodeMajor(version: string): number | undefined {
  const match = version.match(/^v?(\d+)/)
  return match ? Number(match[1]) : undefined
}

function safeVersion(version: string): string {
  const match = version.match(/^v?\d+(?:\.\d+){0,2}/)
  return match?.[0] ?? 'unknown'
}
