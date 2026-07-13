import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openFindMnemoDatabase, type FindMnemoDatabase } from '../../db/database.js'
import { OperationalRepository } from '../../db/operational-repository.js'
import { ReconciliationEngine } from '../engine.js'
import { AgentLedgerAdapter } from './agent-ledger.js'
import { ProjectSddAdapter } from './project-sdd.js'

const NOW = new Date('2026-07-11T08:00:00.000Z')

describe('registered project and agent-ledger adapters', () => {
  let directory: string
  let database: FindMnemoDatabase
  let repository: OperationalRepository

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'findmnemo-adapters-'))
    database = await openFindMnemoDatabase({ path: join(directory, 'test.db'), backupBeforeMigration: false })
    repository = new OperationalRepository(database.db)
  })

  afterEach(async () => {
    database.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('scans stable project/spec/gate/task identities and does not title-match ambiguous tasks', async () => {
    const projectRoot = join(directory, 'project')
    const specRoot = join(projectRoot, '.ai', 'sdd', 'specs', '001-feature')
    await mkdir(specRoot, { recursive: true })
    await writeFile(join(specRoot, '.status'), 'tasks:approved\n')
    await writeFile(join(specRoot, 'requirements.md'), '# Stable Feature\n')
    await writeFile(join(specRoot, 'tasks.md'), '## Task T1: Same title\n\n- [ ] First\n\n## Task T2: Same title\n\n- [ ] Second\n')
    const descriptor = { id: 'project-sdd', label: 'Project / SDD registry', adapterVersion: '1.0.0', enabled: true, policy: 'auto-create', locationLabel: 'Registered fixture' } as const
    repository.saveConfiguredSource(descriptor, { projects: [{ id: 'fixture', name: 'Fixture', canonicalPath: projectRoot }] })
    const engine = new ReconciliationEngine(repository, [new ProjectSddAdapter(repository)], () => NOW)
    const first = await engine.run()
    const second = await engine.run()

    expect(first.state).toBe('complete')
    expect(first.items.map((item) => item.externalId)).toEqual(expect.arrayContaining([
      'fixture:project', 'fixture:spec:001-feature', 'fixture:spec:001-feature:gate',
      'fixture:spec:001-feature:task:T1', 'fixture:spec:001-feature:task:T2',
    ]))
    expect(new Set(first.items.map((item) => item.externalId)).size).toBe(first.items.length)
    expect(second.items.every((item) => item.classification === 'unchanged')).toBe(true)
  })

  it('does not read an agent ledger until it is explicitly registered and enabled', async () => {
    const ledgerPath = join(directory, 'activity.jsonl')
    await writeFile(ledgerPath, JSON.stringify({ eventId: 'event-1', timestamp: NOW.toISOString(), intent: 'Do work' }) + '\n')
    const engine = new ReconciliationEngine(repository, [new AgentLedgerAdapter(repository)], () => NOW)
    const run = await engine.run()

    expect(run).toMatchObject({ state: 'failed', sources: [{ sourceId: 'agent-ledger', state: 'skipped', reasonCode: 'DISABLED_BY_USER' }] })
    expect(database.db.prepare('SELECT count(*) AS count FROM source_records').get()).toEqual({ count: 0 })
  })

  it('reports malformed, duplicate, and disappeared registered ledger data without path or title identity matching', async () => {
    const ledgerPath = join(directory, 'activity.jsonl')
    await writeFile(ledgerPath, [
      JSON.stringify({ eventId: 'event-1', timestamp: NOW.toISOString(), intent: 'Same title' }),
      JSON.stringify({ eventId: 'event-1', timestamp: NOW.toISOString(), intent: 'Different title' }),
      '{malformed',
    ].join('\n'))
    const descriptor = { id: 'agent-ledger', label: 'Registered agent ledger', adapterVersion: '1.0.0', enabled: true, policy: 'review', locationLabel: 'Approved ledger' } as const
    repository.saveConfiguredSource(descriptor, { path: ledgerPath, registrationId: 'fixture-ledger' })
    const engine = new ReconciliationEngine(repository, [new AgentLedgerAdapter(repository)], () => NOW)
    const run = await engine.run()

    expect(run.state).toBe('partial')
    expect(run.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: 'event-1', classification: 'duplicate' }),
      expect.objectContaining({ externalId: 'malformed-line-3', classification: 'unresolved', reasonCode: 'AMBIGUOUS_PROVENANCE' }),
    ]))
    expect(JSON.stringify(run)).not.toContain(ledgerPath)
    await rm(ledgerPath)
    const missing = await engine.run()
    expect(missing).toMatchObject({ state: 'failed', sources: [{ sourceId: 'agent-ledger', state: 'failed', errorCode: 'SOURCE_CHECK_FAILED' }] })
    await writeFile(ledgerPath, JSON.stringify({ eventId: 'restored-event', timestamp: NOW.toISOString(), intent: 'Restored work' }) + '\n')
    const restored = await engine.run()
    expect(restored).toMatchObject({ state: 'partial', sources: [{ sourceId: 'agent-ledger', state: 'checked', unresolved: 1 }] })
  })

  it('keeps a configured descriptor visible when its registered project path is stale', async () => {
    const descriptor = { id: 'project-sdd', label: 'Project / SDD registry', adapterVersion: '1.0.0', enabled: true, policy: 'auto-create', locationLabel: 'Missing project' } as const
    repository.saveConfiguredSource(descriptor, { projects: [{ id: 'missing', canonicalPath: join(directory, 'gone') }] })
    const engine = new ReconciliationEngine(repository, [new ProjectSddAdapter(repository)], () => NOW)
    const run = await engine.run()
    expect(engine.sources()).toContainEqual(descriptor)
    expect(run).toMatchObject({ state: 'failed', sources: [{ sourceId: 'project-sdd', state: 'failed' }] })
  })
})
