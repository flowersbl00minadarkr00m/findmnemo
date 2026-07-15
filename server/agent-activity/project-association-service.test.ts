import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assignmentEventFixture } from '../../shared/agent-activity-contract.test.js'
import type { AssignmentEventV1 } from '../../shared/agent-activity-contract.js'
import { openFindMnemoDatabase } from '../db/database.js'
import { OperationalRepository } from '../db/operational-repository.js'
import { ProjectFolderDetector } from '../onboarding/project-folder-detector.js'
import { ProjectFolderRepository } from '../onboarding/project-folder-repository.js'
import { ProjectFolderService } from '../onboarding/project-folder-service.js'
import { TicketLifecycleService } from '../tickets/ticket-lifecycle-service.js'
import { AgentActivityRepository } from './agent-activity-repository.js'
import { AgentActivityService } from './agent-activity-service.js'
import { ProjectAssociationService } from './project-association-service.js'
import { ProjectCandidateProvider, type RegistryProcessRunner } from './project-candidate-provider.js'

const cleanup: string[] = []
const NOW = new Date('2026-07-14T19:00:00.000Z')

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'findmnemo-project-association-'))
  cleanup.push(root)
  const database = await openFindMnemoDatabase({ path: join(root, 'test.db'), backupBeforeMigration: false })
  const operational = new OperationalRepository(database.db)
  const folders = new ProjectFolderRepository(database.db)
  const detector = new ProjectFolderDetector(() => NOW)
  const folderService = new ProjectFolderService(folders, detector, operational, () => NOW)
  const lifecycle = new TicketLifecycleService(operational, () => NOW)
  const activities = new AgentActivityRepository(database.db, operational, lifecycle, Buffer.alloc(32, 6), () => NOW)
  activities.registerIntegration({ id: 'integration-codex-1', agent: 'codex-cli', adapterVersion: '1.0.0', installedVersion: '0.144.3' })
  const associations = new ProjectAssociationService(database.db, folders, operational, () => NOW)
  return { root, database, operational, folders, detector, folderService, activities, associations }
}

describe('ProjectCandidateProvider', () => {
  it('lists strict bounded registry IDs without tracking them and commits reviewed paths through folder warnings', async () => {
    const { root, database, folders, folderService } = await fixture()
    const first = join(root, 'first'); const second = join(root, 'second')
    await mkdir(join(first, '.ai', 'sdd'), { recursive: true }); await mkdir(second)
    const calls: string[][] = []
    const runner: RegistryProcessRunner = async (_file, args) => {
      calls.push([...args])
      if (args.at(-1) !== '--json') return { stdout: `first-id ok active ${first}\ninvalid! ok active hidden\nsecond-id ok active ${second}\n` }
      const id = args[2]
      return { stdout: JSON.stringify({ id, name: id === 'first-id' ? 'First' : 'Second', lifecycle: 'active', health: 'ok', canonical_path: id === 'first-id' ? first : second, requirements: id === 'first-id' ? [{ path: '.ai/sdd/specs/001/requirements.md', status: 'tasks:approved' }] : [] }) }
    }
    const provider = new ProjectCandidateProvider('C:\\registry\\project_registry.py', folders, folderService, runner)

    const discovered = await provider.discover()
    expect(discovered).toEqual({ state: 'ready', candidates: [
      { id: 'first-id', label: 'First', health: 'ok', lifecycle: 'active', alreadyConnected: false, sddAvailable: true },
      { id: 'second-id', label: 'Second', health: 'ok', lifecycle: 'active', alreadyConnected: false, sddAvailable: false },
    ] })
    expect(folders.list()).toEqual([])
    expect(calls).toEqual([
      ['C:\\registry\\project_registry.py', 'list'],
      ['C:\\registry\\project_registry.py', 'resolve', 'first-id', '--json'],
      ['C:\\registry\\project_registry.py', 'resolve', 'second-id', '--json'],
    ])

    const preview = await provider.preview(['first-id', 'second-id'])
    expect(preview).toMatchObject({ state: 'ready', confirmationRequired: false })
    expect(provider.commit(preview.previewId!, false)).toMatchObject({ committed: true, folderIds: expect.any(Array) })
    expect(folders.list()).toHaveLength(2)
    await expect(provider.preview(Array.from({ length: 26 }, (_, index) => `id-${index}`))).resolves.toMatchObject({ state: 'unavailable', errorCode: 'PROJECT_CANDIDATE_SELECTION_INVALID' })
    database.close()
  })

  it('returns unavailable for malformed registry data without disrupting explicit folder setup', async () => {
    const { root, database, folders, detector, folderService } = await fixture()
    const explicit = join(root, 'explicit'); await mkdir(explicit)
    folders.upsertDetection(await detector.inspect(explicit), { id: 'explicit-project' })
    const runner: RegistryProcessRunner = async (_file, args) => args.at(-1) === '--json'
      ? { stdout: '{"id":"candidate","canonical_path":42}' }
      : { stdout: 'candidate ok active private-path\n' }
    const provider = new ProjectCandidateProvider('registry.py', folders, folderService, runner)
    expect(await provider.discover()).toEqual({ state: 'unavailable', candidates: [], errorCode: 'PROJECT_REGISTRY_UNAVAILABLE' })
    expect(folders.list().map(({ id }) => id)).toEqual(['explicit-project'])
    database.close()
  })
})

describe('ProjectAssociationService context resolution', () => {
  it('chooses exact or unique deepest approved folders and otherwise returns Unassigned', async () => {
    const { root, database, folders, detector, associations } = await fixture()
    const parent = join(root, 'parent'); const child = join(parent, 'child'); const work = join(child, 'work'); const elsewhere = join(root, 'elsewhere')
    await mkdir(work, { recursive: true }); await mkdir(elsewhere)
    folders.upsertDetection(await detector.inspect(parent), { id: 'parent-project' })
    folders.upsertDetection(await detector.inspect(child), { id: 'child-project' })
    expect(associations.resolveContext({ integrationId: 'integration-codex-1', cwd: child })).toEqual({ kind: 'approved-project', id: 'child-project' })
    expect(associations.resolveContext({ integrationId: 'integration-codex-1', cwd: work })).toEqual({ kind: 'approved-project', id: 'child-project' })
    expect(associations.resolveContext({ integrationId: 'integration-codex-1', cwd: elsewhere })).toEqual({ kind: 'unassigned' })
    database.close()
  })

  it('creates only an opaque review for equal-specificity or relocated/unavailable matches', async () => {
    const { root, database, folders, detector, associations } = await fixture()
    const project = join(root, 'project'); const work = join(project, 'work'); await mkdir(work, { recursive: true })
    const first = folders.upsertDetection(await detector.inspect(project), { id: 'project-a' })
    database.db.prepare(`INSERT INTO project_folders(id,label,canonical_path,path_fingerprint,state,detected_kind,sdd_enrichment_enabled,last_checked_at,last_success_at,last_error_code,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('project-b', 'Project alias', `${first.canonicalPath}${sep}`, 'b'.repeat(64), 'active', 'generic', 0, NOW.toISOString(), NOW.toISOString(), null, NOW.toISOString(), NOW.toISOString())
    const ambiguous = associations.resolveContext({ integrationId: 'integration-codex-1', cwd: work })
    expect(ambiguous).toMatchObject({ kind: 'needs-review', reviewToken: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    const review = database.db.prepare('SELECT review_token,integration_id,state,candidate_count FROM agent_project_reviews').get()
    expect(review).toEqual({ review_token: ambiguous.kind === 'needs-review' ? ambiguous.reviewToken : '', integration_id: 'integration-codex-1', state: 'pending', candidate_count: 2 })
    expect(JSON.stringify(review)).not.toContain(project)

    database.db.prepare("DELETE FROM project_folders WHERE id='project-b'").run()
    database.db.prepare("UPDATE project_folders SET detected_kind='unavailable',last_error_code='FOLDER_UNAVAILABLE' WHERE id='project-a'").run()
    expect(associations.resolveContext({ integrationId: 'integration-codex-1', cwd: work })).toMatchObject({ kind: 'needs-review' })
    database.close()
  })
})

describe('ProjectAssociationService explicit targets', () => {
  it('reuses the deterministic approved SDD task ticket and never edits SDD artifacts', async () => {
    const { root, database, operational, folders, detector, activities, associations } = await fixture()
    const project = join(root, 'sdd-project'); const spec = join(project, '.ai', 'sdd', 'specs', '015')
    await mkdir(spec, { recursive: true })
    const statusPath = join(spec, '.status'); const tasksPath = join(spec, 'tasks.md')
    await writeFile(statusPath, 'tasks:approved\n'); await writeFile(tasksPath, '- [ ] Keep human gate\n')
    folders.upsertDetection(await detector.inspect(project), { id: 'project-1' })
    const ticketId = 'ticket:sdd-task:project-1:015:T3'
    operational.saveTicket({ id: ticketId, status: 'todo', source: 'project-folders', origin: 'sdd-generated', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), payload: { title: 'Approved association task', generatedKind: 'sdd-task-execution', projectId: 'project-1', sddSpecId: '015', sddTaskId: 'T3', status: 'todo' } })
    operational.linkTicketSource(ticketId, 'project-folders', 'project-1:spec:015:task:T3', 'project-folder://project-1/spec/015/task/T3')
    const service = new AgentActivityService(activities, () => NOW, associations)

    const result = service.ingest(targetEvent({ kind: 'sdd-task', projectId: 'project-1', specId: '015', taskId: 'T3' }))
    expect(result).toMatchObject({ outcome: 'applied', ticketId })
    expect(operational.listTickets()).toHaveLength(1)
    expect(operational.ticketSourceLink('agent-activity', result.assignmentKey)?.ticketId).toBe(ticketId)
    expect(await readFile(statusPath, 'utf8')).toBe('tasks:approved\n')
    expect(await readFile(tasksPath, 'utf8')).toBe('- [ ] Keep human gate\n')
    database.close()
  })

  it('rejects gate placeholders and conflicting deterministic/source links without fuzzy or shared-brain mutation', async () => {
    const { root, database, operational, folders, detector, activities, associations } = await fixture()
    const project = join(root, 'project'); await mkdir(project)
    folders.upsertDetection(await detector.inspect(project), { id: 'project-1' })
    const deterministic = 'ticket:sdd-task:project-1:015:T3'
    operational.saveTicket({ id: deterministic, status: 'todo', source: 'project-folders', origin: 'sdd-generated', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), payload: { title: 'Similar title', generatedKind: 'sdd-task-execution', status: 'todo' } })
    operational.saveTicket({ id: 'other-task', status: 'todo', source: 'project-folders', origin: 'sdd-generated', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), payload: { title: 'Other', generatedKind: 'sdd-task-execution', status: 'todo' } })
    operational.linkTicketSource('other-task', 'project-folders', 'project-1:spec:015:task:T3', 'project-folder://project-1/spec/015/task/T3')
    operational.saveTicket({ id: 'gate', status: 'blocked', source: 'project-folders', origin: 'sdd-generated', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), payload: { title: 'Gate', generatedKind: 'sdd-gate-placeholder', status: 'blocked' } })
    const service = new AgentActivityService(activities, () => NOW, associations)

    expect(service.ingest(targetEvent({ kind: 'sdd-task', projectId: 'project-1', specId: '015', taskId: 'T3' }))).toMatchObject({ outcome: 'rejected', reasonCode: 'TARGET_CONFLICT' })
    expect(service.ingest(targetEvent({ kind: 'ticket', ticketId: 'gate' }, '018f6f7e-6f52-7e54-8aa5-000000000099'))).toMatchObject({ outcome: 'rejected', reasonCode: 'GATE_TARGET_FORBIDDEN' })
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM agent_assignments').get()).toEqual({ count: 0 })
    expect(operational.getConfiguredSource('agent-activity')?.config ?? {}).not.toHaveProperty('shared-brain')
    database.close()
  })
})

function targetEvent(targetRef: NonNullable<AssignmentEventV1['assignment']['targetRef']>, eventId = '018f6f7e-6f52-7e54-8aa5-000000000088'): AssignmentEventV1 {
  const base = assignmentEventFixture()
  return {
    ...base,
    eventId,
    integrationId: 'integration-codex-1',
    assignment: {
      ...base.assignment,
      originAssignmentId: `target-${eventId}`,
      projectRef: { kind: 'approved-project', id: 'project-1' },
      targetRef,
    },
    observation: { ...base.observation, observedAt: NOW.toISOString() },
  }
}
