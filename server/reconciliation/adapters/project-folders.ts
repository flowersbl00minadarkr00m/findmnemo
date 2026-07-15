import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalSourceAdapter, SourceCheckContext, SourceRecord } from '../../../shared/companion-contract.js'
import { scanSddProjectRoot } from '../../../shared/sdd-scanner.js'
import type { ProjectFolderRepository, ProjectFolderRecord } from '../../onboarding/project-folder-repository.js'
import type { ProjectFolderDetector } from '../../onboarding/project-folder-detector.js'

export class ProjectFoldersAdapter implements LocalSourceAdapter {
  readonly descriptor = { id: 'project-folders', label: 'Project folders', adapterVersion: '1.0.0', enabled: false, policy: 'auto-create' } as const
  private readonly repository: ProjectFolderRepository
  private readonly detector: ProjectFolderDetector

  constructor(repository: ProjectFolderRepository, detector: ProjectFolderDetector) {
    this.repository = repository
    this.detector = detector
  }

  async *check(_context: SourceCheckContext) {
    const folders = this.repository.list().filter((folder) => folder.state === 'active')
    if (!folders.length) throw new Error('No project folders are configured')
    const records: SourceRecord[] = []
    for (const folder of folders) {
      const current = this.repository.upsertDetection(await this.detector.inspect(folder.canonicalPath), {
        id: folder.id, label: folder.label, sddEnrichmentEnabled: folder.sddEnrichmentEnabled,
      })
      records.push(record(current, `${current.id}:project`, current.label, current.detectedKind, 'project', false))
      if (current.detectedKind !== 'sdd' || !current.sddEnrichmentEnabled) continue
      const scan = await scanSddProjectRoot(current.canonicalPath)
      for (const spec of scan.specs) {
        const base = `${current.id}:spec:${spec.specId}`
        const state = spec.rawStatus ?? 'invalid-status'
        const active = state !== 'review:done'
        records.push(record(current, base, spec.specTitle ?? spec.specId, state, `spec/${spec.specId}`, active))
        const tasksRef = spec.artifactRefs.find((ref) => ref.kind === 'tasks')
        if (!tasksRef) continue
        const markdown = await readFile(join(current.canonicalPath, tasksRef.path), 'utf8')
        for (const task of parseTasks(markdown)) records.push(record(current, `${base}:task:${task.id}`, task.title, task.state, `spec/${spec.specId}/task/${task.id}`, task.state !== 'done'))
      }
    }
    yield { records, complete: true }
  }
}

function record(folder: ProjectFolderRecord, externalId: string, title: string, state: string, ref: string, eligibleForTicket: boolean): SourceRecord {
  return {
    sourceId: 'project-folders', externalId, title, state,
    fingerprint: createHash('sha256').update(JSON.stringify([externalId, title, state])).digest('hex'),
    observedAt: folder.lastCheckedAt ?? folder.updatedAt,
    provenanceRef: `project-folder://${encodeURIComponent(folder.id)}/${ref}`,
    eligibleForTicket,
    exclusionReason: eligibleForTicket ? undefined : 'SOURCE_RECORD_INELIGIBLE',
  }
}

function parseTasks(markdown: string): Array<{ id: string; title: string; state: string }> {
  return [...markdown.matchAll(/^## Task (T[0-9A-Za-z.-]+):\s+(.+)$/gm)].map((match) => {
    const start = match.index ?? 0
    const next = markdown.indexOf('\n## Task ', start + 1)
    const block = markdown.slice(start, next < 0 ? undefined : next)
    return { id: match[1], title: match[2].trim(), state: /^\*\*Status:\*\*\s*complete$/im.test(block) || !/^- \[ \]/m.test(block) ? 'done' : 'todo' }
  })
}
