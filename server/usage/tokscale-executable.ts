import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type TokscaleCollectorSource = 'embedded' | 'external-recovery' | 'unavailable'
export type TokscaleCollectorVariant = 'packaged' | 'source' | 'external'
export type TokscaleResolutionCode =
  | 'TOKSCALE_EMBEDDED_MISSING'
  | 'TOKSCALE_EMBEDDED_UNSUPPORTED_PLATFORM'
  | 'TOKSCALE_EXTERNAL_RECOVERY_INVALID'
  | 'TOKSCALE_EXTERNAL_RECOVERY_UNAVAILABLE'

export type TokscaleInvocation =
  | {
      ok: true
      source: Exclude<TokscaleCollectorSource, 'unavailable'>
      variant: TokscaleCollectorVariant
      executable: string
      prefixArgs: string[]
    }
  | { ok: false; source: 'unavailable'; reasonCode: TokscaleResolutionCode }

interface TokscalePlatformAsset {
  packageName: string
  binaryName: string
}

export interface TokscaleResolutionOptions {
  platform?: NodeJS.Platform
  arch?: string
  resourcesPath?: string
  sourceRoots?: string[]
  externalRecoveryExecutable?: string
  exists?: (path: string) => boolean
}

const PLATFORM_ASSETS: Readonly<Record<string, TokscalePlatformAsset>> = {
  'darwin-arm64': { packageName: 'cli-darwin-arm64', binaryName: 'tokscale' },
  'darwin-x64': { packageName: 'cli-darwin-x64', binaryName: 'tokscale' },
  'linux-arm64': { packageName: 'cli-linux-arm64-gnu', binaryName: 'tokscale' },
  'linux-x64': { packageName: 'cli-linux-x64-gnu', binaryName: 'tokscale' },
  'win32-arm64': { packageName: 'cli-win32-arm64-msvc', binaryName: 'tokscale.exe' },
  'win32-x64': { packageName: 'cli-win32-x64-msvc', binaryName: 'tokscale.exe' },
}

const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))

export function resolveTokscaleInvocation(options: TokscaleResolutionOptions = {}): TokscaleInvocation {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const asset = PLATFORM_ASSETS[`${platform}-${arch}`]
  if (!asset) return { ok: false, source: 'unavailable', reasonCode: 'TOKSCALE_EMBEDDED_UNSUPPORTED_PLATFORM' }

  const exists = options.exists ?? existsSync
  const resourcesPath = options.resourcesPath ?? electronResourcesPath()
  if (resourcesPath) {
    const packaged = join(resourcesPath, 'tokscale', asset.binaryName)
    if (exists(packaged)) return { ok: true, source: 'embedded', variant: 'packaged', executable: packaged, prefixArgs: [] }
  }

  const sourceRoots = options.sourceRoots ?? defaultSourceRoots()
  for (const root of sourceRoots) {
    const candidates = [
      join(root, '@tokscale', asset.packageName, 'bin', asset.binaryName),
      join(root, '@tokscale', 'cli', 'node_modules', '@tokscale', asset.packageName, 'bin', asset.binaryName),
    ]
    const source = candidates.find(exists)
    if (source) return { ok: true, source: 'embedded', variant: 'source', executable: source, prefixArgs: [] }
  }

  const external = options.externalRecoveryExecutable?.trim()
  if (external) {
    if (!isAbsolute(external)) return { ok: false, source: 'unavailable', reasonCode: 'TOKSCALE_EXTERNAL_RECOVERY_INVALID' }
    if (exists(external)) return { ok: true, source: 'external-recovery', variant: 'external', executable: external, prefixArgs: [] }
    return { ok: false, source: 'unavailable', reasonCode: 'TOKSCALE_EXTERNAL_RECOVERY_UNAVAILABLE' }
  }

  return { ok: false, source: 'unavailable', reasonCode: 'TOKSCALE_EMBEDDED_MISSING' }
}

function defaultSourceRoots(): string[] {
  return [...new Set([
    resolve(process.cwd(), 'node_modules'),
    resolve(moduleDirectory, '..', '..', 'node_modules'),
    resolve(moduleDirectory, '..', '..', '..', 'node_modules'),
  ])]
}

function electronResourcesPath(): string | undefined {
  const candidate = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}
