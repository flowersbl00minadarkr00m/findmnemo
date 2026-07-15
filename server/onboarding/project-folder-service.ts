import { randomUUID } from 'node:crypto'
import type { ProjectFolderSelectionPreview } from '../../shared/lifecycle-contract.js'
import type { ProjectFolderSummaryDto } from '../../shared/companion-contract.js'
import type { OperationalRepository } from '../db/operational-repository.js'
import type { ProjectFolderDetection } from './project-folder-detector.js'
import { ProjectFolderDetector } from './project-folder-detector.js'
import { ProjectFolderRepository, type FolderRelationship } from './project-folder-repository.js'

interface PendingPreview { expiresAt: number; items: Array<{ detection: ProjectFolderDetection; relationship: FolderRelationship }>; committedIds?: string[] }

export class ProjectFolderService {
  private readonly previews = new Map<string, PendingPreview>()
  private readonly folders: ProjectFolderRepository
  private readonly detector: ProjectFolderDetector
  private readonly sources: OperationalRepository
  private readonly clock: () => Date

  constructor(folders: ProjectFolderRepository, detector: ProjectFolderDetector, sources: OperationalRepository, clock: () => Date = () => new Date()) {
    this.folders = folders
    this.detector = detector
    this.sources = sources
    this.clock = clock
  }

  list(): ProjectFolderSummaryDto[] { return this.folders.list().map(safeSummary) }

  async preview(paths: readonly string[]): Promise<ProjectFolderSelectionPreview> {
    if (!paths.length) return { state: 'cancelled', items: [], confirmationRequired: false }
    if (paths.length > 20 || paths.some((path) => typeof path !== 'string' || path.length > 2_048)) return { state: 'unavailable', items: [], confirmationRequired: false, errorCode: 'PROJECT_FOLDER_SELECTION_INVALID' }
    const detected = await Promise.all(paths.map((path) => this.detector.inspect(path)))
    const items = detected.map((detection) => ({ detection, relationship: this.folders.classify(detection.canonicalPath) }))
    const previewId = randomUUID()
    const expiresAt = this.clock().getTime() + 5 * 60_000
    this.previews.set(previewId, { expiresAt, items })
    return { state: 'ready', previewId, expiresAt: new Date(expiresAt).toISOString(), items: items.map(({ detection, relationship }) => ({ label: detection.label, detectedKind: detection.kind, relationship: relationship.kind, warning: warningFor(relationship), sddEnrichmentAvailable: detection.kind === 'sdd' })), confirmationRequired: items.some(({ relationship }) => relationship.kind !== 'new') }
  }

  commit(previewId: string, warningsConfirmed: boolean): { committed: boolean; folderIds: string[]; errorCode?: string } {
    const preview = this.previews.get(previewId)
    if (!preview || preview.expiresAt < this.clock().getTime()) { this.previews.delete(previewId); return { committed: false, folderIds: [], errorCode: 'PROJECT_FOLDER_PREVIEW_EXPIRED' } }
    if (preview.committedIds) return { committed: true, folderIds: preview.committedIds }
    if (!warningsConfirmed && preview.items.some(({ relationship }) => relationship.kind !== 'new')) return { committed: false, folderIds: [], errorCode: 'PROJECT_FOLDER_CONFIRMATION_REQUIRED' }
    const ids = preview.items.map(({ detection }) => this.folders.upsertDetection(detection, { sddEnrichmentEnabled: detection.kind === 'sdd' }).id)
    preview.committedIds = ids
    this.sources.saveConfiguredSource({ id: 'project-folders', label: 'Project folders', adapterVersion: '1.0.0', enabled: true, policy: 'review', locationLabel: `${this.folders.list().length} project folder${this.folders.list().length === 1 ? '' : 's'}` }, {})
    return { committed: true, folderIds: ids }
  }

  update(id: string, input: { label?: string; state?: 'active' | 'paused'; sddEnrichmentEnabled?: boolean }): ProjectFolderSummaryDto | null {
    if (!this.folders.update(id, input, this.clock().toISOString())) return null
    return safeSummary(this.folders.get(id)!)
  }

  remove(id: string): boolean { return this.folders.remove(id) }
}

function safeSummary(folder: ReturnType<ProjectFolderRepository['list']>[number]): ProjectFolderSummaryDto {
  return { id: folder.id, label: folder.label, state: folder.state, detectedKind: folder.detectedKind, sddEnrichmentEnabled: folder.sddEnrichmentEnabled, lastCheckedAt: folder.lastCheckedAt, lastSuccessAt: folder.lastSuccessAt, errorCode: folder.lastErrorCode === 'FOLDER_UNAVAILABLE' ? 'FOLDER_UNAVAILABLE' : null }
}
function warningFor(relationship: FolderRelationship): string | null {
  if (relationship.kind === 'duplicate') return 'This folder is already connected.'
  if (relationship.kind === 'nested') return 'This folder is inside a connected folder.'
  if (relationship.kind === 'contains-existing') return 'This folder contains a connected folder.'
  return null
}
