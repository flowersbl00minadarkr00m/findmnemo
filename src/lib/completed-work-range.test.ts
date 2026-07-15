import { describe, expect, it } from 'vitest'
import { resolveCompletedRange } from './completed-work-range'

describe('resolveCompletedRange', () => {
  it('resolves presets as inclusive local calendar days', () => {
    expect(resolveCompletedRange({ kind: 'preset', value: '7d' }, { now: new Date('2026-07-14T18:00:00Z'), timeZone: 'America/Vancouver' })).toEqual({ startDate: '2026-07-08', endDate: '2026-07-14', query: { startInclusive: '2026-07-08T07:00:00.000Z', endExclusive: '2026-07-15T07:00:00.000Z', timeZone: 'America/Vancouver' } })
  })
  it('uses exact DST boundaries for custom ranges', () => {
    const spring = resolveCompletedRange({ kind: 'custom', startDate: '2026-03-08', endDate: '2026-03-08', timeZone: 'America/New_York' })
    expect(spring.query).toMatchObject({ startInclusive: '2026-03-08T05:00:00.000Z', endExclusive: '2026-03-09T04:00:00.000Z' })
    const fall = resolveCompletedRange({ kind: 'custom', startDate: '2026-11-01', endDate: '2026-11-01', timeZone: 'America/New_York' })
    expect(fall.query).toMatchObject({ startInclusive: '2026-11-01T04:00:00.000Z', endExclusive: '2026-11-02T05:00:00.000Z' })
  })
  it('clamps twelve-month leap-day ranges and rejects invalid input', () => {
    expect(resolveCompletedRange({ kind: 'preset', value: '12mo' }, { now: new Date('2024-02-29T18:00:00Z'), timeZone: 'UTC' }).startDate).toBe('2023-02-28')
    expect(() => resolveCompletedRange({ kind: 'custom', startDate: '2026-02-30', endDate: '2026-03-01', timeZone: 'UTC' })).toThrow('COMPLETED_RANGE_INVALID')
  })
})
