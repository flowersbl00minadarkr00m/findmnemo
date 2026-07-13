import { spawn } from 'node:child_process'
import type { ProcessRunRequest, ProcessRunResult, RoutingProcessRunner } from './adapter-contract.js'
import { safeSpawnCommand } from './safe-command.js'

export class NodeRoutingProcessRunner implements RoutingProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    return new Promise((resolve) => {
      let settled = false
      let stdout = ''
      let stderr = ''
      const command = safeSpawnCommand(request.executable, request.args)
      const child = spawn(command.executable, command.args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      const finish = (result: ProcessRunResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        request.signal.removeEventListener('abort', abort)
        resolve(result)
      }
      const stop = () => {
        child.kill('SIGTERM')
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
          killer.unref()
        }
      }
      const abort = () => { stop(); finish({ status: 'timed-out' }) }
      const timer = setTimeout(abort, request.timeoutMs)
      request.signal.addEventListener('abort', abort, { once: true })
      const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.byteLength > request.maxOutputBytes) {
          stop(); finish({ status: 'output-limit' }); return
        }
        if (target === 'stdout') stdout += chunk.toString('utf8')
        else stderr += chunk.toString('utf8')
      }
      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
      child.once('error', (error: NodeJS.ErrnoException) => finish({ status: error.code === 'ENOENT' ? 'not-found' : 'failed' }))
      child.once('close', (code) => finish({ status: 'completed', exitCode: code ?? -1, stdout, stderr }))
    })
  }
}
