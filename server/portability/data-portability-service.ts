import { createHash, randomUUID } from 'node:crypto'
import type {
  DataBundleArtifactV1,
  DataBundleV1,
  DataCategoryId,
  DataCategoryPreviewDto,
  DataExportPreviewDto,
  DataImportCategoryPreviewDto,
  DataImportCommitRequest,
  DataImportPreviewDto,
  DataPortabilityReceiptDto,
  OperationalRoutingPolicy,
  UsageQueryDto,
} from '../../shared/companion-contract.js'
import { DATA_CATEGORY_IDS, isDataCategoryId } from '../../shared/companion-contract.js'
import { assertPrivateBoundary, type OperationalRepository, type StoredTicket } from '../db/operational-repository.js'
import type { RoutingRepository } from '../routing/routing-repository.js'
import type { UsageRepository } from '../usage/usage-repository.js'

const EMPTY_USAGE_QUERY: UsageQueryDto = { start: null, end: null, clientId: null, providerId: null, modelId: null, profileId: null, mappingState: null }
const EXCLUSIONS = [
  'Credentials, authorization tokens, cookies, and secret-store material are never exported.',
  'Raw Gmail bodies, prompts, responses, transcripts, agent logs, and raw Tokscale output are never exported.',
  'Sample and legacy browser-local records are not part of operational exports.',
]
const PROHIBITED_KEYS = /(token|secret|password|credential|authorization|cookie|oauth|prompt|response|transcript|raw(?:log|output|body)?|body)/i
const CREDENTIAL_SHAPES = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|\bgh[opsu]_[A-Za-z0-9]{20,}\b|\bAIza[0-9A-Za-z_-]{20,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)/
const PLAN_TTL_MS = 10 * 60_000
const RECEIPT_CACHE_LIMIT = 100
const ARTIFACT_PROFILES: Record<DataCategoryId, { profile: string; schemaVersion: string; importable: boolean }> = {
  'tickets-work': { profile: 'findmnemo.tickets-work.v1', schemaVersion: '1.0.0', importable: true },
  'decisions-receipts': { profile: 'findmnemo.decisions-receipts.v1', schemaVersion: '1.0.0', importable: false },
  'routing-policy': { profile: 'findmnemo.operational-routing.v2', schemaVersion: '2.0.0', importable: true },
  'model-usage': { profile: 'findmnemo.usage-export.v1', schemaVersion: '1.0.0', importable: false },
  'email-metadata': { profile: 'findmnemo.email-metadata.v1', schemaVersion: '1.0.0', importable: false },
}

interface ImportPlan {
  id: string
  expiresAt: number
  hash: string
  bundle: DataBundleV1
  preview: DataImportPreviewDto
  used: boolean
}

function counts(overrides: Partial<Record<'add' | 'duplicate' | 'conflict' | 'excluded' | 'unsupported' | 'failed', number>> = {}) {
  return { add: 0, duplicate: 0, conflict: 0, excluded: 0, unsupported: 0, failed: 0, ...overrides }
}

function assertPortable(value: unknown, path = '$'): void {
  if (typeof value === 'string' && CREDENTIAL_SHAPES.test(value)) throw new Error(`PORTABILITY_CREDENTIAL_SHAPE:${path}`)
  if (Array.isArray(value)) return value.forEach((item, index) => assertPortable(item, `${path}[${index}]`))
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_KEYS.test(key)) throw new Error(`PORTABILITY_PROHIBITED_FIELD:${path}.${key}`)
    assertPortable(child, `${path}.${key}`)
  }
}

function parseBundle(value: unknown): DataBundleV1 {
  assertPortable(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PORTABILITY_INVALID_BUNDLE')
  const bundle = value as Partial<DataBundleV1>
  if (bundle.profile !== 'findmnemo.data-bundle.v1' || !bundle.manifest || !Array.isArray(bundle.artifacts)) throw new Error('PORTABILITY_UNSUPPORTED_PROFILE')
  if (bundle.manifest.profile !== 'findmnemo.data-bundle-manifest.v1' || bundle.manifest.workspace !== 'operational') throw new Error('PORTABILITY_UNSUPPORTED_MANIFEST')
  for (const artifact of bundle.artifacts) {
    if (!artifact || typeof artifact !== 'object' || !isDataCategoryId(artifact.category) || typeof artifact.profile !== 'string') throw new Error('PORTABILITY_INVALID_ARTIFACT')
    const supported = ARTIFACT_PROFILES[artifact.category]
    if (artifact.profile !== supported.profile || artifact.schemaVersion !== supported.schemaVersion || artifact.mediaType !== 'application/json') throw new Error('PORTABILITY_UNSUPPORTED_ARTIFACT_VERSION')
  }
  return bundle as DataBundleV1
}

function storedTicket(value: unknown): StoredTicket | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const ticket = value as Record<string, unknown>
  for (const key of ['id', 'status', 'source', 'origin', 'createdAt', 'updatedAt']) if (typeof ticket[key] !== 'string' || !ticket[key]) return null
  assertPrivateBoundary(ticket)
  return { id: String(ticket.id), status: String(ticket.status), source: String(ticket.source), origin: 'imported', createdAt: String(ticket.createdAt), updatedAt: String(ticket.updatedAt), payload: { ...ticket, origin: 'imported' } }
}

export class DataPortabilityService {
  private readonly plans = new Map<string, ImportPlan>()
  private readonly receipts = new Map<string, DataPortabilityReceiptDto>()
  private readonly operational: OperationalRepository
  private readonly routing: RoutingRepository
  private readonly usage: UsageRepository
  private readonly productVersion: string
  private readonly clock: () => Date

  constructor(
    operational: OperationalRepository,
    routing: RoutingRepository,
    usage: UsageRepository,
    productVersion: string,
    clock: () => Date = () => new Date(),
  ) {
    this.operational = operational
    this.routing = routing
    this.usage = usage
    this.productVersion = productVersion
    this.clock = clock
  }

  previewExport(): DataExportPreviewDto {
    return {
      schema: 'findmnemo.data-export-preview.v1',
      workspace: 'operational',
      generatedAt: this.clock().toISOString(),
      categories: this.categoryPreviews(),
      exclusions: EXCLUSIONS,
    }
  }

  createBundle(categoryIds: DataCategoryId[]): { fileName: string; json: string; receipt: DataPortabilityReceiptDto } {
    const selected = [...new Set(categoryIds)].filter((id) => DATA_CATEGORY_IDS.includes(id))
    if (selected.length === 0) throw new Error('PORTABILITY_NO_CATEGORIES')
    const preview = this.previewExport()
    const previews = selected.map((id) => preview.categories.find((item) => item.id === id)).filter((item): item is DataCategoryPreviewDto => Boolean(item?.exportable))
    if (previews.length !== selected.length) throw new Error('PORTABILITY_CATEGORY_UNAVAILABLE')
    const artifacts = previews.map((item) => this.exportArtifact(item.id))
    const generatedAt = this.clock().toISOString()
    const bundle: DataBundleV1 = {
      profile: 'findmnemo.data-bundle.v1',
      manifest: {
        profile: 'findmnemo.data-bundle-manifest.v1',
        product: { name: 'FindMnemo', version: this.productVersion },
        workspace: 'operational',
        generatedAt,
        categories: previews.map(({ id, state, recordCount, freshnessAt, coverage, artifactProfile }) => ({ id, state, recordCount, freshnessAt, coverage, artifactProfile })),
        exclusions: EXCLUSIONS,
        compatibility: { productId: 'findmnemo', legacyProductId: 'mnemosync', legacyUriScheme: 'mnemosync://' },
        evidenceBoundary: 'Local evidence may be partial and is not provider billing, subscription quota, complete inbox history, or complete account activity.',
      },
      artifacts,
    }
    assertPortable(bundle)
    const fileName = `findmnemo-data-${generatedAt.slice(0, 10)}.findmnemo.json`
    const receipt: DataPortabilityReceiptDto = {
      schema: 'findmnemo.data-portability-receipt.v1', operation: 'export', outcome: 'complete', completedAt: generatedAt, artifactName: fileName,
      categories: previews.map((item) => ({ id: item.id, added: 0, skipped: item.recordCount ?? 0, conflicts: 0, excluded: 0, failed: 0 })),
      nextAction: 'Store the downloaded file somewhere private. It may contain work metadata you selected.',
    }
    this.operational.appendAudit({ timestamp: generatedAt, action: 'data-export', objectRefs: selected, result: `categories:${selected.length}` })
    return { fileName, json: JSON.stringify(bundle, null, 2), receipt }
  }

  previewImport(value: unknown): DataImportPreviewDto {
    this.prunePlans()
    const bundle = parseBundle(value)
    const categories = bundle.artifacts.map((artifact) => this.previewImportArtifact(artifact))
    const now = this.clock().getTime()
    const planId = randomUUID()
    const preview: DataImportPreviewDto = {
      schema: 'findmnemo.data-import-preview.v1',
      planId,
      expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
      detectedProfile: bundle.profile,
      categories,
      safeToCommit: categories.some((category) => category.importable && category.counts.add > 0) && categories.every((category) => category.counts.failed === 0),
      errors: [],
    }
    this.plans.set(planId, { id: planId, expiresAt: now + PLAN_TTL_MS, hash: createHash('sha256').update(JSON.stringify(bundle)).digest('hex'), bundle, preview, used: false })
    return preview
  }

  commitImport(input: DataImportCommitRequest): DataPortabilityReceiptDto {
    this.prunePlans()
    const cached = this.receipts.get(input.idempotencyKey)
    if (cached) return cached
    const plan = this.plans.get(input.planId)
    if (!plan || plan.used || plan.expiresAt <= this.clock().getTime()) throw new Error('PORTABILITY_PLAN_EXPIRED')
    if (!input.idempotencyKey.trim()) throw new Error('PORTABILITY_IDEMPOTENCY_REQUIRED')
    const selected = [...new Set(input.categoryIds)].filter(isDataCategoryId)
    if (selected.length === 0) throw new Error('PORTABILITY_NO_CATEGORIES')
    const results: DataPortabilityReceiptDto['categories'] = []
    for (const categoryId of selected) {
      const artifact = plan.bundle.artifacts.find((item) => item.category === categoryId)
      const categoryPreview = plan.preview.categories.find((item) => item.id === categoryId)
      if (!artifact || !categoryPreview?.importable) {
        results.push({ id: categoryId, added: 0, skipped: 0, conflicts: 0, excluded: 0, failed: 1 })
        continue
      }
      if (categoryId === 'tickets-work') results.push(this.importTickets(artifact))
      else if (categoryId === 'routing-policy') results.push(this.importRouting(artifact))
    }
    plan.used = true
    const completedAt = this.clock().toISOString()
    const failed = results.some((result) => result.failed > 0)
    const partial = failed || results.some((result) => result.conflicts > 0 || result.excluded > 0)
    this.operational.appendAudit({ timestamp: completedAt, action: 'data-import', objectRefs: [plan.hash.slice(0, 12), ...selected], result: partial ? 'partial' : 'complete' })
    const receipt: DataPortabilityReceiptDto = {
      schema: 'findmnemo.data-portability-receipt.v1', operation: 'import', outcome: failed && results.every((result) => result.added === 0) ? 'failed' : partial ? 'partial' : 'complete',
      completedAt, artifactName: null, categories: results,
      nextAction: partial ? 'Review conflicts or unsupported categories. Current records were preserved.' : 'Reload the affected view to see imported records.',
    }
    this.receipts.set(input.idempotencyKey, receipt)
    while (this.receipts.size > RECEIPT_CACHE_LIMIT) this.receipts.delete(this.receipts.keys().next().value as string)
    return receipt
  }

  private categoryPreviews(): DataCategoryPreviewDto[] {
    const tickets = this.operationalTickets()
    const receipts = this.routing.listDispatchReceipts(100)
    const policy = this.routing.readPolicy()
    const usage = this.usage.exportSnapshot(EMPTY_USAGE_QUERY, policy, false)
    const email = this.operational.listEmailThreads()
    const latestUsage = usage.bounds.lastSuccessfulRefreshAt
    return [
      this.preview('tickets-work', 'Tickets and work', 'Operational tickets, decisions, evidence, and SDD provenance.', tickets.length, tickets[0]?.updatedAt ?? null, 'Companion-owned operational tickets.', true, true, 'findmnemo.tickets-work.v1'),
      this.preview('decisions-receipts', 'Decisions and receipts', 'Decision logs and metadata-only execution receipts.', receipts.length + tickets.reduce((sum, ticket) => sum + (Array.isArray(ticket.payload.decisionLog) ? ticket.payload.decisionLog.length : 0), 0), receipts[0]?.finishedAt ?? receipts[0]?.createdAt ?? null, 'Metadata-only local evidence; task content is excluded.', true, false, 'findmnemo.decisions-receipts.v1'),
      this.preview('routing-policy', 'Routing policy', 'Configured destinations, models, effort, and route preferences.', policy ? 1 : 0, policy?.updatedAt ?? null, 'Current companion-owned operational policy.', true, true, 'findmnemo.operational-routing.v2'),
      { ...this.preview('model-usage', 'Model usage', 'Normalized local token and estimated-cost evidence.', usage.records.length, latestUsage, usage.coverage?.complete ? 'Complete for available local sources in the retained range.' : 'Partial local source coverage.', true, false, 'findmnemo.usage-export.v1'), state: usage.coverage && !usage.coverage.complete ? 'partial' : usage.records.length ? 'available' : 'empty' },
      this.preview('email-metadata', 'Email metadata', 'Minimized Gmail response-candidate and ticket-link metadata.', email.length, email[0]?.receivedAt ?? null, 'Opt-in minimized metadata; email bodies and credentials are excluded.', false, false, 'findmnemo.email-metadata.v1'),
    ]
  }

  private preview(id: DataCategoryId, label: string, description: string, recordCount: number, freshnessAt: string | null, coverage: string, selectedByDefault: boolean, importable: boolean, artifactProfile: string): DataCategoryPreviewDto {
    return { id, label, description, state: recordCount > 0 ? 'available' : 'empty', recordCount, freshnessAt, coverage, selectedByDefault, exportable: true, importable, artifactProfile, privacyNote: 'Only normalized, category-approved fields are included.' }
  }

  private exportArtifact(category: DataCategoryId): DataBundleArtifactV1 {
    const tickets = this.operationalTickets()
    const policy = this.routing.readPolicy()
    if (category === 'tickets-work') return { category, profile: 'findmnemo.tickets-work.v1', mediaType: 'application/json', schemaVersion: '1.0.0', data: { tickets: tickets.map((ticket) => ticket.payload) } }
    if (category === 'decisions-receipts') return { category, profile: 'findmnemo.decisions-receipts.v1', mediaType: 'application/json', schemaVersion: '1.0.0', data: { ticketDecisions: tickets.flatMap((ticket) => Array.isArray(ticket.payload.decisionLog) ? ticket.payload.decisionLog.map((decision) => ({ ticketId: ticket.id, decision })) : []), routingReceipts: this.routing.listDispatchReceipts(100) } }
    if (category === 'routing-policy') return { category, profile: 'findmnemo.operational-routing.v2', mediaType: 'application/json', schemaVersion: '2.0.0', data: policy }
    if (category === 'model-usage') return { category, profile: 'findmnemo.usage-export.v1', mediaType: 'application/json', schemaVersion: '1.0.0', data: this.usage.exportSnapshot(EMPTY_USAGE_QUERY, policy, true) }
    return { category, profile: 'findmnemo.email-metadata.v1', mediaType: 'application/json', schemaVersion: '1.0.0', data: { candidates: this.operational.listEmailThreads().map(({ accountId, threadId, latestMessageId, sender, subject, receivedAt, snippet, reasonCodes, state, recordVersion }) => ({ accountId, threadId, latestMessageId, sender, subject, receivedAt, snippet, reasonCodes, state, recordVersion })) } }
  }

  private previewImportArtifact(artifact: DataBundleArtifactV1): DataImportCategoryPreviewDto {
    if (artifact.category === 'tickets-work') {
      const input = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data) ? (artifact.data as { tickets?: unknown }).tickets : undefined
      if (!Array.isArray(input)) return { id: artifact.category, importable: true, counts: counts({ failed: 1 }), conflictPolicy: 'preserve-current', note: 'Ticket artifact is malformed.' }
      let add = 0; let duplicate = 0; let conflict = 0; let excluded = 0
      for (const value of input) {
        const ticket = storedTicket(value)
        if (!ticket) { excluded += 1; continue }
        const existing = this.operational.getTicket(ticket.id)
        if (!existing) add += 1
        else if (JSON.stringify(existing.payload) === JSON.stringify(ticket.payload)) duplicate += 1
        else conflict += 1
      }
      return { id: artifact.category, importable: true, counts: counts({ add, duplicate, conflict, excluded }), conflictPolicy: 'preserve-current', note: 'New tickets may be added. Existing ticket IDs are preserved.' }
    }
    if (artifact.category === 'routing-policy') {
      const current = this.routing.readPolicy()
      const valid = artifact.data && typeof artifact.data === 'object' && !Array.isArray(artifact.data)
      return { id: artifact.category, importable: true, counts: counts(valid ? current ? { conflict: 1 } : { add: 1 } : { failed: 1 }), conflictPolicy: 'preserve-current', note: current ? 'A policy already exists; use the routing policy import workflow for explicit replacement.' : 'A validated policy can be added.' }
    }
    return { id: artifact.category, importable: false, counts: counts({ unsupported: 1 }), conflictPolicy: 'not-applicable', note: 'Export-only evidence is not imported as locally observed truth.' }
  }

  private importTickets(artifact: DataBundleArtifactV1): DataPortabilityReceiptDto['categories'][number] {
    const values = ((artifact.data as { tickets?: unknown[] })?.tickets ?? [])
    let added = 0; let skipped = 0; let conflicts = 0; let excluded = 0
    this.operational.transaction(() => {
      for (const value of values) {
        const ticket = storedTicket(value)
        if (!ticket) { excluded += 1; continue }
        const existing = this.operational.getTicket(ticket.id)
        if (existing) {
          if (JSON.stringify(existing.payload) === JSON.stringify(ticket.payload)) skipped += 1
          else conflicts += 1
          continue
        }
        this.operational.saveTicket(ticket); added += 1
      }
    })
    return { id: 'tickets-work', added, skipped, conflicts, excluded, failed: 0 }
  }

  private importRouting(artifact: DataBundleArtifactV1): DataPortabilityReceiptDto['categories'][number] {
    if (this.routing.readPolicy()) return { id: 'routing-policy', added: 0, skipped: 0, conflicts: 1, excluded: 0, failed: 0 }
    try {
      const result = this.routing.compareAndSetPolicy(artifact.data as OperationalRoutingPolicy, null)
      return result.status === 'saved' ? { id: 'routing-policy', added: 1, skipped: 0, conflicts: 0, excluded: 0, failed: 0 } : { id: 'routing-policy', added: 0, skipped: 0, conflicts: 0, excluded: 0, failed: 1 }
    } catch {
      return { id: 'routing-policy', added: 0, skipped: 0, conflicts: 0, excluded: 0, failed: 1 }
    }
  }

  private prunePlans(): void {
    const now = this.clock().getTime()
    for (const [id, plan] of this.plans) if (plan.used || plan.expiresAt <= now) this.plans.delete(id)
    while (this.plans.size >= 10) this.plans.delete(this.plans.keys().next().value as string)
  }

  private operationalTickets(): StoredTicket[] {
    return this.operational.listTickets().filter((ticket) => ticket.origin !== 'demo' && ticket.payload.origin !== 'demo')
  }
}
