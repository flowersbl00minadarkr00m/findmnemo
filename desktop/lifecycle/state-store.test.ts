import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LifecycleStateStore } from './state-store.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('LifecycleStateStore', () => {
  it('creates stable non-secret default-off settings and reloads them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-lifecycle-'))
    roots.push(root)
    const path = join(root, 'FindMnemo', 'lifecycle.json')
    const store = new LifecycleStateStore(path)
    const created = await store.load()
    const reloaded = await store.load()
    expect(reloaded).toEqual(created)
    expect(created.startupEnabled).toBe(false)
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toMatch(/token|credential|email|prompt|session/i)
  })

  it('rejects malformed persisted state instead of silently claiming defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'findmnemo-lifecycle-'))
    roots.push(root)
    const path = join(root, 'lifecycle.json')
    await writeFile(path, '{"schema":"unknown","token":"do-not-accept"}')
    await expect(new LifecycleStateStore(path).load()).rejects.toMatchObject({ code: 'LIFECYCLE_SETTINGS_INVALID' })
  })
})
