import { describe, expect, it } from 'vitest'
import { selectDesktopProcessMode } from './process-mode.js'

describe('desktop process-mode selection', () => {
  it('selects one fixed MCP mode before GUI handling', () => {
    expect(selectDesktopProcessMode([
      '--mcp-server',
      '--origin=codex-mcp',
      '--surface=codex-cli',
    ])).toEqual({
      kind: 'mcp-server',
      runnerArgs: ['--origin=codex-mcp', '--surface=codex-cli'],
    })
  })

  it('keeps GUI and existing executable modes distinct', () => {
    expect(selectDesktopProcessMode([])).toEqual({ kind: 'gui' })
    expect(selectDesktopProcessMode(['--activity-hook', '--adapter', 'codex-cli'])).toEqual({ kind: 'activity-hook' })
    expect(selectDesktopProcessMode(['--apply-uninstall-plan'])).toEqual({ kind: 'apply-uninstall-plan' })
  })

  it.each([
    [['--mcp-server', '--mcp-server', '--origin=codex-mcp', '--surface=codex-cli'], 'PROCESS_MODE_DUPLICATE'],
    [['--mcp-server', '--activity-hook', '--origin=codex-mcp', '--surface=codex-cli'], 'PROCESS_MODE_CONFLICT'],
    [['--mcp-server=1', '--origin=codex-mcp', '--surface=codex-cli'], 'PROCESS_MODE_INVALID'],
    [['--origin=codex-mcp', '--surface=codex-cli'], 'PROCESS_MODE_REQUIRED'],
    [['--mcp-server'], 'MCP_LAUNCH_BINDING_REQUIRED'],
    [['--mcp-server', '--origin=codex-mcp', '--origin=codex-mcp', '--surface=codex-cli'], 'MCP_LAUNCH_BINDING_INVALID'],
    [['--mcp-server', '--origin=codex-mcp', '--surface=codex-cli', '--surface=codex-cli'], 'MCP_LAUNCH_BINDING_INVALID'],
  ] as const)('fails closed with a stable safe code for %j', (args, errorCode) => {
    expect(selectDesktopProcessMode(args)).toEqual({ kind: 'invalid', errorCode })
  })
})
