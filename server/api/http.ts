import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import {
  COMPANION_PROTOCOL_VERSION,
  type CompanionApiError,
  type CompanionApiResponse,
} from '../../shared/companion-contract.js'

export function sendJson<T>(response: ServerResponse, status: number, data: T): void {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

export function apiSuccess<T>(data: T): CompanionApiResponse<T> {
  return {
    data,
    error: null,
    meta: { protocolVersion: COMPANION_PROTOCOL_VERSION, requestId: randomUUID() },
  }
}

export function apiFailure(error: CompanionApiError): CompanionApiResponse<never> {
  return {
    data: null,
    error,
    meta: { protocolVersion: COMPANION_PROTOCOL_VERSION, requestId: randomUUID() },
  }
}
