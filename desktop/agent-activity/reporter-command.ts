import { join } from 'node:path'

export interface ActivityReporterCommandOptions {
  appRoot: string
  executablePath: string
  packaged: boolean
  resourcesPath?: string
}

export function activityReporterCommand(options: ActivityReporterCommandOptions): string {
  if (options.packaged) {
    if (!options.resourcesPath) throw new Error('ACTIVITY_REPORTER_RESOURCES_REQUIRED')
    const entry = join(options.resourcesPath, 'agent-activity', 'findmnemo-activity-entry.js')
    return `cscript.exe //nologo //E:JScript ${quote(entry)} -Executable ${quote(options.executablePath)}`
  }
  return `node ${quote(join(options.appRoot, 'dist-desktop', 'server', 'agent-activity', 'hook-reporter-command.js'))}`
}

function quote(value: string): string { return `"${value.replaceAll('"', '\\"')}"` }
