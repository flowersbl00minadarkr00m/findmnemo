import { win32 } from 'node:path'
import type { PreciseExecutionSurface } from '../../shared/agent-activity-contract.js'

type McpCommandSurface = Exclude<PreciseExecutionSurface, 'pi-cli'>

export interface InstalledMcpCommandOptions {
  verifiedExecutablePath: string
  surface: PreciseExecutionSurface
}

export interface InstalledMcpCommand {
  executable: string
  args: ['--mcp-server', `--origin=${'codex-mcp' | 'claude-code-mcp'}`, `--surface=${McpCommandSurface}`]
}

export function installedMcpCommand(options: InstalledMcpCommandOptions): InstalledMcpCommand {
  const executable = options.verifiedExecutablePath
  if (
    !win32.isAbsolute(executable) ||
    win32.basename(executable).toLowerCase() !== 'findmnemo companion.exe' ||
    /(?:^|[\\/])app\.asar(?:[\\/]|$)/i.test(executable)
  ) throw new Error('MCP_EXECUTABLE_PATH_INVALID')
  if (options.surface === 'pi-cli') throw new Error('MCP_SURFACE_COMMAND_UNSUPPORTED')
  const origin = options.surface.startsWith('claude-') ? 'claude-code-mcp' : 'codex-mcp'
  return {
    executable,
    args: ['--mcp-server', `--origin=${origin}`, `--surface=${options.surface}`],
  }
}
