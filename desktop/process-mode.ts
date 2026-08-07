export type DesktopProcessMode =
  | { kind: 'gui' }
  | { kind: 'activity-hook' }
  | { kind: 'apply-uninstall-plan' }
  | { kind: 'mcp-server'; runnerArgs: string[] }
  | { kind: 'invalid'; errorCode: ProcessModeErrorCode }

export type ProcessModeErrorCode =
  | 'PROCESS_MODE_DUPLICATE'
  | 'PROCESS_MODE_CONFLICT'
  | 'PROCESS_MODE_INVALID'
  | 'PROCESS_MODE_REQUIRED'
  | 'MCP_LAUNCH_BINDING_REQUIRED'
  | 'MCP_LAUNCH_BINDING_INVALID'

const PROCESS_FLAGS = ['--mcp-server', '--activity-hook', '--apply-uninstall-plan'] as const

export function selectDesktopProcessMode(args: readonly string[]): DesktopProcessMode {
  if (args.some((arg) => PROCESS_FLAGS.some((flag) => arg.startsWith(`${flag}=`)))) {
    return { kind: 'invalid', errorCode: 'PROCESS_MODE_INVALID' }
  }
  const selected = PROCESS_FLAGS.flatMap((flag) => args.filter((arg) => arg === flag).map(() => flag))
  if (selected.length > 1) {
    return {
      kind: 'invalid',
      errorCode: new Set(selected).size === 1 ? 'PROCESS_MODE_DUPLICATE' : 'PROCESS_MODE_CONFLICT',
    }
  }
  const bindingArgs = args.filter((arg) => arg === '--origin' || arg.startsWith('--origin=') || arg === '--surface' || arg.startsWith('--surface='))
  if (!selected.length) {
    return bindingArgs.length
      ? { kind: 'invalid', errorCode: 'PROCESS_MODE_REQUIRED' }
      : { kind: 'gui' }
  }
  if (selected[0] === '--activity-hook') return { kind: 'activity-hook' }
  if (selected[0] === '--apply-uninstall-plan') return { kind: 'apply-uninstall-plan' }

  const origins = bindingArgs.filter((arg) => arg === '--origin' || arg.startsWith('--origin='))
  const surfaces = bindingArgs.filter((arg) => arg === '--surface' || arg.startsWith('--surface='))
  if (!origins.length || !surfaces.length) return { kind: 'invalid', errorCode: 'MCP_LAUNCH_BINDING_REQUIRED' }
  if (origins.length !== 1 || surfaces.length !== 1 || origins[0] === '--origin' || surfaces[0] === '--surface') {
    return { kind: 'invalid', errorCode: 'MCP_LAUNCH_BINDING_INVALID' }
  }
  return { kind: 'mcp-server', runnerArgs: [origins[0], surfaces[0]] }
}
