import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentKind } from '../../shared/agent-activity-contract.js'
import type { AgentActivitySetupPort } from '../../server/agent-activity/management-service.js'

const OWNER = 'findmnemo-agent-activity-v1'
const PI_FILE = 'findmnemo-activity.ts'
const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'StopFailure', 'SessionEnd', 'TaskCreated', 'TaskCompleted'] as const
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop'] as const

export interface IntegrationInstallReceipt { target: string; state: 'configured' | 'not-configured' | 'invalid'; owned: boolean; changed: boolean; backup: string | null }

export class AgentActivityIntegrationInstaller {
  async installPi(input: { extensionDirectory: string; reporterCommand: string }): Promise<IntegrationInstallReceipt> {
    assertSafeCommand(input.reporterCommand)
    const target = join(input.extensionDirectory, PI_FILE)
    await mkdir(input.extensionDirectory, { recursive: true })
    const current = await optionalRead(target)
    if (current !== undefined && !current.includes(OWNER)) throw new Error('INTEGRATION_TARGET_NOT_OWNED')
    const content = piExtension(`${input.reporterCommand} -Owner ${OWNER} -Agent pi`)
    if (current === content) return { target, state: 'configured', owned: true, changed: false, backup: null }
    const backup = current === undefined ? null : `${target}.findmnemo-backup`
    if (backup) await copyFile(target, backup)
    await atomicWrite(target, content)
    return { target, state: 'configured', owned: true, changed: true, backup }
  }

  async verifyPi(extensionDirectory: string): Promise<IntegrationInstallReceipt> {
    const target = join(extensionDirectory, PI_FILE)
    const content = await optionalRead(target)
    if (content === undefined) return { target, state: 'not-configured', owned: false, changed: false, backup: null }
    const owned = content.includes(OWNER)
    return { target, state: owned ? 'configured' : 'invalid', owned, changed: false, backup: null }
  }

  async removePi(extensionDirectory: string): Promise<IntegrationInstallReceipt> {
    const current = await this.verifyPi(extensionDirectory)
    if (current.state === 'not-configured') return current
    if (!current.owned) throw new Error('INTEGRATION_TARGET_NOT_OWNED')
    await rm(current.target)
    await rm(`${current.target}.findmnemo-backup`, { force: true })
    return { ...current, state: 'not-configured', changed: true }
  }

  async installClaude(input: { settingsPath: string; reporterCommand: string }): Promise<IntegrationInstallReceipt> {
    assertSafeCommand(input.reporterCommand)
    const current = await optionalRead(input.settingsPath)
    const document = parseJsonObject(current ?? '{}')
    const hooks = jsonObject(document.hooks)
    const command = `${input.reporterCommand} -Owner ${OWNER} -Agent claude-code`
    for (const event of CLAUDE_EVENTS) {
      const groups = Array.isArray(hooks[event]) ? [...hooks[event] as unknown[]] : []
      if (!JSON.stringify(groups).includes(`-Owner ${OWNER}`)) groups.push({ hooks: [{ type: 'command', command, timeout: 1 }] })
      hooks[event] = groups
    }
    document.hooks = hooks
    const next = `${JSON.stringify(document, null, 2)}\n`
    if (next === current) return { target: input.settingsPath, state: 'configured', owned: true, changed: false, backup: null }
    await mkdir(dirnameOf(input.settingsPath), { recursive: true })
    const backup = current === undefined ? null : `${input.settingsPath}.findmnemo-backup`
    if (backup) await copyFile(input.settingsPath, backup)
    await atomicWrite(input.settingsPath, next)
    return { target: input.settingsPath, state: 'configured', owned: true, changed: true, backup }
  }

  async verifyClaude(settingsPath: string): Promise<IntegrationInstallReceipt> {
    const current = await optionalRead(settingsPath)
    if (current === undefined) return { target: settingsPath, state: 'not-configured', owned: false, changed: false, backup: null }
    let owned = false
    try { owned = JSON.stringify(parseJsonObject(current)).includes(`-Owner ${OWNER}`) } catch { return { target: settingsPath, state: 'invalid', owned: false, changed: false, backup: null } }
    return { target: settingsPath, state: owned ? 'configured' : 'not-configured', owned, changed: false, backup: null }
  }

  async removeClaude(settingsPath: string): Promise<IntegrationInstallReceipt> {
    const current = await optionalRead(settingsPath)
    if (current === undefined) return { target: settingsPath, state: 'not-configured', owned: false, changed: false, backup: null }
    const document = parseJsonObject(current)
    const hooks = jsonObject(document.hooks)
    let changed = false
    for (const [event, value] of Object.entries(hooks)) {
      if (!Array.isArray(value)) continue
      const groups = value.flatMap((group) => {
        if (!group || typeof group !== 'object' || Array.isArray(group)) return [group]
        const copy = { ...group as Record<string, unknown> }
        if (!Array.isArray(copy.hooks)) return [copy]
        const kept = copy.hooks.filter((hook) => !JSON.stringify(hook).includes(`-Owner ${OWNER}`))
        if (kept.length !== copy.hooks.length) changed = true
        if (!kept.length) return []
        copy.hooks = kept
        return [copy]
      })
      if (groups.length) hooks[event] = groups
      else delete hooks[event]
    }
    if (!changed) return { target: settingsPath, state: 'not-configured', owned: false, changed: false, backup: null }
    document.hooks = hooks
    await copyFile(settingsPath, `${settingsPath}.findmnemo-backup`)
    await atomicWrite(settingsPath, `${JSON.stringify(document, null, 2)}\n`)
    await rm(`${settingsPath}.findmnemo-backup`, { force: true })
    return { target: settingsPath, state: 'not-configured', owned: false, changed: true, backup: null }
  }

  async installCodex(input: { hooksPath: string; reporterCommand: string }): Promise<IntegrationInstallReceipt> {
    assertSafeCommand(input.reporterCommand)
    return installJsonHooks(input.hooksPath, CODEX_EVENTS, `${input.reporterCommand} -Owner ${OWNER} -Agent codex-cli`, true)
  }

  async verifyCodex(hooksPath: string): Promise<IntegrationInstallReceipt> { return verifyJsonHooks(hooksPath) }

  async removeCodex(hooksPath: string): Promise<IntegrationInstallReceipt> { return removeJsonHooks(hooksPath) }
}

export class DesktopAgentActivitySetupPort implements AgentActivitySetupPort {
  private readonly installer = new AgentActivityIntegrationInstaller()
  private readonly homeDirectory: string
  private readonly reporterCommand: string
  constructor(homeDirectory: string, reporterCommand: string) { this.homeDirectory = homeDirectory; this.reporterCommand = reporterCommand }
  async enable(agent: AgentKind): Promise<'configured' | 'unavailable'> {
    try {
      if (agent === 'pi') await this.installer.installPi({ extensionDirectory: join(this.homeDirectory, '.pi', 'agent', 'extensions'), reporterCommand: this.reporterCommand })
      else if (agent === 'claude-code') await this.installer.installClaude({ settingsPath: join(this.homeDirectory, '.claude', 'settings.json'), reporterCommand: this.reporterCommand })
      else await this.installer.installCodex({ hooksPath: join(this.homeDirectory, '.codex', 'hooks.json'), reporterCommand: this.reporterCommand })
      return 'configured'
    } catch { return 'unavailable' }
  }
  async verify(agent: AgentKind): Promise<boolean> {
    const receipt = agent === 'pi' ? await this.installer.verifyPi(join(this.homeDirectory, '.pi', 'agent', 'extensions'))
      : agent === 'claude-code' ? await this.installer.verifyClaude(join(this.homeDirectory, '.claude', 'settings.json'))
        : await this.installer.verifyCodex(join(this.homeDirectory, '.codex', 'hooks.json'))
    return receipt.state === 'configured' && receipt.owned
  }
  async remove(agent: AgentKind): Promise<boolean> {
    const receipt = agent === 'pi' ? await this.installer.removePi(join(this.homeDirectory, '.pi', 'agent', 'extensions'))
      : agent === 'claude-code' ? await this.installer.removeClaude(join(this.homeDirectory, '.claude', 'settings.json'))
        : await this.installer.removeCodex(join(this.homeDirectory, '.codex', 'hooks.json'))
    return receipt.state === 'not-configured'
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}
async function optionalRead(path: string): Promise<string | undefined> { try { await access(path, constants.F_OK); return await readFile(path, 'utf8') } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw cause } }
function assertSafeCommand(command: string): void { if (!command || /(?:token|secret|bearer|password)\s*[=:]/i.test(command)) throw new Error('INTEGRATION_COMMAND_UNSAFE') }
function parseJsonObject(value: string): Record<string, unknown> { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INTEGRATION_CONFIG_INVALID'); return parsed as Record<string, unknown> }
function jsonObject(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {} }
function dirnameOf(path: string): string { const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')); return separator < 0 ? '.' : path.slice(0, separator) }

async function installJsonHooks(path: string, events: readonly string[], command: string, windows: boolean): Promise<IntegrationInstallReceipt> {
  const current = await optionalRead(path)
  const document = parseJsonObject(current ?? '{}')
  const hooks = jsonObject(document.hooks)
  for (const event of events) {
    const groups = Array.isArray(hooks[event]) ? [...hooks[event] as unknown[]] : []
    if (!JSON.stringify(groups).includes(`-Owner ${OWNER}`)) groups.push({ hooks: [{ type: 'command', command, ...(windows ? { commandWindows: command } : {}), timeout: 1 }] })
    hooks[event] = groups
  }
  document.hooks = hooks
  const next = `${JSON.stringify(document, null, 2)}\n`
  if (next === current) return { target: path, state: 'configured', owned: true, changed: false, backup: null }
  await mkdir(dirnameOf(path), { recursive: true })
  const backup = current === undefined ? null : `${path}.findmnemo-backup`
  if (backup) await copyFile(path, backup)
  await atomicWrite(path, next)
  return { target: path, state: 'configured', owned: true, changed: true, backup }
}

async function verifyJsonHooks(path: string): Promise<IntegrationInstallReceipt> {
  const current = await optionalRead(path)
  if (current === undefined) return { target: path, state: 'not-configured', owned: false, changed: false, backup: null }
  try { const owned = JSON.stringify(parseJsonObject(current)).includes(`-Owner ${OWNER}`); return { target: path, state: owned ? 'configured' : 'not-configured', owned, changed: false, backup: null } }
  catch { return { target: path, state: 'invalid', owned: false, changed: false, backup: null } }
}

async function removeJsonHooks(path: string): Promise<IntegrationInstallReceipt> {
  const current = await optionalRead(path)
  if (current === undefined) return { target: path, state: 'not-configured', owned: false, changed: false, backup: null }
  const document = parseJsonObject(current)
  const hooks = jsonObject(document.hooks)
  let changed = false
  for (const [event, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) continue
    const groups = value.flatMap((group) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) return [group]
      const copy = { ...group as Record<string, unknown> }
      if (!Array.isArray(copy.hooks)) return [copy]
      const kept = copy.hooks.filter((hook) => !JSON.stringify(hook).includes(`-Owner ${OWNER}`))
      if (kept.length !== copy.hooks.length) changed = true
      if (!kept.length) return []
      copy.hooks = kept; return [copy]
    })
    if (groups.length) hooks[event] = groups; else delete hooks[event]
  }
  if (!changed) return { target: path, state: 'not-configured', owned: false, changed: false, backup: null }
  document.hooks = hooks
  const backup = `${path}.findmnemo-backup`
  await copyFile(path, backup)
  await atomicWrite(path, `${JSON.stringify(document, null, 2)}\n`)
  await rm(backup, { force: true })
  return { target: path, state: 'not-configured', owned: false, changed: true, backup: null }
}
function piExtension(command: string): string { return `// ${OWNER}\n// Privacy boundary: only event name, opaque session id, safe model label, and time are reported.\nimport { spawn } from 'node:child_process';\nconst REPORTER = ${JSON.stringify(`${command} --adapter pi`)};\nexport default function findMnemoActivity(pi: any) {\n  let timer: ReturnType<typeof setInterval> | undefined;\n  const report = (event_name: string, ctx: any, explicit = false) => {\n    const session_id = ctx.sessionManager.getSessionId();\n    const model = ctx.model?.id;\n    try {\n      const child = spawn(REPORTER, { shell: true, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });\n      child.once('error', () => undefined);\n      child.stdin.end(JSON.stringify({ event_name, session_id, model, explicit }));\n      child.unref();\n    } catch { /* Monitoring never blocks the Pi lifecycle. */ }\n  };\n  pi.on('session_start', (_event: unknown, ctx: any) => { report('session_start', ctx); });\n  pi.on('before_agent_start', (_event: unknown, ctx: any) => { report('before_agent_start', ctx); });\n  pi.on('agent_start', (_event: unknown, ctx: any) => { report('agent_start', ctx); if (!timer) timer = setInterval(() => { if (!ctx.isIdle()) report('heartbeat', ctx); }, 45000); });\n  pi.on('agent_end', () => undefined);\n  pi.on('agent_settled', (_event: unknown, ctx: any) => { if (timer) clearInterval(timer); timer = undefined; report('agent_settled', ctx); });\n  pi.on('session_shutdown', () => { if (timer) clearInterval(timer); timer = undefined; });\n  for (const [name, event] of [['findmnemo-complete','complete'],['findmnemo-fail','failed'],['findmnemo-cancel','cancelled']] as const) pi.registerCommand(name, { description: 'Explicitly report this assignment outcome to FindMnemo', handler: (_args: string, ctx: any) => { report(event, ctx, true); } });\n}\n` }
