import { posix, win32 } from 'node:path'

export type SupportedPlatform = 'win32' | 'darwin' | 'linux'
export type PlatformPathErrorCode = 'UNSUPPORTED_PLATFORM' | 'DATA_ROOT_UNAVAILABLE'

export interface PlatformPaths {
  platform: SupportedPlatform
  dataRoot: string
  databasePath: string
  logsRoot: string
  backupsRoot: string
}

export interface ResolvePlatformPathsInput {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
  dataRootOverride?: string
}

export class PlatformPathError extends Error {
  readonly code: PlatformPathErrorCode

  constructor(code: PlatformPathErrorCode, message: string) {
    super(message)
    this.name = 'PlatformPathError'
    this.code = code
  }
}

export function resolvePlatformPaths(input: ResolvePlatformPathsInput = {}): PlatformPaths {
  const platform = input.platform ?? process.platform
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    throw new PlatformPathError('UNSUPPORTED_PLATFORM', 'This operating system is not supported by the source-run companion.')
  }

  const env = input.env ?? process.env
  const pathApi = platform === 'win32' ? win32 : posix
  let dataRoot: string
  if (input.dataRootOverride !== undefined) {
    if (!pathApi.isAbsolute(input.dataRootOverride)) {
      throw new PlatformPathError('DATA_ROOT_UNAVAILABLE', 'The explicit FindMnemo data root must be absolute.')
    }
    dataRoot = pathApi.normalize(input.dataRootOverride)
  } else if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    if (!localAppData || !win32.isAbsolute(localAppData)) {
      throw new PlatformPathError('DATA_ROOT_UNAVAILABLE', 'Windows local application data is unavailable.')
    }
    dataRoot = win32.join(localAppData, 'FindMnemo')
  } else if (platform === 'darwin') {
    const home = input.homeDir
    if (!home || !posix.isAbsolute(home)) throw new PlatformPathError('DATA_ROOT_UNAVAILABLE', 'The macOS home directory is unavailable.')
    dataRoot = posix.join(home, 'Library', 'Application Support', 'FindMnemo')
  } else {
    const xdgDataHome = env.XDG_DATA_HOME
    if (xdgDataHome !== undefined && (!xdgDataHome || !posix.isAbsolute(xdgDataHome))) {
      throw new PlatformPathError('DATA_ROOT_UNAVAILABLE', 'XDG_DATA_HOME must be an absolute path.')
    }
    if (xdgDataHome) dataRoot = posix.join(xdgDataHome, 'FindMnemo')
    else {
      const home = input.homeDir
      if (!home || !posix.isAbsolute(home)) throw new PlatformPathError('DATA_ROOT_UNAVAILABLE', 'The Linux home directory is unavailable.')
      dataRoot = posix.join(home, '.local', 'share', 'FindMnemo')
    }
  }

  return {
    platform,
    dataRoot,
    databasePath: pathApi.join(dataRoot, 'findmnemo.db'),
    logsRoot: pathApi.join(dataRoot, 'logs'),
    backupsRoot: pathApi.join(dataRoot, 'backups'),
  }
}
