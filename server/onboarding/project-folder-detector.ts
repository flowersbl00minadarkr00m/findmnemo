import { access, lstat, realpath } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export type ProjectFolderKind = 'sdd' | 'git' | 'generic' | 'unavailable'

export interface ProjectFolderDetection {
  canonicalPath: string
  label: string
  kind: ProjectFolderKind
  checkedAt: string
  errorCode: 'FOLDER_UNAVAILABLE' | null
}

const PROJECT_MARKERS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Makefile'] as const

export class ProjectFolderDetector {
  private readonly clock: () => Date

  constructor(clock: () => Date = () => new Date()) { this.clock = clock }

  async inspect(inputPath: string): Promise<ProjectFolderDetection> {
    const fallbackPath = resolve(inputPath)
    const checkedAt = this.clock().toISOString()
    try {
      const canonicalPath = await realpath(fallbackPath)
      if (!(await lstat(canonicalPath)).isDirectory()) throw new Error('not-directory')
      if (await isDirectory(join(canonicalPath, '.ai', 'sdd'))) return { canonicalPath, label: basename(canonicalPath), kind: 'sdd', checkedAt, errorCode: null }
      if (await isDirectory(join(canonicalPath, '.git')) || await hasAnyMarker(canonicalPath)) return { canonicalPath, label: basename(canonicalPath), kind: 'git', checkedAt, errorCode: null }
      return { canonicalPath, label: basename(canonicalPath), kind: 'generic', checkedAt, errorCode: null }
    } catch {
      return { canonicalPath: fallbackPath, label: basename(fallbackPath) || 'Project folder', kind: 'unavailable', checkedAt, errorCode: 'FOLDER_UNAVAILABLE' }
    }
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await lstat(path)).isDirectory() } catch { return false }
}

async function hasAnyMarker(root: string): Promise<boolean> {
  for (const marker of PROJECT_MARKERS) {
    try { await access(join(root, marker)); return true } catch { /* bounded marker absent */ }
  }
  return false
}
