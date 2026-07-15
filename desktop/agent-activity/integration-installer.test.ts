import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentActivityIntegrationInstaller } from './integration-installer.js'

describe('agent activity integration installer', () => {
  it('installs, verifies, and removes only the owned Pi extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-pi-'))
    const unrelated = join(root, 'unrelated.ts')
    await writeFile(unrelated, 'export default 1', 'utf8')
    const installer = new AgentActivityIntegrationInstaller()
    const receipt = await installer.installPi({ extensionDirectory: root, reporterCommand: 'findmnemo report:activity' })
    expect(receipt.state).toBe('configured')
    expect(receipt.changed).toBe(true)
    expect(await installer.verifyPi(root)).toMatchObject({ state: 'configured', owned: true })
    const extension = await readFile(receipt.target, 'utf8')
    expect(extension).not.toContain('activity token')
    expect(extension).toContain('-Owner findmnemo-agent-activity-v1 -Agent pi')
    expect(extension).toContain('child.unref()')
    expect(extension).not.toContain('await new Promise')
    await installer.removePi(root)
    expect(await readFile(unrelated, 'utf8')).toBe('export default 1')
    expect(await installer.verifyPi(root)).toMatchObject({ state: 'not-configured' })
  })

  it('refuses to overwrite a same-name file it does not own', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-pi-collision-'))
    await writeFile(join(root, 'findmnemo-activity.ts'), 'unrelated user extension', 'utf8')
    const installer = new AgentActivityIntegrationInstaller()
    await expect(installer.installPi({ extensionDirectory: root, reporterCommand: 'safe command' })).rejects.toThrow('INTEGRATION_TARGET_NOT_OWNED')
  })

  it('merges and removes only owned Claude hooks with an atomic backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-claude-'))
    const settingsPath = join(root, 'settings.json')
    await writeFile(settingsPath, JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep-me' }] }] } }, null, 2), 'utf8')
    const installer = new AgentActivityIntegrationInstaller()
    const installed = await installer.installClaude({ settingsPath, reporterCommand: 'node findmnemo-hook.cjs' })
    expect(installed.backup).toBe(`${settingsPath}.findmnemo-backup`)
    expect(await installer.verifyClaude(settingsPath)).toMatchObject({ state: 'configured', owned: true })
    await installer.removeClaude(settingsPath)
    const restored = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(restored.theme).toBe('dark')
    expect(restored.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'keep-me' }] }])
    expect(JSON.stringify(restored)).not.toContain('activity token')
    await expect(access(`${settingsPath}.findmnemo-backup`)).rejects.toThrow()
  })

  it('adds Windows Codex hook commands without changing unrelated hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-codex-'))
    const hooksPath = join(root, 'hooks.json')
    await writeFile(hooksPath, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep-codex' }] }] } }, null, 2), 'utf8')
    const installer = new AgentActivityIntegrationInstaller()
    await installer.installCodex({ hooksPath, reporterCommand: 'node findmnemo-hook.cjs' })
    const configured = JSON.parse(await readFile(hooksPath, 'utf8'))
    expect(JSON.stringify(configured)).toContain('commandWindows')
    expect(JSON.stringify(configured)).toContain('"timeout":1')
    expect(JSON.stringify(configured)).not.toContain('activity token')
    await installer.removeCodex(hooksPath)
    const restored = JSON.parse(await readFile(hooksPath, 'utf8'))
    expect(restored.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'keep-codex' }] }])
    await expect(access(`${hooksPath}.findmnemo-backup`)).rejects.toThrow()
  })
})
