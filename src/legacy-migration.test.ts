import { describe, expect, it, vi } from 'vitest'
import { commitLegacyMigration, previewLegacyMigration, readLegacyMigrationRecords } from './lib/legacy-migration'
import type { OperationalRepository } from './lib/operational-repository'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return { get length() { return data.size }, clear: () => data.clear(), getItem: (key) => data.get(key) ?? null, key: (index) => [...data.keys()][index] ?? null, removeItem: (key) => { data.delete(key) }, setItem: (key, value) => { data.set(key, value) } }
}

describe('legacy browser-ticket migration', () => {
  it('allowlists valid non-demo tickets and excludes demo, body-bearing, and malformed records', () => {
    const original = JSON.stringify([
      { id: 'valid', title: 'Valid work', description: 'Keep this', source: 'Codex', status: 'todo', origin: 'browser-ui' },
      { id: 'demo', title: 'Fictional', source: 'Codex', status: 'todo', origin: 'demo' },
      { id: 'private', title: 'Email', source: 'Codex', status: 'todo', messageBody: 'private content' },
      { id: 'malformed', title: '', source: 'Unknown', status: 'other' },
    ])
    const storage = memoryStorage({ mnemosync_tickets: original, 'findmnemo.sample.workspace.v1': JSON.stringify({ tickets: [{ id: 'sample' }] }) })
    const records = readLegacyMigrationRecords(storage)

    expect(records.map((record) => [record.legacyId, record.excluded])).toEqual([['valid', false], ['demo', true], ['private', true], ['malformed', true]])
    expect(records[0].ticket).toMatchObject({ id: 'valid', origin: 'imported', title: 'Valid work' })
    expect(JSON.stringify(records)).not.toContain('private content')
    expect(storage.getItem('mnemosync_tickets')).toBe(original)
    expect(JSON.stringify(records)).not.toContain('sample')
  })

  it('keeps original storage untouched, uses one stable idempotency key, and writes only a verified result marker', async () => {
    const original = JSON.stringify([{ id: 'valid', title: 'Valid work', source: 'Codex', status: 'todo' }])
    const storage = memoryStorage({ mnemosync_tickets: original })
    const previewResult = { eligible: 1, conflicts: 0, excluded: 0, imported: 0, alreadyImported: 0 }
    const committed = { ...previewResult, imported: 1 }
    const repository = {
      previewLegacyMigration: vi.fn().mockResolvedValue(previewResult),
      commitLegacyMigration: vi.fn().mockResolvedValue(committed),
    } as unknown as OperationalRepository
    const preview = await previewLegacyMigration(repository, storage)
    const first = await commitLegacyMigration(repository, preview.records, storage)
    const second = await commitLegacyMigration(repository, preview.records, storage)

    expect(first).toEqual(committed)
    expect(second).toEqual(committed)
    const keys = (repository.commitLegacyMigration as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])
    expect(new Set(keys).size).toBe(1)
    expect(storage.getItem('mnemosync_tickets')).toBe(original)
    expect(storage.getItem('findmnemo.legacy-migration.result.v1')).toContain('"imported":1')
  })
})
