export type TokscaleCompatibilityState = 'supported' | 'unsupported' | 'unverified'

export interface TokscaleCompatibilityResult {
  state: TokscaleCompatibilityState
  installedVersion: string | null
  supportedRange: string
  adapterId: string | null
  reasonCode: string | null
}

export interface TokscaleCompatibilityManifest {
  adapterId: string
  supportedRange: string
  supportedVersions: readonly string[]
  fixtureVersions: readonly string[]
  schemaIds: {
    graph: string
    models: string
    clients: string
  }
  totalTokenRule: 'sum-input-output-cache-read-cache-write-reasoning'
}

export const TOKSCALE_COMPATIBILITY_MANIFEST: TokscaleCompatibilityManifest = {
  adapterId: 'tokscale-v4.4-v4.5',
  supportedRange: '4.4.1 or 4.5.2',
  supportedVersions: ['4.4.1', '4.5.2'],
  fixtureVersions: ['4.4.1', '4.5.2'],
  schemaIds: {
    graph: 'tokscale.graph.v4.4-v4.5',
    models: 'tokscale.models.v4.4-v4.5',
    clients: 'tokscale.clients.v4.4-v4.5',
  },
  totalTokenRule: 'sum-input-output-cache-read-cache-write-reasoning',
}

function parseSemver(input: string): readonly [number, number, number] | null {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(input.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function resolveTokscaleCompatibility(version: string): TokscaleCompatibilityResult {
  const parsed = parseSemver(version)
  if (!parsed) {
    return {
      state: 'unverified',
      installedVersion: null,
      supportedRange: TOKSCALE_COMPATIBILITY_MANIFEST.supportedRange,
      adapterId: null,
      reasonCode: 'TOKSCALE_VERSION_UNPARSEABLE',
    }
  }
  const normalized = parsed.join('.')
  const supported = TOKSCALE_COMPATIBILITY_MANIFEST.supportedVersions.includes(normalized)
  return {
    state: supported ? 'supported' : 'unsupported',
    installedVersion: normalized,
    supportedRange: TOKSCALE_COMPATIBILITY_MANIFEST.supportedRange,
    adapterId: supported ? TOKSCALE_COMPATIBILITY_MANIFEST.adapterId : null,
    reasonCode: supported ? null : 'TOKSCALE_VERSION_UNSUPPORTED',
  }
}
