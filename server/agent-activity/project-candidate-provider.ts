import { execFile } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import type { ProjectFolderSelectionPreview } from '../../shared/lifecycle-contract.js'
import type { ProjectFolderRepository } from '../onboarding/project-folder-repository.js'
import type { ProjectFolderService } from '../onboarding/project-folder-service.js'

const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_CANDIDATES = 100
const MAX_APPROVALS = 25

export interface RegistryProcessRunner {
  (file: string, args: readonly string[]): Promise<{ stdout: string }>
}

export interface SafeProjectCandidate {
  id: string
  label: string
  health: string
  lifecycle: string
  alreadyConnected: boolean
  sddAvailable: boolean
}

export type ProjectCandidateSnapshot =
  | { state: 'ready'; candidates: SafeProjectCandidate[] }
  | { state: 'unavailable'; candidates: []; errorCode: 'PROJECT_REGISTRY_UNAVAILABLE' }

interface LocalCandidate extends SafeProjectCandidate { canonicalPath: string }

export class ProjectCandidateProvider {
  private readonly registryScript: string
  private readonly folders: ProjectFolderRepository
  private readonly folderService: ProjectFolderService
  private readonly runner: RegistryProcessRunner
  private candidates = new Map<string, LocalCandidate>()

  constructor(registryScript: string, folders: ProjectFolderRepository, folderService: ProjectFolderService, runner: RegistryProcessRunner = runPython) {
    this.registryScript = registryScript
    this.folders = folders
    this.folderService = folderService
    this.runner = runner
  }

  async discover(): Promise<ProjectCandidateSnapshot> {
    try {
      const listed = await this.runner('python', [this.registryScript, 'list'])
      if (listed.stdout.length > 128 * 1024) throw new Error('registry-list-too-large')
      const ids = strictProjectIds(listed.stdout)
      const resolved = await Promise.all(ids.map(async (id) => this.resolveCandidate(id)))
      this.candidates = new Map(resolved.map((candidate) => [candidate.id, candidate]))
      return { state: 'ready', candidates: resolved.map(safeCandidate) }
    } catch {
      this.candidates.clear()
      return { state: 'unavailable', candidates: [], errorCode: 'PROJECT_REGISTRY_UNAVAILABLE' }
    }
  }

  async preview(ids: readonly string[]): Promise<ProjectFolderSelectionPreview> {
    const selected = [...new Set(ids)]
    if (!selected.length || selected.length > MAX_APPROVALS || selected.some((id) => !PROJECT_ID.test(id) || !this.candidates.has(id))) {
      return { state: 'unavailable', items: [], confirmationRequired: false, errorCode: 'PROJECT_CANDIDATE_SELECTION_INVALID' }
    }
    return this.folderService.preview(selected.map((id) => this.candidates.get(id)!.canonicalPath))
  }

  commit(previewId: string, warningsConfirmed: boolean): ReturnType<ProjectFolderService['commit']> {
    return this.folderService.commit(previewId, warningsConfirmed)
  }

  private async resolveCandidate(id: string): Promise<LocalCandidate> {
    const result = await this.runner('python', [this.registryScript, 'resolve', id, '--json'])
    if (result.stdout.length > 64 * 1024) throw new Error('registry-result-too-large')
    const value = JSON.parse(result.stdout) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('registry-result-invalid')
    const record = value as Record<string, unknown>
    if (record.id !== id || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 120) throw new Error('registry-identity-invalid')
    if (typeof record.health !== 'string' || record.health.length > 32 || typeof record.lifecycle !== 'string' || record.lifecycle.length > 32) throw new Error('registry-state-invalid')
    if (typeof record.canonical_path !== 'string' || record.canonical_path.length > 2_048 || !isAbsolute(record.canonical_path)) throw new Error('registry-path-invalid')
    const canonicalPath = resolve(record.canonical_path)
    const relationship = this.folders.classify(canonicalPath)
    return {
      id,
      label: record.name.trim(),
      health: record.health,
      lifecycle: record.lifecycle,
      canonicalPath,
      alreadyConnected: relationship.kind === 'duplicate',
      sddAvailable: Array.isArray(record.requirements) && record.requirements.some(validRequirement),
    }
  }
}

function strictProjectIds(stdout: string): string[] {
  const ids: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const id = line.trim().split(/\s+/, 1)[0]
    if (!PROJECT_ID.test(id) || ids.includes(id)) continue
    ids.push(id)
    if (ids.length === MAX_CANDIDATES) break
  }
  return ids
}

function validRequirement(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.path === 'string' && record.path.startsWith('.ai/sdd/') && typeof record.status === 'string'
}

function safeCandidate(candidate: LocalCandidate): SafeProjectCandidate {
  const { canonicalPath: _discarded, ...safe } = candidate
  return safe
}

const runPython: RegistryProcessRunner = (file, args) => new Promise((resolvePromise, reject) => {
  execFile(file, [...args], { windowsHide: true, shell: false, maxBuffer: 128 * 1024 }, (error, stdout) => {
    if (error) reject(error)
    else resolvePromise({ stdout })
  })
})
