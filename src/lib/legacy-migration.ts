import type { LegacyMigrationRecord, LegacyMigrationResult, OperationalRepository } from './operational-repository'
import type { LLMSource, Ticket, TicketStatus } from '../types'

const LEGACY_TICKETS_KEY = 'mnemosync_tickets'
const MIGRATION_ID_KEY = 'findmnemo.legacy-migration.id.v1'
const MIGRATION_RESULT_KEY = 'findmnemo.legacy-migration.result.v1'
const FORBIDDEN = /(body|raw|token|secret|password|credential|authorization|oauth|prompt|email(thread|message)?)/i
const SOURCES = new Set<LLMSource>(['Pi', 'Codex', 'Claude Cowork'])
const STATUSES = new Set<TicketStatus>(['todo', 'in-progress', 'done', 'blocked'])

export function readLegacyMigrationRecords(storage: Storage = localStorage): LegacyMigrationRecord[] {
  const raw = storage.getItem(LEGACY_TICKETS_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [{ legacyId: 'malformed-root', excluded: true }]
    return parsed.map((value, index) => normalize(value, index))
  } catch { return [{ legacyId: 'malformed-json', excluded: true }] }
}

export async function previewLegacyMigration(repository: OperationalRepository, storage: Storage = localStorage): Promise<{ records: LegacyMigrationRecord[]; result: LegacyMigrationResult }> {
  if (!repository.previewLegacyMigration) throw new Error('Migration preview is unavailable.')
  const records = readLegacyMigrationRecords(storage)
  return { records, result: await repository.previewLegacyMigration(records) }
}

export async function commitLegacyMigration(repository: OperationalRepository, records: LegacyMigrationRecord[], storage: Storage = localStorage): Promise<LegacyMigrationResult> {
  if (!repository.commitLegacyMigration) throw new Error('Migration commit is unavailable.')
  let idempotencyKey = storage.getItem(MIGRATION_ID_KEY)
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID()
    storage.setItem(MIGRATION_ID_KEY, idempotencyKey)
  }
  const result = await repository.commitLegacyMigration(records, idempotencyKey)
  storage.setItem(MIGRATION_RESULT_KEY, JSON.stringify({ ...result, committedAt: new Date().toISOString() }))
  return result
}

function normalize(value: unknown, index: number): LegacyMigrationRecord {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  const legacyId = typeof raw?.id === 'string' && raw.id ? raw.id : `malformed-${index + 1}`
  if (!raw || raw.origin === 'demo' || containsForbiddenKey(raw) || typeof raw.title !== 'string' || !raw.title.trim() || !SOURCES.has(raw.source as LLMSource) || !STATUSES.has(raw.status as TicketStatus)) return { legacyId, excluded: true }
  const now = new Date().toISOString()
  const ticket: Ticket = {
    id: legacyId, title: raw.title.trim(), description: typeof raw.description === 'string' ? raw.description : '',
    source: raw.source as LLMSource, status: raw.status as TicketStatus,
    workNotes: Array.isArray(raw.workNotes) ? raw.workNotes as Ticket['workNotes'] : [],
    decisionLog: Array.isArray(raw.decisionLog) ? raw.decisionLog as Ticket['decisionLog'] : [],
    artifacts: [], createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now, origin: 'imported',
  }
  return { legacyId, excluded: false, ticket }
}

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([key, child]) => FORBIDDEN.test(key) || containsForbiddenKey(child))
}
