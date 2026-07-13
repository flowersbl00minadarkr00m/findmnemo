import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { SecretStore } from './secret-store.js'

const PROTECT_SCRIPT = "Add-Type -AssemblyName System.Security;$d=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($d);$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($e))"
const UNPROTECT_SCRIPT = "Add-Type -AssemblyName System.Security;$d=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($d);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))"

export class WindowsDpapiSecretStore implements SecretStore {
  private readonly directory: string

  constructor(directory = join(process.env.LOCALAPPDATA ?? '', 'FindMnemo', 'secrets')) {
    if (!directory) throw new Error('A local secret directory is required.')
    this.directory = directory
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const encrypted = await readFile(this.pathFor(key), 'utf8')
      const clearBase64 = await runPowerShell(UNPROTECT_SCRIPT, encrypted)
      return Buffer.from(clearBase64, 'base64').toString('utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw cause
    }
  }

  async set(key: string, value: string): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const encrypted = await runPowerShell(PROTECT_SCRIPT, Buffer.from(value, 'utf8').toString('base64'))
    await writeFile(this.pathFor(key), encrypted, { encoding: 'utf8', mode: 0o600 })
    await restrictAcl(this.pathFor(key))
  }

  async delete(key: string): Promise<void> { await rm(this.pathFor(key), { force: true }) }
  async has(key: string): Promise<boolean> { return (await this.get(key)) !== undefined }

  private pathFor(key: string): string {
    if (!/^[a-z0-9._-]+$/i.test(key)) throw new Error('Secret key contains unsupported characters.')
    return join(this.directory, `${key}.dpapi`)
  }
}

async function runPowerShell(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolve(Buffer.concat(stdout).toString('utf8').trim())
      : reject(new Error(`Windows secret protection failed (${code}): ${Buffer.concat(stderr).toString('utf8').slice(0, 160)}`)))
    child.stdin.end(input)
  })
}

async function restrictAcl(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn('icacls.exe', [path, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:(F)`], { windowsHide: true, stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Secret ACL restriction failed (${code}).`)))
  })
}
