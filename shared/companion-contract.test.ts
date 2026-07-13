import { describe, expect, it } from 'vitest'
import {
  COMPANION_PROTOCOL_VERSION,
  assertCompanionProtocolVersion,
  assertReconciliationRunState,
  assertSourceState,
  isCompanionProtocolVersion,
  isReconciliationRunState,
  isSourceState,
} from './companion-contract.js'
import { FakeSourceAdapter } from './test/fakes.js'

describe('companion contract', () => {
  it('runs contract checks in the Node environment', () => {
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
  })

  it('accepts only the declared protocol version', () => {
    expect(isCompanionProtocolVersion(COMPANION_PROTOCOL_VERSION)).toBe(true)
    expect(isCompanionProtocolVersion('2.0.0')).toBe(false)
    expect(() => assertCompanionProtocolVersion('2.0.0')).toThrow(
      'Unsupported companion protocol version',
    )
  })

  it('rejects unknown source states', () => {
    expect(isSourceState('checked')).toBe(true)
    expect(isSourceState('live')).toBe(false)
    expect(() => assertSourceState('live')).toThrow('Invalid reconciliation source state')
  })

  it('rejects unknown reconciliation run states', () => {
    expect(isReconciliationRunState('partial')).toBe(true)
    expect(isReconciliationRunState('successful')).toBe(false)
    expect(() => assertReconciliationRunState('successful')).toThrow(
      'Invalid reconciliation run state',
    )
  })

  it('provides deterministic fake adapters for later Node tests', async () => {
    const adapter = new FakeSourceAdapter([{ records: [], complete: true }])
    const context = { runId: 'run-1', signal: new AbortController().signal }

    const batches = []
    for await (const batch of adapter.check(context)) batches.push(batch)

    expect(batches).toEqual([{ records: [], complete: true }])
    expect(adapter.contexts).toEqual([context])
  })
})
