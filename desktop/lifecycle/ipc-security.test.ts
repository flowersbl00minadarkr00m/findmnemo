import { describe, expect, it } from 'vitest'
import { assertBundledRendererSender } from './ipc-security.js'

describe('desktop IPC sender boundary', () => {
  const allowed = 'file:///C:/Program%20Files/FindMnemo/resources/app.asar/dist-desktop-renderer/desktop.html'
  it('accepts only the exact bundled renderer URL', () => expect(() => assertBundledRendererSender(allowed, allowed)).not.toThrow())
  it.each([undefined, 'https://mnemosync.vercel.app/app', 'file:///C:/tmp/desktop.html', 'file:///C:/Program%20Files/FindMnemo/resources/app.asar/dist-desktop-renderer/desktop.html#spoof'])('rejects remote, absent, sibling, and modified senders', (url) => {
    expect(() => assertBundledRendererSender(url, allowed)).toThrowError(expect.objectContaining({ code: 'IPC_SENDER_REJECTED' }))
  })
})
