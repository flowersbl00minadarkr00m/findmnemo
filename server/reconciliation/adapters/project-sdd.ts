import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalSourceAdapter, SourceCheckContext, SourceRecord } from '../../../shared/companion-contract.js'
import { scanSddProjectRoot } from '../../../shared/sdd-scanner.js'
import type { OperationalRepository } from '../../db/operational-repository.js'

interface RegisteredProject { id: string; name?: string; canonicalPath: string }

export class ProjectSddAdapter implements LocalSourceAdapter {
  readonly descriptor = { id: 'project-sdd', label: 'Project / SDD registry', adapterVersion: '1.0.0', enabled: false, policy: 'auto-create' } as const
  private readonly repository: OperationalRepository
  constructor(repository: OperationalRepository) { this.repository = repository }

  async *check(_context: SourceCheckContext) {
    const config = this.repository.getConfiguredSource('project-sdd')?.config
    const projects = Array.isArray(config?.projects) ? config.projects.filter(isProject) : []
    if (!projects.length) throw new Error('No registered projects')
    const records: SourceRecord[] = []
    for (const project of projects) {
      const scan = await scanSddProjectRoot(project.canonicalPath)
      if (scan.state === 'missing') throw new Error(`Registered project is unavailable: ${project.id}`)
      records.push(sourceRecord(`${project.id}:project`, project.name ?? project.id, scan.state, `${project.id}/project`))
      for (const spec of scan.specs) {
        const base = `${project.id}:spec:${spec.specId}`
        records.push(sourceRecord(base, spec.specTitle ?? spec.specId, spec.rawStatus ?? 'invalid-status', `${project.id}/spec/${spec.specId}`))
        records.push(sourceRecord(`${base}:gate`, `${spec.specId} gate`, spec.rawStatus ?? 'invalid-status', `${project.id}/spec/${spec.specId}/gate`))
        const tasksRef = spec.artifactRefs.find((ref) => ref.kind === 'tasks')
        if (tasksRef) {
          const markdown = await readFile(join(project.canonicalPath, tasksRef.path), 'utf8')
          for (const task of parseTasks(markdown)) records.push(sourceRecord(`${base}:task:${task.id}`, task.title, task.state, `${project.id}/spec/${spec.specId}/task/${task.id}`))
        }
      }
    }
    yield { records, complete: true }
  }
}

function isProject(value: unknown): value is RegisteredProject {
  return typeof value === 'object' && value !== null && typeof (value as RegisteredProject).id === 'string' && typeof (value as RegisteredProject).canonicalPath === 'string'
}

function sourceRecord(externalId: string, title: string, state: string, ref: string): SourceRecord {
  return {
    sourceId: 'project-sdd', externalId, title, state,
    fingerprint: createHash('sha256').update(JSON.stringify([externalId, title, state])).digest('hex'),
    observedAt: new Date().toISOString(), provenanceRef: `registry://${ref}`, eligibleForTicket: true,
  }
}

function parseTasks(markdown: string): Array<{ id: string; title: string; state: string }> {
  return [...markdown.matchAll(/^## Task (T[0-9A-Za-z.-]+):\s+(.+)$/gm)].map((match) => {
    const start = match.index ?? 0
    const next = markdown.indexOf('\n## Task ', start + 1)
    const block = markdown.slice(start, next < 0 ? undefined : next)
    const remaining = [...block.matchAll(/^- \[ \]/gm)].length
    return { id: match[1], title: match[2].trim(), state: remaining ? 'todo' : 'done' }
  })
}
