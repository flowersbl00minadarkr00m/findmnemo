import type { IncomingMessage, ServerResponse } from 'node:http'

export const MAX_JSON_BODY_BYTES = 64 * 1024
export const PRODUCTION_ORIGIN = 'https://findmnemo.vercel.app'
export const LEGACY_PRODUCTION_ORIGIN = 'https://mnemosync.vercel.app'

export interface RequestSecurityOptions {
  allowedOrigins?: readonly string[]
  allowDevelopmentOrigins?: boolean
}

export function allowedOrigin(request: IncomingMessage, options: RequestSecurityOptions = {}): string | undefined {
  const origin = request.headers.origin
  if (!origin) {
    const host = request.headers.host
    if (host && /^127\.0\.0\.1:\d+$/.test(host) && request.headers['sec-fetch-site'] === 'same-origin') {
      return `http://${host}`
    }
    return undefined
  }
  const allowed = new Set([PRODUCTION_ORIGIN, LEGACY_PRODUCTION_ORIGIN, ...(options.allowedOrigins ?? [])])
  if (options.allowDevelopmentOrigins && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return origin
  const host = request.headers.host
  if (host && origin === `http://${host}` && /^127\.0\.0\.1:\d+$/.test(host)) return origin
  return allowed.has(origin) ? origin : undefined
}

export function applyCors(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-FindMnemo-Protocol-Version, X-FindMnemo-Browser-Nonce, X-FindMnemo-Routing-Token')
}

export function validLoopbackHost(request: IncomingMessage): boolean {
  return /^127\.0\.0\.1:\d+$/.test(request.headers.host ?? '')
}

export function validFetchMetadata(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'same-site' || site === 'cross-site'
}

export async function readJsonBody(request: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<Record<string, unknown>> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new Error('JSON_CONTENT_TYPE_REQUIRED')
  }
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('REQUEST_TOO_LARGE')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(buffer)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('JSON_OBJECT_REQUIRED')
  return parsed as Record<string, unknown>
}

export function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined
}
