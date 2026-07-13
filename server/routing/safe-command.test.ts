import { describe, expect, it } from 'vitest'
import { safeSpawnCommand } from './safe-command.js'

describe('safe Windows command shims', () => {
  it('accepts fixed safe tokens and rejects shell metacharacters on Windows', () => {
    const safe = safeSpawnCommand('pi.cmd', ['--mode', 'rpc'])
    if (process.platform === 'win32') {
      expect(safe.args).toEqual(['/d', '/c', 'pi.cmd --mode rpc'])
      expect(() => safeSpawnCommand('pi.cmd', ['rpc&whoami'])).toThrow('UNSAFE_COMMAND_SHIM')
      expect(() => safeSpawnCommand('C:\\private\\pi.cmd', ['--version'])).toThrow('UNSAFE_COMMAND_SHIM')
    } else expect(safe).toEqual({ executable: 'pi.cmd', args: ['--mode', 'rpc'] })
  })
})
