import { createHash, randomUUID } from 'node:crypto'
import type { GmailCheckDto } from '../../shared/companion-contract.js'
import type { OperationalRepository } from '../db/operational-repository.js'
import { classifyGmailThread } from './candidate-classifier.js'
import { GmailApiError, type GmailMetadataClient } from './gmail-client.js'

const GMAIL_SOURCE = { id: 'gmail-followups', label: 'Gmail follow-ups', adapterVersion: '1.0.0', enabled: true, policy: 'review' } as const

export class GmailCheckService {
  private readonly runs = new Map<string, GmailCheckDto>()
  private readonly client: GmailMetadataClient
  private readonly repository: OperationalRepository
  private readonly clock: () => Date
  private readonly lookbackDays: number
  private readonly maxPages: number
  private readonly maxConcurrency: number
  private readonly threadTimeoutMs: number

  constructor(
    client: GmailMetadataClient,
    repository: OperationalRepository,
    clock: () => Date = () => new Date(),
    lookbackDays = 5,
    maxPages = 20,
    maxConcurrency = 4,
    threadTimeoutMs = 8_000,
  ) {
    this.client = client
    this.repository = repository
    this.clock = clock
    this.lookbackDays = lookbackDays
    this.maxPages = maxPages
    this.maxConcurrency = Math.max(1, Math.min(maxConcurrency, 8))
    this.threadTimeoutMs = threadTimeoutMs
    this.repository.cleanupSyntheticEmailExclusions()
  }

  start(): GmailCheckDto {
    const now = this.clock()
    const run: GmailCheckDto = {
      id: randomUUID(), state: 'running', startedAt: now.toISOString(),
      coverageStart: new Date(now.getTime() - this.lookbackDays * 86_400_000).toISOString(),
      coverageEnd: now.toISOString(), checkedThreads: 0, candidateThreads: 0,
      excludedThreads: 0, failedThreadIds: [],
    }
    this.runs.set(run.id, run)
    this.repository.saveGmailCheck(run)
    void this.execute(run)
    return { ...run }
  }

  get(id: string): GmailCheckDto | undefined { const run = this.runs.get(id) ?? this.repository.getGmailCheck(id); return run ? { ...run, failedThreadIds: [...run.failedThreadIds] } : undefined }
  candidates() { return this.repository.listEmailThreads('candidate') }
  records() { return this.repository.listEmailThreads() }
  status() {
    const source = this.repository.getConfiguredSource('gmail-followups')
    const latest = [...this.runs.values()].at(-1) ?? this.repository.latestGmailCheck()
    return {
      lastAttemptAt: source?.lastAttemptAt,
      lastSuccessAt: source?.lastSuccessAt,
      coverageStart: latest?.coverageStart,
      coverageEnd: latest?.coverageEnd,
      state: latest?.state ?? 'not-checked',
      errorCode: latest?.errorCode,
    }
  }

  private async execute(run: GmailCheckDto): Promise<void> {
    const previous = this.repository.getConfiguredSource('gmail-followups')
    this.repository.saveConfiguredSource(GMAIL_SOURCE, previous?.config ?? {}, run.startedAt)
    try {
      const profile = await this.client.profile()
      const accountId = gmailAccountId(profile.emailAddress)
      this.repository.migrateGmailAccountId(profile.emailAddress, accountId)
      const configuredAliases = Array.isArray(previous?.config.aliases)
        ? previous.config.aliases.filter((value): value is string => typeof value === 'string')
        : []
      const aliases = [profile.emailAddress, ...configuredAliases]
      const seenThreadIds = new Set<string>()
      let historyReset = false
      let paginationTruncated = false
      const previousHistoryId = typeof previous?.config.historyId === 'string' ? previous.config.historyId : undefined
      const processThreadIds = async (threadIds: string[]): Promise<boolean> => {
        const uniqueThreadIds = threadIds.filter((threadId) => {
          if (seenThreadIds.has(threadId)) return false
          seenThreadIds.add(threadId)
          return true
        })
        let nextIndex = 0
        let crossedLookbackBoundary = false
        const worker = async () => {
          while (nextIndex < uniqueThreadIds.length) {
            const threadId = uniqueThreadIds[nextIndex++]
            try {
              const thread = await retryWithBackoff(() => withTimeout((signal) => this.client.getThread(threadId, signal), this.threadTimeoutMs), 2)
              const prior = this.repository.emailThreadState(accountId, threadId)
              const priorReasonCodes = this.repository.emailThreadReasonCodes(accountId, threadId)
              const result = classifyGmailThread(thread, aliases, prior)
              const latest = result.latestMessage
              if (!latest) continue
              if (result.receivedAt < run.coverageStart) {
                crossedLookbackBoundary = true
                continue
              }
              const syntheticExclusion = !result.eligible
                && prior.state === 'confirmed-untracked'
                && !priorReasonCodes.includes('LATEST_FROM_OTHER')
              if (syntheticExclusion) this.repository.deleteUntrackedEmailThread(accountId, threadId)
              if (!result.eligible && (!prior.state || syntheticExclusion) && !prior.linked) {
                run.checkedThreads++
                run.excludedThreads++
                this.repository.saveGmailCheck(run)
                continue
              }
              this.repository.saveEmailThread({
                accountId, threadId, latestMessageId: latest.id,
                sender: result.sender, subject: result.subject, receivedAt: result.receivedAt,
                snippet: result.snippet, reasonCodes: result.reasonCodes,
                triageState: prior.linked ? 'linked' : (prior.state ?? 'candidate'),
                createdAt: run.startedAt, updatedAt: this.clock().toISOString(),
              })
              run.checkedThreads++
              if (result.eligible) run.candidateThreads++
              else run.excludedThreads++
              this.repository.saveGmailCheck(run)
            } catch {
              run.failedThreadIds.push(threadId)
              this.repository.saveGmailCheck(run)
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(this.maxConcurrency, Math.max(uniqueThreadIds.length, 1)) }, worker))
        return crossedLookbackBoundary
      }
      if (previousHistoryId) {
        try {
          const history = await this.client.historyThreadIds(previousHistoryId, this.maxPages)
          await processThreadIds(history.threadIds)
          paginationTruncated = history.truncated
        } catch (cause) {
          if (!(cause instanceof GmailApiError) || cause.status !== 404) throw cause
          historyReset = true
        }
      }

      if (!previousHistoryId || historyReset) {
        let pageToken: string | undefined
        let pages = 0
        do {
          if (++pages > this.maxPages) {
            paginationTruncated = true
            break
          }
          const page = await this.client.listInbox(pageToken)
          const crossedLookbackBoundary = await processThreadIds(page.threads.map((thread) => thread.id))
          pageToken = page.nextPageToken
          if (crossedLookbackBoundary) break
        } while (pageToken)
      }

      if (!paginationTruncated && run.failedThreadIds.length === 0) run.historyId = profile.historyId
      run.finishedAt = this.clock().toISOString()
      run.state = run.failedThreadIds.length || historyReset || paginationTruncated ? 'partial' : 'complete'
      if (paginationTruncated) run.errorCode = 'GMAIL_PAGINATION_TIMEOUT'
      else if (historyReset) run.errorCode = 'GMAIL_HISTORY_INVALID'
      const config = { historyId: run.historyId ?? previousHistoryId, lookbackDays: this.lookbackDays, aliases: configuredAliases }
      this.repository.saveConfiguredSource(GMAIL_SOURCE, config, run.startedAt, run.state === 'complete' ? run.finishedAt : undefined)
      this.repository.saveGmailCheck(run)
    } catch (cause) {
      run.finishedAt = this.clock().toISOString()
      run.state = 'failed'
      const message = cause instanceof Error ? cause.message : ''
      run.errorCode = message === 'GMAIL_TOKEN_REVOKED' || message === 'GMAIL_REFRESH_FAILED'
        ? message : message === 'GMAIL_PAGINATION_TIMEOUT' ? 'GMAIL_PAGINATION_TIMEOUT' : 'SOURCE_CHECK_FAILED'
      this.repository.saveGmailCheck(run)
    }
  }
}

export function gmailAccountId(emailAddress: string): string {
  const normalized = emailAddress.trim().toLowerCase().normalize('NFKC')
  return `gmail-${createHash('sha256').update(normalized).digest('base64url')}`
}

async function retryWithBackoff<T>(work: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await work() } catch (cause) {
      lastError = cause
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt))
    }
  }
  throw lastError
}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('GMAIL_THREAD_TIMEOUT'))
    }, timeoutMs)
    void work(controller.signal).then(
      (value) => { clearTimeout(timeout); resolve(value) },
      (cause) => { clearTimeout(timeout); reject(cause) },
    )
  })
}
