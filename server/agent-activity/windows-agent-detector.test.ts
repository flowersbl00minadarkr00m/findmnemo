import { describe, expect, it, vi } from 'vitest'
import { detectWindowsAgentActivityStatus, detectWindowsAgentActivityVersions } from './windows-agent-detector.js'

describe('Windows agent activity version detection', () => {
  it('uses exact executable forms and keeps each agent result independent', async () => {
    const runner = vi.fn(async (command: string, args: readonly string[]) => {
      if (args[0] === '--version' && command === 'codex.exe') return { code: 0, output: 'codex-cli 0.144.3' }
      if (args[0] === '--version' && command === 'claude.exe') return { code: 0, output: '2.1.207 (Claude Code)' }
      if (args[0] === '--version' && command === 'pi.cmd') return { code: 0, output: '0.80.7' }
      if (command === 'codex.exe' && args.join(' ') === 'login status') return { code: 0, output: 'signed in' }
      if (command === 'claude.exe' && args.join(' ') === 'auth status --json') return { code: 0, output: '{\n  "loggedIn": true,\n  "privateField": "discarded"\n}' }
      return { code: 1, output: '' }
    })
    const status = await detectWindowsAgentActivityStatus(runner, () => new Date('2026-07-14T22:00:00.000Z'))
    expect(status).toEqual({
      'codex-cli': { installedVersion: '0.144.3', agentAuthState: 'authenticated', checkedAt: '2026-07-14T22:00:00.000Z' },
      'claude-code': { installedVersion: '2.1.207', agentAuthState: 'authenticated', checkedAt: '2026-07-14T22:00:00.000Z' },
      pi: { installedVersion: '0.80.7', agentAuthState: 'not-applicable', checkedAt: '2026-07-14T22:00:00.000Z' },
    })
    expect(JSON.stringify(status)).not.toMatch(/privateField|signed in/)
    expect(runner).toHaveBeenCalledTimes(5)
  })

  it('falls back without promoting an unreadable version', async () => {
    const runner = vi.fn(async (command: string) => command.endsWith('.exe') ? { code: 0, output: 'unknown' } : { code: 1, output: '' })
    await expect(detectWindowsAgentActivityVersions(runner)).resolves.toEqual({ 'codex-cli': null, 'claude-code': null, pi: null })
  })
})
