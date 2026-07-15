import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WindowsDpapiSecretStore } from './windows-dpapi-store.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe.skipIf(process.platform !== 'win32')('Windows DPAPI secret store', () => {
  it('round-trips through CurrentUser protection without writing plaintext', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-secrets-'))
    cleanup.push(directory)
    const store = new WindowsDpapiSecretStore(directory)
    await store.set('gmail-refresh-token', 'fixture-private-value')
    expect(await store.get('gmail-refresh-token')).toBe('fixture-private-value')
    expect(await readFile(join(directory, 'gmail-refresh-token.dpapi'), 'utf8')).not.toContain('fixture-private-value')
    await store.delete('gmail-refresh-token')
    expect(await store.has('gmail-refresh-token')).toBe(false)
  }, 15_000)
})
