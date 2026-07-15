import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository, type StoredTicket } from '../db/operational-repository.js'
import { CompletedWorkExporter } from './completed-work-exporter.js'
import { CompletedWorkQueryService } from './completed-work-query-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-completed-'))
  cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
  const repository = new OperationalRepository(database.db)
  const save = (id: string, completedAt: string | null, title = id) => repository.saveTicket(ticket(id, completedAt, title))
  return { database, repository, save, service: new CompletedWorkQueryService(repository, () => new Date('2026-07-14T12:00:00.000Z')) }
}

function ticket(id: string, completedAt: string | null, title: string): StoredTicket { return { id, status: 'done', source: 'Codex', origin: 'local-bridge', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z', completedAt, payload: { id, title, status: 'done', completionProvenance: completedAt ? 'findmnemo-lifecycle-v1' : undefined } } }

describe('CompletedWorkQueryService', () => {
  it('uses inclusive start, exclusive end, stable pagination, and separate unknown coverage', async () => {
    const { database, save, service } = await fixture()
    save('at-start', '2026-07-01T00:00:00.000Z')
    save('middle-b', '2026-07-05T00:00:00.000Z')
    save('middle-a', '2026-07-05T00:00:00.000Z')
    save('at-end', '2026-07-10T00:00:00.000Z')
    save('legacy', null)
    const query = { startInclusive: '2026-07-01T00:00:00.000Z', endExclusive: '2026-07-10T00:00:00.000Z', timeZone: 'UTC', limit: 2 }
    const first = service.query(query)
    expect(first.records.map((record) => record.id)).toEqual(['middle-a', 'middle-b'])
    expect(first).toMatchObject({ total: 3, unknownCompletionCount: 1, nextCursor: expect.any(String) })
    const second = service.query({ ...query, cursor: first.nextCursor! })
    expect(second.records.map((record) => record.id)).toEqual(['at-start'])
    expect(() => service.query({ ...query, endExclusive: '2026-07-09T00:00:00.000Z', cursor: first.nextCursor! })).toThrow('COMPLETED_CURSOR_INVALID')
    database.close()
  })

  it('exports the exact normalized query snapshot with null optional CSV cells', async () => {
    const { database, save, service } = await fixture()
    save('one', '2026-07-05T00:00:00.000Z', 'A, quoted title')
    const query = { startInclusive: '2026-07-01T00:00:00.000Z', endExclusive: '2026-07-10T00:00:00.000Z', timeZone: 'UTC' }
    const listed = service.query(query)
    const exporter = new CompletedWorkExporter(service)
    const json = JSON.parse(exporter.export(query, 'json').body) as typeof listed
    const csv = exporter.export(query, 'csv').body
    expect(json.records.map((record) => record.id)).toEqual(listed.records.map((record) => record.id))
    expect(json.query.queryId).toBe(listed.query.queryId)
    expect(csv).toContain('"A, quoted title",Codex,,2026-07-05T00:00:00.000Z,done')
    database.close()
  })
})
