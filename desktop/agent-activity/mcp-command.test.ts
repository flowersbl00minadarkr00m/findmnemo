import { describe, expect, it } from 'vitest'
import { installedMcpCommand } from './mcp-command.js'

describe('installed MCP command', () => {
  it.each([
    ['codex-cli', 'codex-mcp'],
    ['codex-desktop', 'codex-mcp'],
    ['claude-code-cli', 'claude-code-mcp'],
    ['claude-desktop-code', 'claude-code-mcp'],
    ['claude-desktop-home', 'claude-code-mcp'],
  ] as const)('returns only the verified executable and fixed non-secret flags for %s', (surface, origin) => {
    const executable = String.raw`C:\Program Files\FindMnemo Companion\FindMnemo Companion.exe`
    expect(installedMcpCommand({ verifiedExecutablePath: executable, surface })).toEqual({
      executable,
      args: ['--mcp-server', `--origin=${origin}`, `--surface=${surface}`],
    })
  })

  it.each([
    [String.raw`FindMnemo Companion.exe`, 'MCP_EXECUTABLE_PATH_INVALID'],
    [String.raw`C:\Program Files\nodejs\node.exe`, 'MCP_EXECUTABLE_PATH_INVALID'],
    [String.raw`C:\Program Files\FindMnemo Companion\resources\app.asar\dist-desktop\desktop\main.js`, 'MCP_EXECUTABLE_PATH_INVALID'],
    [String.raw`C:\source\mnemosync\dist-desktop\desktop\main.js`, 'MCP_EXECUTABLE_PATH_INVALID'],
  ])('rejects non-installed or internal launcher %s', (verifiedExecutablePath, code) => {
    expect(() => installedMcpCommand({ verifiedExecutablePath, surface: 'codex-cli' })).toThrow(code)
  })

  it('rejects a surface without the packaged MCP origin contract', () => {
    expect(() => installedMcpCommand({
      verifiedExecutablePath: String.raw`C:\Program Files\FindMnemo Companion\FindMnemo Companion.exe`,
      surface: 'pi-cli',
    })).toThrow('MCP_SURFACE_COMMAND_UNSUPPORTED')
  })
})
