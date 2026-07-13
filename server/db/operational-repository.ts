import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SourceRecord, SourceDescriptor, ReconciliationRunState, GmailCandidateDto, GmailTicketAssociationDto, GmailCheckDto, ReconciliationItemResultDto, ReconciliationRunDto, ReconciliationSourceResultDto, SourceId } from '../../shared/companion-contract.js'

const FORBIDDEN_PRIVATE_KEYS = /(body|raw|token|secret|password|credential|authorization|oauth|prompt)/i

export interface StoredTicket {
  id: string
  status: string
  source: string
  origin: string
  createdAt: string
  updatedAt: string
  payload: Record<string, unknown>
}

export interface StoredEmailThread {
  accountId: string
  threadId: string
  latestMessageId: string
  sender: string
  subject: string
  receivedAt: string
  snippet: string
  reasonCodes: string[]
  triageState: 'candidate' | 'confirmed' | 'dismissed' | 'deferred' | 'linked' | 'confirmed-untracked'
  createdAt: string
  updatedAt: string
}

export interface StoredConfiguredSource {
  descriptor: SourceDescriptor
  config: Record<string, unknown>
  lastAttemptAt?: string
  lastSuccessAt?: string
}

export interface AuditEventInput {
  id?: string
  timestamp: string
  action: string
  reasonCode?: string
  objectRefs: string[]
  result: string
}

export interface LegacyMigrationRecord { legacyId: string; excluded: boolean; ticket?: StoredTicket }
export interface LegacyMigrationResult { eligible: number; conflicts: number; excluded: number; imported: number; alreadyImported: number }

function safeJson(value: unknown): string {
  assertPrivateBoundary(value)
  return JSON.stringify(value)
}

export function assertPrivateBoundary(value: unknown, path = '$'): void {
  if (Array.isArray(value)) return value.forEach((item, index) => assertPrivateBoundary(item, `${path}[${index}]`))
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PRIVATE_KEYS.test(key)) throw new Error(`Private field is not allowed at ${path}.${key}.`)
    assertPrivateBoundary(child, `${path}.${key}`)
  }
}

export class OperationalRepository {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  saveTicket(ticket: StoredTicket): void {
    this.db.prepare(`INSERT INTO tickets(id,status,source,origin,created_at,updated_at,payload_json)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,source=excluded.source,
      origin=excluded.origin,updated_at=excluded.updated_at,payload_json=excluded.payload_json`)
      .run(ticket.id, ticket.status, ticket.source, ticket.origin, ticket.createdAt, ticket.updatedAt, safeJson(ticket.payload))
  }

  listTickets(): StoredTicket[] {
    const rows = this.db.prepare('SELECT id,status,source,origin,created_at,updated_at,payload_json FROM tickets ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      status: String(row.status),
      source: String(row.source),
      origin: String(row.origin),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    }))
  }

  getTicket(id: string): StoredTicket | undefined {
    return this.listTickets().find((ticket) => ticket.id === id)
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (cause) {
      this.db.exec('ROLLBACK')
      throw cause
    }
  }

  deleteTicket(id: string): boolean {
    return this.db.prepare('DELETE FROM tickets WHERE id=?').run(id).changes > 0
  }

  migrateLegacyTickets(records: LegacyMigrationRecord[], idempotencyKey: string, commit: boolean, createdAt: string): LegacyMigrationResult {
    const existing = this.db.prepare('SELECT result_json FROM idempotency_results WHERE idempotency_key=? AND action=?').get(idempotencyKey, 'legacy-ticket-migration') as { result_json?: string } | undefined
    if (commit && existing?.result_json) return JSON.parse(existing.result_json) as LegacyMigrationResult
    const classify = () => {
      const result: LegacyMigrationResult = { eligible: 0, conflicts: 0, excluded: 0, imported: 0, alreadyImported: 0 }
      const eligible: LegacyMigrationRecord[] = []
      for (const record of records) {
        if (record.excluded || !record.ticket || !record.legacyId) { result.excluded += 1; continue }
        const link = this.ticketSourceLink('legacy-browser', record.legacyId)
        if (link) { result.eligible += 1; result.alreadyImported += 1; continue }
        if (this.getTicket(record.ticket.id)) { result.conflicts += 1; continue }
        result.eligible += 1
        eligible.push(record)
      }
      return { result, eligible }
    }
    if (!commit) return classify().result
    return this.transaction(() => {
      const { result, eligible } = classify()
      for (const record of eligible) {
        this.saveTicket(record.ticket!)
        this.linkTicketSource(record.ticket!.id, 'legacy-browser', record.legacyId, `legacy-browser://ticket/${encodeURIComponent(record.legacyId)}`)
        result.imported += 1
      }
      this.saveIdempotency(idempotencyKey, result, createdAt, 'legacy-ticket-migration')
      this.appendAudit({ timestamp: createdAt, action: 'legacy-ticket-migration', objectRefs: [idempotencyKey], result: `imported:${result.imported}` })
      return result
    })
  }

  linkTicketSource(ticketId: string, sourceId: string, externalId: string, provenanceRef: string): void {
    this.db.prepare('INSERT INTO ticket_source_links(ticket_id,source_id,external_id,provenance_ref) VALUES(?,?,?,?)')
      .run(ticketId, sourceId, externalId, provenanceRef)
  }

  ticketSourceLink(sourceId: string, externalId: string): { ticketId: string; provenanceRef: string } | undefined {
    const row = this.db.prepare('SELECT ticket_id,provenance_ref FROM ticket_source_links WHERE source_id=? AND external_id=?')
      .get(sourceId, externalId) as { ticket_id?: string; provenance_ref?: string } | undefined
    return row?.ticket_id ? { ticketId: row.ticket_id, provenanceRef: String(row.provenance_ref) } : undefined
  }

  ticketLinkForRecord(record: SourceRecord): { ticketId: string; provenanceRef: string } | undefined {
    const direct = this.ticketSourceLink(record.sourceId, record.externalId)
    if (direct || record.sourceId !== 'gmail-followups' || !record.provenanceRef.startsWith('gmail://')) return direct
    const [accountId, threadId] = record.provenanceRef.slice('gmail://'.length).split('/').map(decodeURIComponent)
    const row = this.db.prepare('SELECT ticket_id,provenance_ref FROM email_ticket_links WHERE account_id=? AND thread_id=?')
      .get(accountId, threadId) as { ticket_id?: string; provenance_ref?: string } | undefined
    return row?.ticket_id ? { ticketId: row.ticket_id, provenanceRef: String(row.provenance_ref) } : undefined
  }

  saveEmailThread(thread: StoredEmailThread): void {
    const snippet = [...thread.snippet].slice(0, 240).join('')
    this.db.prepare(`INSERT INTO email_threads(account_id,thread_id,latest_message_id,sender,subject,received_at,snippet,reason_codes_json,triage_state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,thread_id) DO UPDATE SET latest_message_id=excluded.latest_message_id,
      sender=excluded.sender,subject=excluded.subject,received_at=excluded.received_at,snippet=excluded.snippet,
      reason_codes_json=excluded.reason_codes_json,updated_at=excluded.updated_at`)
      .run(thread.accountId, thread.threadId, thread.latestMessageId, thread.sender, thread.subject, thread.receivedAt,
        snippet, safeJson(thread.reasonCodes), thread.triageState, thread.createdAt, thread.updatedAt)
  }

  migrateGmailAccountId(previousAccountId: string, accountId: string): void {
    if (previousAccountId === accountId) return
    this.transaction(() => {
      this.db.prepare(`INSERT INTO email_threads(account_id,thread_id,latest_message_id,sender,subject,received_at,snippet,reason_codes_json,triage_state,record_version,created_at,updated_at)
        SELECT ?,thread_id,latest_message_id,sender,subject,received_at,snippet,reason_codes_json,triage_state,record_version,created_at,updated_at
        FROM email_threads WHERE account_id=?`).run(accountId, previousAccountId)
      this.db.prepare(`INSERT INTO email_ticket_links(account_id,thread_id,ticket_id,provenance_ref,created_at)
        SELECT ?,thread_id,ticket_id,'gmail://' || ? || '/' || replace(thread_id, '/', '%2F'),created_at
        FROM email_ticket_links WHERE account_id=?`).run(accountId, encodeURIComponent(accountId), previousAccountId)
      const priorPrefix = `${previousAccountId}:`
      const nextPrefix = `${accountId}:`
      const priorProvenancePrefix = `gmail://${encodeURIComponent(previousAccountId)}/`
      const nextProvenancePrefix = `gmail://${encodeURIComponent(accountId)}/`
      this.db.prepare(`UPDATE source_records SET external_id=replace(external_id,?,?),provenance_ref=replace(provenance_ref,?,?)
        WHERE source_id='gmail-followups' AND external_id LIKE ?`).run(priorPrefix, nextPrefix, priorProvenancePrefix, nextProvenancePrefix, `${priorPrefix}%`)
      this.db.prepare(`UPDATE ticket_source_links SET external_id=replace(external_id,?,?),provenance_ref=replace(provenance_ref,?,?)
        WHERE source_id='gmail-followups' AND external_id LIKE ?`).run(priorPrefix, nextPrefix, priorProvenancePrefix, nextProvenancePrefix, `${priorPrefix}%`)
      this.db.prepare(`UPDATE reconciliation_items SET external_id=replace(external_id,?,?)
        WHERE source_id='gmail-followups' AND external_id LIKE ?`).run(priorPrefix, nextPrefix, `${priorPrefix}%`)
      const idempotencyRows = this.db.prepare("SELECT idempotency_key,result_json FROM idempotency_results WHERE action='gmail-ticket-association'").all() as Array<{ idempotency_key: string; result_json: string }>
      for (const row of idempotencyRows) {
        const result = JSON.parse(row.result_json) as GmailTicketAssociationDto
        if (result.accountId !== previousAccountId) continue
        const migrated = { ...result, accountId, gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(result.threadId)}` }
        this.db.prepare('UPDATE idempotency_results SET result_json=? WHERE idempotency_key=?').run(safeJson(migrated), row.idempotency_key)
      }
      this.db.prepare('DELETE FROM email_ticket_links WHERE account_id=?').run(previousAccountId)
      this.db.prepare('DELETE FROM email_threads WHERE account_id=?').run(previousAccountId)
    })
  }

  listEmailThreads(state?: StoredEmailThread['triageState']): GmailCandidateDto[] {
    const rows = this.db.prepare(`SELECT e.*, CASE WHEN l.ticket_id IS NULL THEN 0 ELSE 1 END AS linked
      FROM email_threads e LEFT JOIN email_ticket_links l ON l.account_id=e.account_id AND l.thread_id=e.thread_id
      ${state ? 'WHERE e.triage_state=?' : ''} ORDER BY e.received_at DESC`)
      .all(...(state ? [state] : [])) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      accountId: String(row.account_id),
      threadId: String(row.thread_id),
      latestMessageId: String(row.latest_message_id),
      sender: String(row.sender),
      subject: String(row.subject),
      receivedAt: String(row.received_at),
      snippet: String(row.snippet),
      reasonCodes: JSON.parse(String(row.reason_codes_json)) as GmailCandidateDto['reasonCodes'],
      state: (Number(row.linked) ? 'linked' : String(row.triage_state)) as GmailCandidateDto['state'],
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(String(row.thread_id))}`,
      recordVersion: Number(row.record_version),
    }))
  }

  saveGmailCheck(run: GmailCheckDto): void {
    const counts = { checkedThreads: run.checkedThreads, candidateThreads: run.candidateThreads, excludedThreads: run.excludedThreads }
    this.db.prepare(`INSERT INTO gmail_checks(id,started_at,finished_at,state,coverage_start,coverage_end,counts_json,failed_thread_ids_json,history_id,error_code)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at,state=excluded.state,
      counts_json=excluded.counts_json,failed_thread_ids_json=excluded.failed_thread_ids_json,history_id=excluded.history_id,error_code=excluded.error_code`)
      .run(run.id, run.startedAt, run.finishedAt ?? null, run.state, run.coverageStart, run.coverageEnd, safeJson(counts), safeJson(run.failedThreadIds), run.historyId ?? null, run.errorCode ?? null)
  }

  getGmailCheck(id: string): GmailCheckDto | undefined {
    const row = this.db.prepare('SELECT * FROM gmail_checks WHERE id=?').get(id) as Record<string, unknown> | undefined
    return row ? gmailCheckFromRow(row) : undefined
  }

  latestGmailCheck(): GmailCheckDto | undefined {
    const row = this.db.prepare('SELECT * FROM gmail_checks ORDER BY started_at DESC LIMIT 1').get() as Record<string, unknown> | undefined
    return row ? gmailCheckFromRow(row) : undefined
  }

  emailThreadState(accountId: string, threadId: string): { state?: StoredEmailThread['triageState']; linked: boolean } {
    const row = this.db.prepare(`SELECT e.triage_state,l.ticket_id FROM email_threads e
      LEFT JOIN email_ticket_links l ON l.account_id=e.account_id AND l.thread_id=e.thread_id
      WHERE e.account_id=? AND e.thread_id=?`).get(accountId, threadId) as Record<string, unknown> | undefined
    return { state: row?.triage_state as StoredEmailThread['triageState'] | undefined, linked: Boolean(row?.ticket_id) }
  }

  emailThreadReasonCodes(accountId: string, threadId: string): GmailCandidateDto['reasonCodes'] {
    const row = this.db.prepare('SELECT reason_codes_json FROM email_threads WHERE account_id=? AND thread_id=?')
      .get(accountId, threadId) as { reason_codes_json?: string } | undefined
    return row?.reason_codes_json ? JSON.parse(row.reason_codes_json) as GmailCandidateDto['reasonCodes'] : []
  }

  deleteUntrackedEmailThread(accountId: string, threadId: string): void {
    this.db.prepare(`DELETE FROM email_threads WHERE account_id=? AND thread_id=? AND triage_state='confirmed-untracked'
      AND NOT EXISTS (SELECT 1 FROM email_ticket_links l WHERE l.account_id=email_threads.account_id AND l.thread_id=email_threads.thread_id)`)
      .run(accountId, threadId)
  }

  cleanupSyntheticEmailExclusions(): number {
    const result = this.db.prepare(`DELETE FROM email_threads WHERE triage_state='confirmed-untracked'
      AND reason_codes_json NOT LIKE '%LATEST_FROM_OTHER%'
      AND NOT EXISTS (SELECT 1 FROM email_ticket_links l WHERE l.account_id=email_threads.account_id AND l.thread_id=email_threads.thread_id)`)
      .run()
    return Number(result.changes)
  }

  updateEmailThreadState(
    accountId: string,
    threadId: string,
    expectedVersion: number,
    state: StoredEmailThread['triageState'],
    updatedAt: string,
  ): GmailCandidateDto | undefined {
    const result = this.db.prepare(`UPDATE email_threads SET triage_state=?,record_version=record_version+1,updated_at=?
      WHERE account_id=? AND thread_id=? AND record_version=?`).run(state, updatedAt, accountId, threadId, expectedVersion)
    if (result.changes === 0) return undefined
    return this.listEmailThreads().find((thread) => thread.accountId === accountId && thread.threadId === threadId)
  }

  associateEmailThread(input: {
    accountId: string
    threadId: string
    expectedVersion: number
    idempotencyKey: string
    ticket: StoredTicket
    create: boolean
    createdAt: string
  }): GmailTicketAssociationDto {
    const existingResult = this.db.prepare('SELECT result_json FROM idempotency_results WHERE idempotency_key=?').get(input.idempotencyKey) as { result_json?: string } | undefined
    if (existingResult?.result_json) return JSON.parse(existingResult.result_json) as GmailTicketAssociationDto

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const repeated = this.db.prepare('SELECT result_json FROM idempotency_results WHERE idempotency_key=?').get(input.idempotencyKey) as { result_json?: string } | undefined
      if (repeated?.result_json) {
        this.db.exec('COMMIT')
        return JSON.parse(repeated.result_json) as GmailTicketAssociationDto
      }
      const existingLink = this.db.prepare('SELECT ticket_id,provenance_ref FROM email_ticket_links WHERE account_id=? AND thread_id=?').get(input.accountId, input.threadId) as { ticket_id?: string; provenance_ref?: string } | undefined
      if (existingLink?.ticket_id) {
        const result = associationResult(input, existingLink.ticket_id, false)
        this.saveIdempotency(input.idempotencyKey, result, input.createdAt)
        this.db.exec('COMMIT')
        return result
      }
      const email = this.db.prepare('SELECT record_version,triage_state FROM email_threads WHERE account_id=? AND thread_id=?').get(input.accountId, input.threadId) as { record_version?: number; triage_state?: string } | undefined
      if (!email || email.record_version !== input.expectedVersion || !['confirmed', 'confirmed-untracked'].includes(email.triage_state ?? '')) throw new Error('RECORD_CHANGED')
      if (input.create) {
        if (this.getTicket(input.ticket.id)) throw new Error('RECORD_CHANGED')
        this.saveTicket(input.ticket)
      } else if (!this.getTicket(input.ticket.id)) {
        throw new Error('TICKET_NOT_FOUND')
      }
      const provenanceRef = `gmail://${encodeURIComponent(input.accountId)}/${encodeURIComponent(input.threadId)}`
      this.linkEmailToTicket(input.accountId, input.threadId, input.ticket.id, provenanceRef, input.createdAt)
      this.db.prepare("UPDATE email_threads SET triage_state='linked',record_version=record_version+1,updated_at=? WHERE account_id=? AND thread_id=?")
        .run(input.createdAt, input.accountId, input.threadId)
      const result = associationResult(input, input.ticket.id, input.create)
      this.saveIdempotency(input.idempotencyKey, result, input.createdAt)
      this.db.exec('COMMIT')
      return result
    } catch (cause) {
      this.db.exec('ROLLBACK')
      throw cause
    }
  }

  private saveIdempotency(key: string, result: unknown, createdAt: string, action = 'gmail-ticket-association'): void {
    this.db.prepare('INSERT INTO idempotency_results(idempotency_key,action,result_json,created_at) VALUES(?,?,?,?)')
      .run(key, action, safeJson(result), createdAt)
  }

  linkEmailToTicket(accountId: string, threadId: string, ticketId: string, provenanceRef: string, createdAt: string): void {
    this.db.prepare('INSERT INTO email_ticket_links(account_id,thread_id,ticket_id,provenance_ref,created_at) VALUES(?,?,?,?,?)')
      .run(accountId, threadId, ticketId, provenanceRef, createdAt)
  }

  saveConfiguredSource(source: SourceDescriptor, config: Record<string, unknown>, attemptedAt?: string, successfulAt?: string): void {
    this.db.prepare(`INSERT INTO configured_sources(source_id,adapter_kind,adapter_version,enabled,policy,location_label,config_json,last_attempt_at,last_success_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET adapter_kind=excluded.adapter_kind,
      adapter_version=excluded.adapter_version,enabled=excluded.enabled,policy=excluded.policy,location_label=excluded.location_label,
      config_json=excluded.config_json,last_attempt_at=COALESCE(excluded.last_attempt_at,configured_sources.last_attempt_at),
      last_success_at=COALESCE(excluded.last_success_at,configured_sources.last_success_at)`)
      .run(source.id, source.id, source.adapterVersion, source.enabled ? 1 : 0, source.policy,
        source.locationLabel ?? null, safeJson(config), attemptedAt ?? null, successfulAt ?? null)
  }

  getConfiguredSource(sourceId: SourceDescriptor['id']): StoredConfiguredSource | undefined {
    const row = this.db.prepare('SELECT * FROM configured_sources WHERE source_id=?').get(sourceId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      descriptor: {
        id: sourceId,
        label: { 'findmnemo-tickets': 'FindMnemo tickets', 'gmail-followups': 'Gmail follow-ups', 'project-sdd': 'Project / SDD registry', 'agent-ledger': 'Registered agent ledger' }[sourceId],
        adapterVersion: String(row.adapter_version),
        enabled: Boolean(row.enabled),
        policy: String(row.policy) as SourceDescriptor['policy'],
        locationLabel: row.location_label ? String(row.location_label) : undefined,
      },
      config: JSON.parse(String(row.config_json)) as Record<string, unknown>,
      lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : undefined,
      lastSuccessAt: row.last_success_at ? String(row.last_success_at) : undefined,
    }
  }

  deleteConfiguredSource(sourceId: SourceDescriptor['id']): boolean {
    return this.db.prepare('DELETE FROM configured_sources WHERE source_id=?').run(sourceId).changes > 0
  }

  saveSourceRecord(record: SourceRecord): void {
    this.db.prepare(`INSERT INTO source_records(source_id,external_id,fingerprint,state,observed_at,provenance_ref,eligible_for_ticket,exclusion_reason)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET fingerprint=excluded.fingerprint,
      state=excluded.state,observed_at=excluded.observed_at,provenance_ref=excluded.provenance_ref,
      eligible_for_ticket=excluded.eligible_for_ticket,exclusion_reason=excluded.exclusion_reason`)
      .run(record.sourceId, record.externalId, record.fingerprint, record.state, record.observedAt, record.provenanceRef,
        record.eligibleForTicket ? 1 : 0, record.exclusionReason ?? null)
  }

  getSourceRecord(sourceId: SourceId, externalId: string): SourceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM source_records WHERE source_id=? AND external_id=?').get(sourceId, externalId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      sourceId, externalId, fingerprint: String(row.fingerprint), title: '', state: String(row.state),
      observedAt: String(row.observed_at), provenanceRef: String(row.provenance_ref), eligibleForTicket: Boolean(row.eligible_for_ticket),
      exclusionReason: row.exclusion_reason ? String(row.exclusion_reason) as SourceRecord['exclusionReason'] : undefined,
    }
  }

  startRun(id: string, requestedSourceIds: string[], initiatingSurface: string, startedAt: string): void {
    this.db.prepare(`INSERT INTO reconciliation_runs(id,started_at,state,requested_source_ids_json,initiating_surface)
      VALUES(?,?,'running',?,?)`).run(id, startedAt, safeJson(requestedSourceIds), initiatingSurface)
  }

  finishRun(id: string, state: ReconciliationRunState, counts: Record<string, number>, finishedAt: string): void {
    this.db.prepare('UPDATE reconciliation_runs SET state=?,counts_json=?,finished_at=? WHERE id=?')
      .run(state, safeJson(counts), finishedAt, id)
  }

  saveRunSource(runId: string, source: ReconciliationSourceResultDto): void {
    const counts = { checked: source.checked, added: source.added, updated: source.updated, unchanged: source.unchanged, excluded: source.excluded, duplicate: source.duplicate, unresolved: source.unresolved, reasonCode: source.reasonCode }
    this.db.prepare(`INSERT INTO reconciliation_sources(run_id,source_id,state,counts_json,error_code) VALUES(?,?,?,?,?)
      ON CONFLICT(run_id,source_id) DO UPDATE SET state=excluded.state,counts_json=excluded.counts_json,error_code=excluded.error_code`)
      .run(runId, source.sourceId, source.state, safeJson(counts), source.errorCode ?? null)
  }

  saveRunItem(runId: string, item: ReconciliationItemResultDto): void {
    this.db.prepare(`INSERT INTO reconciliation_items(run_id,source_id,external_id,classification,ticket_id,reason_code,error_code) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(run_id,source_id,external_id) DO UPDATE SET classification=excluded.classification,ticket_id=excluded.ticket_id,reason_code=excluded.reason_code,error_code=excluded.error_code`)
      .run(runId, item.sourceId, item.externalId, item.classification, item.ticketId ?? null, item.reasonCode ?? null, item.errorCode ?? null)
  }

  getRun(id: string): ReconciliationRunDto | undefined {
    const run = this.db.prepare('SELECT * FROM reconciliation_runs WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!run) return undefined
    const sources = this.db.prepare('SELECT * FROM reconciliation_sources WHERE run_id=? ORDER BY source_id').all(id) as Array<Record<string, unknown>>
    const items = this.db.prepare('SELECT * FROM reconciliation_items WHERE run_id=? ORDER BY source_id,external_id').all(id) as Array<Record<string, unknown>>
    return {
      id, state: String(run.state) as ReconciliationRunState,
      requestedSourceIds: JSON.parse(String(run.requested_source_ids_json)) as SourceId[],
      sources: sources.map(runSourceFromRow), items: items.map(runItemFromRow),
      startedAt: String(run.started_at), finishedAt: run.finished_at ? String(run.finished_at) : undefined,
    }
  }

  listRuns(limit = 20): ReconciliationRunDto[] {
    const rows = this.db.prepare('SELECT id FROM reconciliation_runs ORDER BY started_at DESC LIMIT ?').all(Math.max(1, Math.min(limit, 100))) as Array<{ id: string }>
    return rows.map((row) => this.getRun(row.id)).filter((run): run is ReconciliationRunDto => Boolean(run))
  }

  appendAudit(event: AuditEventInput): string {
    assertPrivateBoundary(event)
    const id = event.id ?? randomUUID()
    this.db.prepare('INSERT INTO audit_events(id,timestamp,action,reason_code,object_refs_json,result) VALUES(?,?,?,?,?,?)')
      .run(id, event.timestamp, event.action, event.reasonCode ?? null, safeJson(event.objectRefs), event.result)
    return id
  }
}

function runSourceFromRow(row: Record<string, unknown>): ReconciliationSourceResultDto {
  const counts = JSON.parse(String(row.counts_json)) as Record<string, unknown>
  return {
    sourceId: String(row.source_id) as SourceId, state: String(row.state) as ReconciliationSourceResultDto['state'],
    checked: Number(counts.checked ?? 0), added: Number(counts.added ?? 0), updated: Number(counts.updated ?? 0), unchanged: Number(counts.unchanged ?? 0),
    excluded: Number(counts.excluded ?? 0), duplicate: Number(counts.duplicate ?? 0), unresolved: Number(counts.unresolved ?? 0),
    reasonCode: counts.reasonCode ? String(counts.reasonCode) as ReconciliationSourceResultDto['reasonCode'] : undefined,
    errorCode: row.error_code ? String(row.error_code) as ReconciliationSourceResultDto['errorCode'] : undefined,
  }
}

function gmailCheckFromRow(row: Record<string, unknown>): GmailCheckDto {
  const counts = JSON.parse(String(row.counts_json)) as Record<string, number>
  return {
    id: String(row.id), state: String(row.state) as GmailCheckDto['state'], startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined, coverageStart: String(row.coverage_start), coverageEnd: String(row.coverage_end),
    checkedThreads: Number(counts.checkedThreads ?? 0), candidateThreads: Number(counts.candidateThreads ?? 0), excludedThreads: Number(counts.excludedThreads ?? 0),
    failedThreadIds: JSON.parse(String(row.failed_thread_ids_json)) as string[], historyId: row.history_id ? String(row.history_id) : undefined,
    errorCode: row.error_code ? String(row.error_code) as GmailCheckDto['errorCode'] : undefined,
  }
}

function runItemFromRow(row: Record<string, unknown>): ReconciliationItemResultDto {
  return {
    sourceId: String(row.source_id) as SourceId, externalId: String(row.external_id), classification: String(row.classification) as ReconciliationItemResultDto['classification'],
    ticketId: row.ticket_id ? String(row.ticket_id) : undefined,
    reasonCode: row.reason_code ? String(row.reason_code) as ReconciliationItemResultDto['reasonCode'] : undefined,
    errorCode: row.error_code ? String(row.error_code) as ReconciliationItemResultDto['errorCode'] : undefined,
  }
}

function associationResult(
  input: { accountId: string; threadId: string; idempotencyKey: string },
  ticketId: string,
  created: boolean,
): GmailTicketAssociationDto {
  return {
    accountId: input.accountId,
    threadId: input.threadId,
    ticketId,
    gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(input.threadId)}`,
    created,
    idempotencyKey: input.idempotencyKey,
  }
}
