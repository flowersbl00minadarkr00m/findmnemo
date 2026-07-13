import type { DestinationAdapter, RoutingProcessRunner } from '../adapter-contract.js'
import { CommandDetector } from './command-detector.js'

export function createDetectionOnlyAdapters(runner: RoutingProcessRunner, clock?: () => Date): DestinationAdapter[] {
  const candidates = [
    ['codex-cli', 'Codex CLI', 'codex', 'Codex'],
    ['claude-code', 'Claude Code', 'claude', 'Claude Code'],
    ['gemini-cli', 'Gemini CLI', 'gemini', 'Gemini CLI'],
    ['ollama', 'Ollama', 'ollama', 'Ollama'],
  ] as const
  return candidates.map(([adapterId, displayName, executableLabel, product]) => new CommandDetector({
    adapterId, displayName, executableLabel, versionArgs: ['--version'], supportedRange: '*', testedCapabilities: ['detection'], controllability: 'detection-only',
    installationGuidance: `Install ${product} using its official instructions, then run Check again.`, authenticationGuidance: `${product} was found. Add it manually as a recommendation-only route; dispatch is not qualified.`,
  }, runner, clock))
}
