import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { activityReporterCommand } from './reporter-command.js'

describe('packaged activity reporter command', () => {
  it('invokes the packaged executable as an owned hook helper without embedding credentials', () => {
    const command = activityReporterCommand({
      appRoot: String.raw`C:\Program Files\FindMnemo Companion\resources\app.asar`,
      executablePath: String.raw`C:\Program Files\FindMnemo Companion\FindMnemo Companion.exe`,
      packaged: true,
      resourcesPath: String.raw`C:\Program Files\FindMnemo Companion\resources`,
    })

    expect(command).toBe(String.raw`cscript.exe //nologo //E:JScript "C:\Program Files\FindMnemo Companion\resources\agent-activity\findmnemo-activity-entry.js" -Executable "C:\Program Files\FindMnemo Companion\FindMnemo Companion.exe"`)
    expect(command).not.toMatch(/token|secret|credential/i)
  })

  it('uses the compiled helper directly during source development', () => {
    const command = activityReporterCommand({ appRoot: String.raw`C:\src\findmnemo`, executablePath: 'electron.exe', packaged: false })
    expect(command).toBe(String.raw`node "C:\src\findmnemo\dist-desktop\server\agent-activity\hook-reporter-command.js"`)
  })

  it('allowlists hook fields before launching the non-blocking packaged reporter', async () => {
    const entryUrl = new URL('./findmnemo-activity-entry.js', import.meta.url)
    const entry = await readFile(entryUrl, 'utf8')
    expect(entry).toContain("new ActiveXObject('WScript.Shell').Run(command, 0, false)")
    expect(entry).toContain("' <NUL >NUL 2>&1'")
    expect(entry).not.toMatch(/(?:transcript_path|last_assistant_message|tool_input)/i)
    if (process.platform !== 'win32') return
    const expectedExecutable = resolve(fileURLToPath(new URL('.', entryUrl)), '..', '..', 'FindMnemo Companion.exe')
    const result = spawnSync('cscript.exe', ['//nologo', '//E:JScript', fileURLToPath(entryUrl), '-Owner', 'findmnemo-agent-activity-v1', '-Agent', 'claude-code', '-Executable', expectedExecutable, '-ValidationOnly', 'findmnemo-sanitizer-test-v1'], {
      input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'safe-session', model: 'safe-model', generation: 2, task_subject: 'Safe résumé', prompt: 'private', nested: { response: 'private' } }),
      encoding: 'utf8', windowsHide: true,
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(Buffer.from(result.stdout.trim(), 'base64').toString('utf8'))).toEqual({ hook_event_name: 'SessionStart', session_id: 'safe-session', model: 'safe-model', generation: 2, task_subject: 'Safe résumé' })
  })
})
