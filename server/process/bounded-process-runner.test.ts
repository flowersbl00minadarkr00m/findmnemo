import { describe, expect, it } from 'vitest'
import { NodeBoundedProcessRunner } from './bounded-process-runner.js'

describe('bounded process runner', () => {
  it('runs without a shell and captures bounded output', async () => {
    const result = await new NodeBoundedProcessRunner().run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("bounded")'],
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ status: 'completed', exitCode: 0, stdout: 'bounded', stderr: '' })
  })

  it('stops on output overflow and abort', async () => {
    const runner = new NodeBoundedProcessRunner()
    const overflow = await runner.run({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(2048))'],
      timeoutMs: 5_000,
      maxOutputBytes: 128,
      signal: new AbortController().signal,
    })
    expect(overflow).toEqual({ status: 'output-limit' })

    const controller = new AbortController()
    const pending = runner.run({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 5_000,
      maxOutputBytes: 128,
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).resolves.toEqual({ status: 'timed-out' })

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(runner.run({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 5_000,
      maxOutputBytes: 128,
      signal: alreadyAborted.signal,
    })).resolves.toEqual({ status: 'timed-out' })
  })
})
