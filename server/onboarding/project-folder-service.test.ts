import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { ProjectFolderDetector } from './project-folder-detector.js'
import { ProjectFolderRepository } from './project-folder-repository.js'
import { ProjectFolderService } from './project-folder-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-folder-service-'))
  cleanup.push(root)
  const first = join(root, 'first-project')
  const second = join(root, 'second-project')
  await mkdir(first)
  await mkdir(second)
  await writeFile(join(first, 'package.json'), '{}')
  const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
  let now = new Date('2026-07-14T10:00:00.000Z')
  const service = new ProjectFolderService(new ProjectFolderRepository(database.db), new ProjectFolderDetector(() => now), new OperationalRepository(database.db), () => now)
  return { root, first, second, database, service, expire: () => { now = new Date('2026-07-14T10:06:00.000Z') } }
}

describe('ProjectFolderService', () => {
  it('previews and commits several folders without returning their paths', async () => {
    const { root, first, second, database, service } = await fixture()
    const preview = await service.preview([first, second])
    expect(preview).toMatchObject({ state: 'ready', confirmationRequired: false, items: [{ label: 'first-project', detectedKind: 'git' }, { label: 'second-project', detectedKind: 'generic' }] })
    expect(JSON.stringify(preview)).not.toContain(root)
    const firstCommit = service.commit(preview.previewId!, false)
    expect(firstCommit).toMatchObject({ committed: true, folderIds: expect.arrayContaining([expect.any(String), expect.any(String)]) })
    expect(service.commit(preview.previewId!, false)).toEqual(firstCommit)
    expect(service.list()).toHaveLength(2)
    database.close()
  })

  it('requires warning confirmation and expires without writing', async () => {
    const { first, database, service, expire } = await fixture()
    const initial = await service.preview([first])
    service.commit(initial.previewId!, false)
    const duplicate = await service.preview([first])
    expect(duplicate).toMatchObject({ confirmationRequired: true, items: [{ relationship: 'duplicate' }] })
    expect(service.commit(duplicate.previewId!, false)).toMatchObject({ committed: false, errorCode: 'PROJECT_FOLDER_CONFIRMATION_REQUIRED' })
    expire()
    expect(service.commit(duplicate.previewId!, true)).toMatchObject({ committed: false, errorCode: 'PROJECT_FOLDER_PREVIEW_EXPIRED' })
    expect(service.list()).toHaveLength(1)
    database.close()
  })

  it('manages opaque folder records and never deletes the selected directory', async () => {
    const { first, database, service } = await fixture()
    const preview = await service.preview([first])
    const { folderIds } = service.commit(preview.previewId!, false)
    expect(service.update(folderIds[0], { label: 'Client app', state: 'paused', sddEnrichmentEnabled: false })).toMatchObject({ label: 'Client app', state: 'paused' })
    expect(service.remove(folderIds[0])).toBe(true)
    expect(await import('node:fs/promises').then(({ stat }) => stat(first))).toBeTruthy()
    database.close()
  })
})
