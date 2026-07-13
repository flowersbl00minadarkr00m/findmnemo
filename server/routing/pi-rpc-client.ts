import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { safeSpawnCommand } from './safe-command.js'

export interface PiRpcResponse {
  id?: string
  type: string
  command?: string
  success?: boolean
  data?: unknown
  error?: string
}

export interface PiRpcSession {
  request(command: Record<string, unknown>, timeoutMs?: number): Promise<PiRpcResponse>
  onEvent(listener: (event: PiRpcResponse) => void): () => void
  close(): Promise<void>
}

export interface PiRpcSessionFactory {
  open(signal: AbortSignal): Promise<PiRpcSession>
}

export class SpawnedPiRpcSessionFactory implements PiRpcSessionFactory {
  private readonly executable: string
  private readonly maxOutputBytes: number
  constructor(executable = process.platform === 'win32' ? 'pi.cmd' : 'pi', maxOutputBytes = 4 * 1024 * 1024) { this.executable = executable; this.maxOutputBytes = maxOutputBytes }

  async open(signal: AbortSignal): Promise<PiRpcSession> {
    const command = safeSpawnCommand(this.executable, ['--mode', 'rpc', '--no-session', '--no-tools', '--no-extensions', '--no-skills', '--no-context-files', '--offline'])
    const child = spawn(command.executable, command.args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    const session = new SpawnedPiRpcSession(child, this.maxOutputBytes, signal)
    await session.ready()
    return session
  }
}

class SpawnedPiRpcSession implements PiRpcSession {
  private buffer = ''
  private outputBytes = 0
  private closed = false
  private readonly pending = new Map<string, { resolve: (response: PiRpcResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private readonly listeners = new Set<(event: PiRpcResponse) => void>()
  private readonly readyPromise: Promise<void>

  private readonly child: ChildProcessWithoutNullStreams
  private readonly maxOutputBytes: number

  constructor(child: ChildProcessWithoutNullStreams, maxOutputBytes: number, signal: AbortSignal) {
    this.child = child
    this.maxOutputBytes = maxOutputBytes
    this.readyPromise = new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.stdout.on('data', (chunk: Buffer) => this.accept(chunk))
    child.stderr.on('data', (chunk: Buffer) => { this.outputBytes += chunk.byteLength; if (this.outputBytes > this.maxOutputBytes) void this.failAll('PI_RPC_OUTPUT_LIMIT') })
    child.once('error', () => void this.failAll('PI_RPC_START_FAILED'))
    child.once('close', () => void this.failAll('PI_RPC_CLOSED'))
    signal.addEventListener('abort', () => { void this.failAll('PI_RPC_TIMEOUT') }, { once: true })
  }

  ready(): Promise<void> { return this.readyPromise }

  request(command: Record<string, unknown>, timeoutMs = 5_000): Promise<PiRpcResponse> {
    if (this.closed) return Promise.reject(new Error('PI_RPC_CLOSED'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('PI_RPC_TIMEOUT')) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`, (error) => {
        if (!error) return
        clearTimeout(timer); this.pending.delete(id); reject(new Error('PI_RPC_WRITE_FAILED'))
      })
    })
  }

  onEvent(listener: (event: PiRpcResponse) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.child.stdin.end()
    terminateProcessTree(this.child)
    await new Promise<void>((resolve) => { if (this.child.exitCode !== null) resolve(); else { this.child.once('close', () => resolve()); setTimeout(resolve, 1_000) } })
  }

  private accept(chunk: Buffer): void {
    this.outputBytes += chunk.byteLength
    if (this.outputBytes > this.maxOutputBytes) { void this.failAll('PI_RPC_OUTPUT_LIMIT'); return }
    this.buffer += chunk.toString('utf8')
    let boundary = this.buffer.indexOf('\n')
    while (boundary >= 0) {
      const line = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 1)
      if (line) this.acceptLine(line)
      boundary = this.buffer.indexOf('\n')
    }
  }

  private acceptLine(line: string): void {
    let response: PiRpcResponse
    try { response = JSON.parse(line) as PiRpcResponse } catch { void this.failAll('PI_RPC_MALFORMED'); return }
    if (response.type !== 'response' || typeof response.id !== 'string') { for (const listener of this.listeners) listener(response); return }
    const pending = this.pending.get(response.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.id)
    pending.resolve(response)
  }

  private async failAll(code: string): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(code)) }
    this.pending.clear()
    terminateProcessTree(this.child)
  }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  child.kill('SIGTERM')
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    killer.unref()
  }
}
