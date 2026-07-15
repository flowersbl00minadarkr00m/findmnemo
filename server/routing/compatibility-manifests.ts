import type { AdapterQualificationManifest } from './adapter-contract.js'

export const ROUTING_COMPATIBILITY_MANIFESTS: Record<string, AdapterQualificationManifest> = {
  'pi-rpc': { adapterId: 'pi-rpc', support: 'controllable', supportedVersions: '0.x', authMode: 'tool-owned', catalogMode: 'live-rpc', actualRouteEvidence: ['provider', 'model', 'effort'], cancellation: 'both' },
  'codex-cli': { adapterId: 'codex-cli', support: 'controllable', supportedVersions: '0.x', authMode: 'tool-owned', catalogMode: 'tested-manifest', actualRouteEvidence: [], cancellation: 'process-tree' },
  'claude-code-cli': { adapterId: 'claude-code-cli', support: 'controllable', supportedVersions: '2.x', authMode: 'tool-owned', catalogMode: 'tested-manifest', actualRouteEvidence: [], cancellation: 'process-tree' },
  'ollama-local': { adapterId: 'ollama-local', support: 'controllable', supportedVersions: '0.x', authMode: 'local-runtime', catalogMode: 'installed-local', actualRouteEvidence: ['model'], cancellation: 'abort-request' },
  openrouter: { adapterId: 'openrouter', support: 'controllable', supportedVersions: '1.x', authMode: 'companion-oauth', catalogMode: 'live-http', actualRouteEvidence: ['model'], cancellation: 'abort-request' },
}
