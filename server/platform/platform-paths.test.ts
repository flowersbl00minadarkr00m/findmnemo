import { describe, expect, it } from 'vitest'
import { PlatformPathError, resolvePlatformPaths } from './platform-paths.js'

describe('platform paths', () => {
  it.each([
    ['win32', { LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local' }, undefined, 'C:\\Users\\fixture\\AppData\\Local\\FindMnemo\\findmnemo.db'],
    ['darwin', {}, '/Users/fixture', '/Users/fixture/Library/Application Support/FindMnemo/findmnemo.db'],
    ['linux', {}, '/home/fixture', '/home/fixture/.local/share/FindMnemo/findmnemo.db'],
  ] as const)('resolves the %s default without using host path semantics', (platform, env, homeDir, databasePath) => {
    const paths = resolvePlatformPaths({ platform, env, homeDir })
    expect(paths.databasePath).toBe(databasePath)
    expect(paths.logsRoot).toMatch(/FindMnemo[\\/]logs$/)
    expect(paths.backupsRoot).toMatch(/FindMnemo[\\/]backups$/)
  })

  it('uses an absolute XDG data root and keeps the app namespace', () => {
    expect(resolvePlatformPaths({ platform: 'linux', env: { XDG_DATA_HOME: '/srv/user-data' }, homeDir: '/ignored' }).dataRoot)
      .toBe('/srv/user-data/FindMnemo')
  })

  it.each([
    ['win32', 'D:\\Private\\FindMnemo'],
    ['darwin', '/Volumes/private/FindMnemo'],
    ['linux', '/mnt/private/FindMnemo'],
  ] as const)('accepts an absolute %s override', (platform, dataRootOverride) => {
    expect(resolvePlatformPaths({ platform, env: {}, homeDir: '/unused', dataRootOverride }).dataRoot).toBe(dataRootOverride)
  })

  it.each([
    [{ platform: 'freebsd', env: {}, homeDir: '/home/fixture' }, 'UNSUPPORTED_PLATFORM'],
    [{ platform: 'win32', env: {} }, 'DATA_ROOT_UNAVAILABLE'],
    [{ platform: 'darwin', env: {}, homeDir: undefined }, 'DATA_ROOT_UNAVAILABLE'],
    [{ platform: 'linux', env: {}, homeDir: undefined }, 'DATA_ROOT_UNAVAILABLE'],
    [{ platform: 'linux', env: { XDG_DATA_HOME: 'relative/data' }, homeDir: '/home/fixture' }, 'DATA_ROOT_UNAVAILABLE'],
    [{ platform: 'linux', env: {}, homeDir: '/home/fixture', dataRootOverride: 'relative/data' }, 'DATA_ROOT_UNAVAILABLE'],
  ] as const)('fails safely for unresolved or unsupported input %#', (input, code) => {
    expect(() => resolvePlatformPaths(input)).toThrowError(PlatformPathError)
    try { resolvePlatformPaths(input) } catch (cause) { expect(cause).toMatchObject({ code }) }
  })
})
