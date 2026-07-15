import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { ProjectFolderDetector } from './project-folder-detector.js'
import { ProjectFolderRepository } from './project-folder-repository.js'

const cleanup: string[] = []
const NOW = new Date('2026-07-14T18:00:00.000Z')

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-folders-'))
  cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'test.db'), backupBeforeMigration: false })
  return { root, database, repository: new ProjectFolderRepository(database.db), detector: new ProjectFolderDetector(() => NOW) }
}

describe('project folder repository and bounded detector', () => {
  it('classifies only approved root markers and keeps unsupported folders honest', async () => {
    const { root, database, repository, detector } = await fixture()
    const sdd = join(root, 'sdd-project'); await mkdir(join(sdd, '.ai', 'sdd'), { recursive: true })
    const git = join(root, 'git-project'); await mkdir(git); await writeFile(join(git, 'package.json'), '{}')
    const generic = join(root, 'notes'); await mkdir(generic)
    const missing = join(root, 'gone')

    expect((await detector.inspect(sdd)).kind).toBe('sdd')
    expect((await detector.inspect(git)).kind).toBe('git')
    expect((await detector.inspect(generic)).kind).toBe('generic')
    expect(await detector.inspect(missing)).toMatchObject({ kind: 'unavailable', errorCode: 'FOLDER_UNAVAILABLE' })

    const row = repository.upsertDetection(await detector.inspect(generic))
    expect(row).toMatchObject({ detectedKind: 'generic', lastSuccessAt: NOW.toISOString(), lastErrorCode: null })
    expect(row.pathFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(row.pathFingerprint).not.toContain(generic)
    database.close()
  })

  it('detects duplicate and nesting relationships before saving', async () => {
    const { root, database, repository, detector } = await fixture()
    const parent = join(root, 'parent'); const child = join(parent, 'child'); await mkdir(child, { recursive: true })
    const saved = repository.upsertDetection(await detector.inspect(parent))
    expect(repository.classify((await detector.inspect(parent)).canonicalPath)).toEqual({ kind: 'duplicate', existingId: saved.id })
    expect(repository.classify((await detector.inspect(child)).canonicalPath)).toEqual({ kind: 'nested', existingId: saved.id })
    expect(repository.setState(saved.id, 'paused', NOW.toISOString())).toBe(true)
    expect(repository.get(saved.id)?.state).toBe('paused')
    expect(repository.remove(saved.id)).toBe(true)
    expect(repository.list()).toEqual([])
    database.close()
  })

  it('migrates legacy project arrays idempotently without copying paths into safe source configuration', async () => {
    const { root, database, repository, detector } = await fixture()
    const project = join(root, 'legacy'); await mkdir(join(project, '.ai', 'sdd'), { recursive: true })
    const input = [{ id: 'legacy-one', name: 'Legacy project', canonicalPath: project }]
    await repository.migrateLegacy(input, (path) => detector.inspect(path))
    await repository.migrateLegacy(input, (path) => detector.inspect(path))
    expect(repository.list()).toHaveLength(1)
    expect(repository.list()[0]).toMatchObject({ id: 'legacy-legacy-one', label: 'Legacy project', detectedKind: 'sdd', sddEnrichmentEnabled: true })
    database.close()
  })
})
