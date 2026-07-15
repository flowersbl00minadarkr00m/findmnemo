import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectFolderRepository } from '../onboarding/project-folder-repository.js'

export class ProjectContextResolver {
  private readonly folders: ProjectFolderRepository
  private readonly scratchRoot: string
  constructor(folders: ProjectFolderRepository, scratchRoot: string) { this.folders = folders; this.scratchRoot = scratchRoot }
  async resolve(folderId?: string): Promise<{ kind: 'project' | 'scratch'; opaqueId: string; localPath: string }> {
    if (folderId) {
      const folder = this.folders.get(folderId)
      if (!folder || folder.state !== 'active' || folder.detectedKind === 'unavailable') throw new Error('PROJECT_CONTEXT_UNAVAILABLE')
      return { kind: 'project', opaqueId: folder.id, localPath: folder.canonicalPath }
    }
    const localPath = join(this.scratchRoot, 'routing-empty')
    await mkdir(localPath, { recursive: true })
    return { kind: 'scratch', opaqueId: 'scratch:empty', localPath }
  }
}
