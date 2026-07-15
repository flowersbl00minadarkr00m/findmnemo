import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository, type StoredTicket } from '../db/operational-repository.js'
import { TicketLifecycleService } from './ticket-lifecycle-service.js'

const cleanup: string[] = []
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-lifecycle-'))
  cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'findmnemo.db') })
  const repository = new OperationalRepository(database.db)
  const times = ['2026-07-14T10:00:00.000Z', '2026-07-14T10:01:00.000Z', '2026-07-14T10:02:00.000Z', '2026-07-14T10:03:00.000Z', '2026-07-14T10:04:00.000Z']
  const service = new TicketLifecycleService(repository, () => new Date(times.shift()!))
  return { database, repository, service }
}

function ticket(): StoredTicket { return { id: 'ticket:1', status: 'todo', source: 'Codex', origin: 'local-bridge', createdAt: '2026-07-14T09:00:00.000Z', updatedAt: '2026-07-14T09:00:00.000Z', completedAt: null, payload: { id: 'ticket:1', title: 'Lifecycle', status: 'todo' } } }

describe('TicketLifecycleService', () => {
  it('records complete, edit, reopen, and recomplete atomically with exact timestamps', async () => {
    const { database, repository, service } = await fixture()
    const created = service.create(ticket(), 'test')
    const completed = service.transition({ ticketId: created.id, expectedUpdatedAt: created.updatedAt, nextPayload: { status: 'done' }, origin: 'test' })
    expect(completed.completedAt).toBe('2026-07-14T10:01:00.000Z')
    const edited = service.transition({ ticketId: completed.id, expectedUpdatedAt: completed.updatedAt, nextPayload: { title: 'Edited' }, origin: 'test' })
    expect(edited.completedAt).toBe(completed.completedAt)
    const reopened = service.transition({ ticketId: edited.id, expectedUpdatedAt: edited.updatedAt, nextPayload: { status: 'todo' }, origin: 'test' })
    expect(reopened.completedAt).toBeNull()
    const recompleted = service.transition({ ticketId: reopened.id, expectedUpdatedAt: reopened.updatedAt, nextPayload: { status: 'done' }, origin: 'test' })
    expect(recompleted.completedAt).toBe('2026-07-14T10:04:00.000Z')
    expect(repository.listTicketStatusEvents(created.id).map((event) => [event.fromStatus, event.toStatus, event.completionAt])).toEqual([
      [null, 'todo', null], ['todo', 'done', '2026-07-14T10:01:00.000Z'], ['done', 'todo', null], ['todo', 'done', '2026-07-14T10:04:00.000Z'],
    ])
    database.close()
  })

  it('leaves ticket and history unchanged after a stale conflict', async () => {
    const { database, repository, service } = await fixture()
    const created = service.create(ticket(), 'test')
    expect(() => service.transition({ ticketId: created.id, expectedUpdatedAt: 'stale', nextPayload: { status: 'done' }, origin: 'test' })).toThrow('RECORD_CHANGED')
    expect(repository.getTicket(created.id)).toMatchObject({ status: 'todo', completedAt: null })
    expect(repository.listTicketStatusEvents(created.id)).toHaveLength(1)
    database.close()
  })
})
