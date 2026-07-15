import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { relative } from 'node:path'
import type { ProjectFolderDetection, ProjectFolderKind } from './project-folder-detector.js'

export interface ProjectFolderRecord {
  id: string
  label: string
  canonicalPath: string
  pathFingerprint: string
  state: 'active' | 'paused'
  detectedKind: ProjectFolderKind
  sddEnrichmentEnabled: boolean
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}

export interface FolderRelationship { kind: 'new' | 'duplicate' | 'nested' | 'contains-existing'; existingId?: string }

export class ProjectFolderRepository {
  private readonly hmacKey: Buffer
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
    this.hmacKey = loadOrCreateKey(db)
  }

  list(): ProjectFolderRecord[] {
    return (this.db.prepare('SELECT * FROM project_folders ORDER BY created_at,id').all() as Array<Record<string, unknown>>).map(fromRow)
  }

  get(id: string): ProjectFolderRecord | undefined {
    const row = this.db.prepare('SELECT * FROM project_folders WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? fromRow(row) : undefined
  }

  classify(canonicalPath: string): FolderRelationship {
    for (const existing of this.list()) {
      if (samePath(existing.canonicalPath, canonicalPath)) return { kind: 'duplicate', existingId: existing.id }
      if (isInside(existing.canonicalPath, canonicalPath)) return { kind: 'nested', existingId: existing.id }
      if (isInside(canonicalPath, existing.canonicalPath)) return { kind: 'contains-existing', existingId: existing.id }
    }
    return { kind: 'new' }
  }

  upsertDetection(detection: ProjectFolderDetection, input: { id?: string; label?: string; sddEnrichmentEnabled?: boolean } = {}): ProjectFolderRecord {
    const existing = this.list().find((row) => samePath(row.canonicalPath, detection.canonicalPath))
    const id = existing?.id ?? input.id ?? randomUUID()
    const now = detection.checkedAt
    const label = input.label?.trim() || existing?.label || detection.label
    const success = detection.kind === 'unavailable' ? existing?.lastSuccessAt ?? null : now
    this.db.prepare(`INSERT INTO project_folders(id,label,canonical_path,path_fingerprint,state,detected_kind,sdd_enrichment_enabled,last_checked_at,last_success_at,last_error_code,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canonical_path) DO UPDATE SET label=excluded.label,
      detected_kind=excluded.detected_kind,sdd_enrichment_enabled=excluded.sdd_enrichment_enabled,last_checked_at=excluded.last_checked_at,
      last_success_at=excluded.last_success_at,last_error_code=excluded.last_error_code,updated_at=excluded.updated_at`)
      .run(id, label, detection.canonicalPath, this.fingerprint(detection.canonicalPath), existing?.state ?? 'active', detection.kind,
        (input.sddEnrichmentEnabled ?? existing?.sddEnrichmentEnabled ?? detection.kind === 'sdd') ? 1 : 0,
        now, success, detection.errorCode, existing?.createdAt ?? now, now)
    return this.list().find((row) => samePath(row.canonicalPath, detection.canonicalPath))!
  }

  setState(id: string, state: 'active' | 'paused', updatedAt: string): boolean {
    return this.db.prepare('UPDATE project_folders SET state=?,updated_at=? WHERE id=?').run(state, updatedAt, id).changes > 0
  }

  update(id: string, input: { label?: string; state?: 'active' | 'paused'; sddEnrichmentEnabled?: boolean }, updatedAt: string): boolean {
    const current = this.get(id)
    if (!current) return false
    const label = input.label === undefined ? current.label : input.label.trim()
    if (!label || label.length > 120) throw new Error('PROJECT_FOLDER_INVALID')
    return this.db.prepare('UPDATE project_folders SET label=?,state=?,sdd_enrichment_enabled=?,updated_at=? WHERE id=?')
      .run(label, input.state ?? current.state, (input.sddEnrichmentEnabled ?? current.sddEnrichmentEnabled) ? 1 : 0, updatedAt, id).changes > 0
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM project_folders WHERE id=?').run(id).changes > 0
  }

  migrateLegacy(projects: unknown, detect: (path: string) => Promise<ProjectFolderDetection>): Promise<ProjectFolderRecord[]> {
    const inputs = Array.isArray(projects) ? projects.filter(isLegacyProject) : []
    return Promise.all(inputs.map(async (project) => this.upsertDetection(await detect(project.canonicalPath), {
      id: `legacy-${project.id}`,
      label: project.name ?? project.id,
      sddEnrichmentEnabled: true,
    })))
  }

  private fingerprint(path: string): string {
    return createHmac('sha256', this.hmacKey).update(normalized(path)).digest('hex')
  }
}

function loadOrCreateKey(db: DatabaseSync): Buffer {
  const existing = db.prepare("SELECT value FROM app_meta WHERE key='project_folder_hmac_key'").get() as { value?: string } | undefined
  if (existing?.value && /^[a-f0-9]{64}$/i.test(existing.value)) return Buffer.from(existing.value, 'hex')
  const value = randomBytes(32)
  db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('project_folder_hmac_key',?)").run(value.toString('hex'))
  return value
}

function fromRow(row: Record<string, unknown>): ProjectFolderRecord {
  return {
    id: String(row.id), label: String(row.label), canonicalPath: String(row.canonical_path), pathFingerprint: String(row.path_fingerprint),
    state: String(row.state) as ProjectFolderRecord['state'], detectedKind: String(row.detected_kind) as ProjectFolderKind,
    sddEnrichmentEnabled: Boolean(row.sdd_enrichment_enabled), lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null, lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }
}

function isLegacyProject(value: unknown): value is { id: string; name?: string; canonicalPath: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { canonicalPath?: unknown }).canonicalPath === 'string'
}

function normalized(path: string): string { return process.platform === 'win32' ? path.toLowerCase() : path }
function samePath(left: string, right: string): boolean { return normalized(left) === normalized(right) }
function isInside(parent: string, child: string): boolean {
  const result = relative(parent, child)
  return result !== '' && !result.startsWith('..') && !result.includes(':')
}
