import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPANION_CONNECTED_BEFORE_KEY,
  CompanionUnreachableError,
  classifyConnectionFailure,
  createUnreachableError,
  describeCompanionFailure,
  forgetCompanionConnected,
  hasConnectedBefore,
  markCompanionConnected,
} from './lib/companion-connection'
import { listCompanionTickets } from './lib/companion-client'

describe('companion connection classification', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats an unreachable companion as not-installed only before a first successful connection', () => {
    const failure = classifyConnectionFailure(new TypeError('Failed to fetch'))
    expect(failure.state).toBe('not-installed')
    expect(failure.code).toBe('COMPANION_UNREACHABLE')
    expect(failure.message).not.toMatch(/failed to fetch/i)
    expect(failure.message).toContain('127.0.0.1:3210')
  })

  it('makes the stopped state reachable once this browser has connected before', () => {
    markCompanionConnected()
    expect(hasConnectedBefore()).toBe(true)
    expect(window.localStorage.getItem(COMPANION_CONNECTED_BEFORE_KEY)).toBe('true')

    const failure = classifyConnectionFailure(new TypeError('Failed to fetch'))
    expect(failure.state).toBe('stopped')
    expect(failure.message).toMatch(/installed but nothing is answering/i)

    forgetCompanionConnected()
    expect(classifyConnectionFailure(new TypeError('Failed to fetch')).state).toBe('not-installed')
  })

  it('classifies an aborted probe as a timed-out reach, not a generic error', () => {
    const abort = new Error('The operation was aborted.')
    abort.name = 'AbortError'
    const error = createUnreachableError(abort)
    expect(error).toBeInstanceOf(CompanionUnreachableError)
    expect(error.code).toBe('COMPANION_PROBE_TIMEOUT')
    expect(classifyConnectionFailure(error).state).toBe('not-installed')
  })

  it('keeps non-transport failures on their own diagnoses', () => {
    expect(classifyConnectionFailure(new Error('PAIRING_CODE_INVALID')).state).toBe('pairing-required')
    expect(classifyConnectionFailure(new Error('ORIGIN_NOT_ALLOWED')).state).toBe('permission-denied')
    expect(classifyConnectionFailure(new Error('SESSION_INVALID')).state).toBe('error')
  })

  it('keeps call-site copy for ordinary failures and replaces raw transport noise', () => {
    expect(describeCompanionFailure(new Error('SOURCE_UNAVAILABLE'), 'fallback')).toBe('SOURCE_UNAVAILABLE')
    expect(describeCompanionFailure({}, 'fallback')).toBe('fallback')
    expect(describeCompanionFailure(new TypeError('Failed to fetch'), 'fallback')).toContain('127.0.0.1:3210')
  })

  it('classifies post-connection requests, not only the initial connect', async () => {
    markCompanionConnected()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(listCompanionTickets({ token: 't', browserNonce: 'n', expiresAt: new Date().toISOString() }))
      .rejects.toThrow(/installed but nothing is answering/i)
  })
})
