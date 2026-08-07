import type { CompanionConnectionState } from '../../shared/companion-contract'

export const COMPANION_ORIGIN = '127.0.0.1:3210'
export const COMPANION_CONNECTED_BEFORE_KEY = 'findmnemo.companion.connected-before.v1'
export const COMPANION_PROBE_TIMEOUT_MS = 3_000

/**
 * Raised whenever the browser could not reach the local companion at all
 * (connection refused, aborted probe, DNS/proxy failure). The message is
 * user-facing on purpose: every call site that surfaces `error.message`
 * then shows a specific diagnosis instead of a raw `Failed to fetch`.
 */
export class CompanionUnreachableError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CompanionUnreachableError'
    this.code = code
  }
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** True once a companion session has been verified at least once in this browser. */
export function hasConnectedBefore(): boolean {
  try {
    return storage()?.getItem(COMPANION_CONNECTED_BEFORE_KEY) === 'true'
  } catch {
    return false
  }
}

export function markCompanionConnected(): void {
  try {
    storage()?.setItem(COMPANION_CONNECTED_BEFORE_KEY, 'true')
  } catch {
    /* private-mode or blocked storage only costs us the stopped/not-installed distinction */
  }
}

export function forgetCompanionConnected(): void {
  try {
    storage()?.removeItem(COMPANION_CONNECTED_BEFORE_KEY)
  } catch {
    /* ignore */
  }
}

/** Reads `name`/`message` without `instanceof Error`, because `DOMException` is not always one. */
function errorField(cause: unknown, field: 'name' | 'message'): string {
  const value = (cause as { name?: unknown; message?: unknown } | null | undefined)?.[field]
  return typeof value === 'string' ? value : ''
}

export function isAbortCause(cause: unknown): boolean {
  const name = errorField(cause, 'name')
  return name === 'AbortError' || name === 'TimeoutError'
}

export function isUnreachableCause(cause: unknown): boolean {
  if (cause instanceof CompanionUnreachableError) return true
  const message = errorField(cause, 'message')
  const name = errorField(cause, 'name')
  return cause instanceof TypeError
    || name === 'AbortError'
    || name === 'TimeoutError'
    || /failed to fetch|networkerror|network error|load failed|aborted|timeout|connection refused|econnrefused/i.test(message)
}

export interface ClassifiedConnectionFailure {
  state: CompanionConnectionState
  /** Stable diagnostic code, shown to the user as `Diagnostic code: …`. */
  code: string
  /** User-facing sentence describing the failure and the next step. */
  message: string
}

export interface ClassifyOptions {
  /** Override the persisted "has connected before" evidence (tests, callers with fresher evidence). */
  connectedBefore?: boolean
}

const STOPPED_MESSAGE = `FindMnemo is installed but nothing is answering on ${COMPANION_ORIGIN}. Open FindMnemo on this computer and start the companion, then retry.`
const NOT_INSTALLED_MESSAGE = `FindMnemo could not reach a local companion on ${COMPANION_ORIGIN}. Install or open FindMnemo on this computer, then retry.`

/**
 * Single classifier for every companion failure — initial connect and every
 * post-connection request. An unreachable companion resolves to `stopped`
 * rather than `not-installed` once this browser has completed a connection,
 * because a stopped companion cannot send a `COMPANION_STOPPED` signal.
 */
export function unreachableMessage(connectedBefore = hasConnectedBefore()): string {
  return connectedBefore ? STOPPED_MESSAGE : NOT_INSTALLED_MESSAGE
}

/** Normalizes any transport-level failure into a classified, user-readable error. */
export function createUnreachableError(cause: unknown): CompanionUnreachableError {
  const aborted = isAbortCause(cause)
  const code = aborted ? 'COMPANION_PROBE_TIMEOUT' : 'COMPANION_UNREACHABLE'
  const suffix = aborted ? ` FindMnemo stopped waiting after ${Math.round(COMPANION_PROBE_TIMEOUT_MS / 1000)} seconds.` : ''
  return new CompanionUnreachableError(code, `${unreachableMessage()}${suffix}`)
}

export function classifyConnectionFailure(cause: unknown, options: ClassifyOptions = {}): ClassifiedConnectionFailure {
  const message = errorField(cause, 'message') || 'CONNECTION_ERROR'
  if (cause instanceof CompanionUnreachableError) {
    const connectedBefore = options.connectedBefore ?? hasConnectedBefore()
    return {
      state: connectedBefore ? 'stopped' : 'not-installed',
      code: cause.code,
      message: cause.message || unreachableMessage(connectedBefore),
    }
  }
  if (isUnreachableCause(cause)) {
    const connectedBefore = options.connectedBefore ?? hasConnectedBefore()
    return {
      state: connectedBefore ? 'stopped' : 'not-installed',
      code: 'COMPANION_UNREACHABLE',
      message: unreachableMessage(connectedBefore),
    }
  }
  if (message === 'COMPANION_STOPPED') return { state: 'stopped', code: message, message: STOPPED_MESSAGE }
  if (message.startsWith('PAIRING_')) {
    return { state: 'pairing-required', code: message, message: 'This pairing code is no longer valid. Enter the current one-time code shown in the installed FindMnemo window.' }
  }
  if (message === 'ORIGIN_NOT_ALLOWED') {
    return { state: 'permission-denied', code: message, message: 'The companion refused this page origin. Reset the site permission in your browser or use the local fallback.' }
  }
  return { state: 'error', code: message, message }
}

/**
 * Message helper for post-connection call sites: keeps their own copy for
 * ordinary API failures, but replaces raw transport noise with a specific
 * connectivity diagnosis.
 */
export function describeCompanionFailure(cause: unknown, fallback: string): string {
  if (isUnreachableCause(cause)) return classifyConnectionFailure(cause).message
  return errorField(cause, 'message') || fallback
}
