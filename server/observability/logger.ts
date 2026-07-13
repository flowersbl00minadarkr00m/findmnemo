import { existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SOURCE_IDS, type SourceId } from '../../shared/companion-contract.js'

const MAX_LOG_BYTES = 512 * 1024
const ALLOWED_CODES = /^[A-Z][A-Z0-9_]{1,63}$/

export interface SafeLogEvent {
  timestamp?: string
  level: 'info' | 'warn' | 'error'
  code: string
  route?: string
  status?: number
  durationMs?: number
  sourceId?: SourceId
  runId?: string
  count?: number
}

export class SafeLogger {
  private readonly filePath: string
  private readonly maxBytes: number
  private pending: Promise<void> = Promise.resolve()
  constructor(filePath: string, options: { maxBytes?: number } = {}) {
    this.filePath = filePath
    this.maxBytes = Math.max(256, options.maxBytes ?? MAX_LOG_BYTES)
  }

  async write(input: SafeLogEvent): Promise<void> {
    const event = normalize(input)
    const operation = this.pending.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      this.rotate()
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8')
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }

  async preview(limit = 200): Promise<SafeLogEvent[]> {
    await this.pending
    try {
      const lines = (await readFile(this.filePath, 'utf8')).split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(limit, 500)))
      return lines.flatMap((line) => { try { return [normalize(JSON.parse(line) as SafeLogEvent)] } catch { return [] } })
    } catch { return [] }
  }

  async drain(): Promise<void> {
    await this.pending
  }

  private rotate(): void {
    if (!existsSync(this.filePath) || statSync(this.filePath).size < this.maxBytes) return
    if (existsSync(`${this.filePath}.3`)) rmSync(`${this.filePath}.3`)
    if (existsSync(`${this.filePath}.2`)) renameSync(`${this.filePath}.2`, `${this.filePath}.3`)
    if (existsSync(`${this.filePath}.1`)) renameSync(`${this.filePath}.1`, `${this.filePath}.2`)
    renameSync(this.filePath, `${this.filePath}.1`)
  }
}

function normalize(input: SafeLogEvent): SafeLogEvent {
  const code = ALLOWED_CODES.test(String(input.code)) ? String(input.code) : 'REDACTED_CODE'
  return {
    timestamp: typeof input.timestamp === 'string' ? input.timestamp : new Date().toISOString(),
    level: input.level === 'warn' || input.level === 'error' ? input.level : 'info', code,
    ...(typeof input.route === 'string' ? { route: redactRoute(input.route) } : {}),
    ...(Number.isFinite(input.status) ? { status: Number(input.status) } : {}),
    ...(Number.isFinite(input.durationMs) ? { durationMs: Math.max(0, Number(input.durationMs)) } : {}),
    ...(input.sourceId && SOURCE_IDS.includes(input.sourceId) ? { sourceId: input.sourceId } : {}),
    ...(typeof input.runId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(input.runId) ? { runId: input.runId } : {}),
    ...(Number.isFinite(input.count) ? { count: Math.max(0, Number(input.count)) } : {}),
  }
}

const STATIC_ROUTES = new Set([
  '/api/v1/identity', '/api/v1/local-session', '/api/v1/status', '/api/v1/diagnostics', '/api/v1/diagnostics/export',
  '/api/v1/pairing/session', '/api/v1/pairing/rotate', '/api/v1/sources', '/api/v1/reconciliation-runs',
  '/api/v1/gmail/status', '/api/v1/gmail/connect', '/api/v1/gmail/connection', '/api/v1/gmail/checks',
  '/api/v1/email/candidates', '/api/v1/tickets', '/api/v1/migration/legacy-tickets/preview', '/api/v1/migration/legacy-tickets/commit',
])

export function redactRoute(route: string): string {
  const path = route.slice(0, 240).replace(/[?#].*$/, '')
  if (STATIC_ROUTES.has(path)) return path
  if (/^\/api\/v1\/sources\/[^/]+$/.test(path)) return '/api/v1/sources/:sourceId'
  if (/^\/api\/v1\/reconciliation-runs\/[^/]+\/retry$/.test(path)) return '/api/v1/reconciliation-runs/:runId/retry'
  if (/^\/api\/v1\/reconciliation-runs\/[^/]+$/.test(path)) return '/api/v1/reconciliation-runs/:runId'
  if (/^\/api\/v1\/gmail\/checks\/[^/]+$/.test(path)) return '/api/v1/gmail/checks/:runId'
  if (/^\/api\/v1\/email\/candidates\/[^/]+\/decision$/.test(path)) return '/api/v1/email/candidates/:threadId/decision'
  if (/^\/api\/v1\/email\/candidates\/[^/]+\/ticket$/.test(path)) return '/api/v1/email/candidates/:threadId/ticket'
  if (/^\/api\/v1\/tickets\/[^/]+$/.test(path)) return '/api/v1/tickets/:ticketId'
  return path.startsWith('/api/v1/') ? '/api/v1/:unrecognized' : '/:non-api'
}
