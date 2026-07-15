import { spawn } from 'node:child_process'

export interface BoundedProcessRequest {
  executable: string
  args: readonly string[]
  timeoutMs: number
  maxOutputBytes: number
  signal: AbortSignal
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string
}

export type BoundedProcessResult =
  | { status: 'completed'; exitCode: number; stdout: string; stderr: string }
  | { status: 'not-found' | 'timed-out' | 'output-limit' | 'failed' }

export interface BoundedProcessRunner {
  run(request: BoundedProcessRequest): Promise<BoundedProcessResult>
}

export class NodeBoundedProcessRunner implements BoundedProcessRunner {
  run(request: BoundedProcessRequest): Promise<BoundedProcessResult> {
    if (request.signal.aborted) return Promise.resolve({ status: 'timed-out' })
    return new Promise((resolve) => {
      let settled = false
      let stdout = ''
      let stderr = ''
      const child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        shell: false,
        stdio: [request.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
      const finish = (result: BoundedProcessResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        request.signal.removeEventListener('abort', abort)
        resolve(result)
      }
      const stop = () => {
        child.kill('SIGTERM')
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            env: request.env,
            windowsHide: true,
            shell: false,
            stdio: 'ignore',
          })
          killer.unref()
        }
      }
      const abort = () => { stop(); finish({ status: 'timed-out' }) }
      const timer = setTimeout(abort, request.timeoutMs)
      request.signal.addEventListener('abort', abort, { once: true })
      const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.byteLength > request.maxOutputBytes) {
          stop()
          finish({ status: 'output-limit' })
          return
        }
        if (target === 'stdout') stdout += chunk.toString('utf8')
        else stderr += chunk.toString('utf8')
      }
      child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk))
      child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk))
      if (request.stdin !== undefined && child.stdin) { child.stdin.end(request.stdin) }
      child.once('error', (error: NodeJS.ErrnoException) => finish({ status: error.code === 'ENOENT' ? 'not-found' : 'failed' }))
      child.once('close', (code) => finish({ status: 'completed', exitCode: code ?? -1, stdout, stderr }))
    })
  }
}
