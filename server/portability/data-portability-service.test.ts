import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { RoutingRepository } from '../routing/routing-repository.js'
import { UsageRepository } from '../usage/usage-repository.js'
import { DataPortabilityService } from './data-portability-service.js'

const roots: string[] = []

async function service() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-portability-'))
  roots.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'data.db') })
  const operational = new OperationalRepository(database.db)
  const routing = new RoutingRepository(database.db)
  const usage = new UsageRepository(database.db)
  return { database, operational, service: new DataPortabilityService(operational, routing, usage, 'test', () => new Date('2026-07-13T12:00:00.000Z')) }
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe('DataPortabilityService', () => {
  it('previews companion categories with safe defaults and email off', async () => {
    const target = await service()
    const preview = target.service.previewExport()
    expect(preview.schema).toBe('findmnemo.data-export-preview.v1')
    expect(preview.workspace).toBe('operational')
    expect(preview.categories.filter((item) => item.selectedByDefault).map((item) => item.id)).toEqual(['tickets-work', 'decisions-receipts', 'routing-policy', 'model-usage'])
    expect(preview.categories.find((item) => item.id === 'email-metadata')?.selectedByDefault).toBe(false)
    target.database.close()
  })

  it('round-trips new tickets, preserves duplicates, and excludes Sample', async () => {
    const source = await service()
    source.operational.saveTicket({
      id: 'ticket-1', status: 'todo', source: 'Codex', origin: 'browser-ui', createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:00:00.000Z',
      payload: { id: 'ticket-1', title: 'Portable ticket', description: '', source: 'Codex', status: 'todo', origin: 'browser-ui', workNotes: [], decisionLog: [], artifacts: [], createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:00:00.000Z' },
    })
    source.operational.saveTicket({
      id: 'sample-1', status: 'todo', source: 'Codex', origin: 'demo', createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:00:00.000Z',
      payload: { id: 'sample-1', title: 'Sample ticket', description: '', source: 'Codex', status: 'todo', origin: 'demo', workNotes: [], decisionLog: [], artifacts: [], createdAt: '2026-07-13T10:00:00.000Z', updatedAt: '2026-07-13T10:00:00.000Z' },
    })
    const bundle = source.service.createBundle(['tickets-work'])
    const parsed = JSON.parse(bundle.json) as { artifacts: Array<{ data: { tickets: Array<{ id: string }> } }> }
    expect(parsed.artifacts[0].data.tickets.map((ticket) => ticket.id)).toEqual(['ticket-1'])

    const destination = await service()
    const preview = destination.service.previewImport(parsed)
    expect(preview.categories[0].counts.add).toBe(1)
    const receipt = destination.service.commitImport({ planId: preview.planId, categoryIds: ['tickets-work'], idempotencyKey: 'import-1' })
    expect(receipt.outcome).toBe('complete')
    expect(destination.operational.getTicket('ticket-1')).toBeTruthy()
    expect(destination.service.commitImport({ planId: preview.planId, categoryIds: ['tickets-work'], idempotencyKey: 'import-1' })).toEqual(receipt)
    expect(destination.operational.listTickets().filter((ticket) => ticket.id === 'ticket-1')).toHaveLength(1)
    source.database.close()
    destination.database.close()
  })

  it('rejects prompt-shaped private fields before creating a plan', async () => {
    const target = await service()
    expect(() => target.service.previewImport({ profile: 'findmnemo.data-bundle.v1', manifest: { profile: 'findmnemo.data-bundle-manifest.v1', workspace: 'operational' }, artifacts: [{ category: 'tickets-work', profile: 'findmnemo.tickets-work.v1', prompt: 'private', data: {} }] })).toThrow(/PORTABILITY_PROHIBITED_FIELD/)
    target.database.close()
  })

  it('rejects credential-shaped values and unsupported artifact versions', async () => {
    const target = await service()
    const base = {
      profile: 'findmnemo.data-bundle.v1',
      manifest: { profile: 'findmnemo.data-bundle-manifest.v1', workspace: 'operational' },
    }
    expect(() => target.service.previewImport({ ...base, artifacts: [{ category: 'tickets-work', profile: 'findmnemo.tickets-work.v1', mediaType: 'application/json', schemaVersion: '1.0.0', data: { tickets: [{ id: 'ticket-secret', description: `accidental ${'sk-' + 'a'.repeat(24)}` }] } }] })).toThrow(/PORTABILITY_CREDENTIAL_SHAPE/)
    expect(() => target.service.previewImport({ ...base, artifacts: [{ category: 'tickets-work', profile: 'findmnemo.tickets-work.v2', mediaType: 'application/json', schemaVersion: '2.0.0', data: { tickets: [] } }] })).toThrow(/PORTABILITY_UNSUPPORTED_ARTIFACT_VERSION/)
    expect(target.operational.listTickets()).toHaveLength(0)
    target.database.close()
  })
})
