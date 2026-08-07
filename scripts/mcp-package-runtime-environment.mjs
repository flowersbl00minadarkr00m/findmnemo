import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function createMcpPackageRuntimeEnvironment({
  parentEnvironment,
  temporaryRoot,
  phase,
  localAppData,
}) {
  const userProfile = parentEnvironment.USERPROFILE
  if (typeof userProfile !== 'string' || userProfile.length === 0) {
    throw new Error('MCP_PACKAGE_USERPROFILE_UNAVAILABLE')
  }

  const profile = join(temporaryRoot, phase)
  const roaming = join(profile, 'Roaming')
  const temp = join(profile, 'Temp')
  const home = join(profile, 'Home')
  for (const path of [roaming, localAppData, temp, home]) {
    mkdirSync(path, { recursive: true })
  }

  return {
    ...parentEnvironment,
    APPDATA: roaming,
    LOCALAPPDATA: localAppData,
    TEMP: temp,
    TMP: temp,
    HOME: home,
    USERPROFILE: userProfile,
    FINDMNEMO_ACTIVITY_ACCEPTANCE: '',
  }
}
