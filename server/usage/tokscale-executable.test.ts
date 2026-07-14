import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTokscaleInvocation } from './tokscale-executable.js'

describe('embedded Tokscale collector resolution', () => {
  const resourcesPath = 'C:\\FindMnemo\\resources'
  const sourceRoot = 'C:\\FindMnemo\\node_modules'
  const packaged = join(resourcesPath, 'tokscale', 'tokscale.exe')
  const source = join(sourceRoot, '@tokscale', 'cli-win32-x64-msvc', 'bin', 'tokscale.exe')
  const external = 'C:\\support\\tokscale.exe'

  it('prefers the packaged collector over source and explicit external recovery', () => {
    const present = new Set([packaged, source, external])
    expect(resolveTokscaleInvocation({
      platform: 'win32', arch: 'x64', resourcesPath, sourceRoots: [sourceRoot], externalRecoveryExecutable: external,
      exists: (path) => present.has(path),
    })).toEqual({ ok: true, source: 'embedded', variant: 'packaged', executable: packaged, prefixArgs: [] })
  })

  it('uses the locked source dependency without consulting ambient PATH', () => {
    expect(resolveTokscaleInvocation({
      platform: 'win32', arch: 'x64', resourcesPath, sourceRoots: [sourceRoot],
      exists: (path) => path === source,
    })).toEqual({ ok: true, source: 'embedded', variant: 'source', executable: source, prefixArgs: [] })
  })

  it('uses an explicit absolute external path only after embedded candidates are absent', () => {
    expect(resolveTokscaleInvocation({
      platform: 'win32', arch: 'x64', resourcesPath, sourceRoots: [sourceRoot], externalRecoveryExecutable: external,
      exists: (path) => path === external,
    })).toEqual({ ok: true, source: 'external-recovery', variant: 'external', executable: external, prefixArgs: [] })
  })

  it('fails closed for missing, invalid external, and unsupported-platform assets', () => {
    expect(resolveTokscaleInvocation({ platform: 'win32', arch: 'x64', resourcesPath, sourceRoots: [sourceRoot], exists: () => false })).toEqual({
      ok: false, source: 'unavailable', reasonCode: 'TOKSCALE_EMBEDDED_MISSING',
    })
    expect(resolveTokscaleInvocation({ platform: 'win32', arch: 'x64', sourceRoots: [], externalRecoveryExecutable: 'tokscale', exists: () => true })).toEqual({
      ok: false, source: 'unavailable', reasonCode: 'TOKSCALE_EXTERNAL_RECOVERY_INVALID',
    })
    expect(resolveTokscaleInvocation({ platform: 'freebsd', arch: 'x64', sourceRoots: [], exists: () => false })).toEqual({
      ok: false, source: 'unavailable', reasonCode: 'TOKSCALE_EMBEDDED_UNSUPPORTED_PLATFORM',
    })
  })
})
