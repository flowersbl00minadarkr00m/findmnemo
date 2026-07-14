import { describe, expect, it } from 'vitest'
import { HOME_VIEW_PREFERENCE_KEY, METRICS_VIEW_PREFERENCE_KEY, loadHomeViewPreference, loadMetricsViewPreference, saveHomeViewPreference, saveMetricsViewPreference } from './view-preference'

class FakeStorage {
  values = new Map<string, string>()
  reads: string[] = []
  writes: Array<[string, string]> = []
  getItem(key: string) { this.reads.push(key); return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.writes.push([key, value]); this.values.set(key, value) }
}

describe('operational home-view preference', () => {
  it('accepts only operations or brief and stores no other state', () => {
    const storage = new FakeStorage()
    expect(saveHomeViewPreference(storage, 'brief')).toBe(true)
    expect(storage.writes).toEqual([[HOME_VIEW_PREFERENCE_KEY, 'brief']])
    expect(loadHomeViewPreference(storage)).toBe('brief')

    storage.values.set(HOME_VIEW_PREFERENCE_KEY, JSON.stringify({ view: 'brief', selectedId: 'private-record', filters: ['source'] }))
    expect(loadHomeViewPreference(storage)).toBe('operations')
  })

  it('falls back without rewriting invalid or absent values', () => {
    const storage = new FakeStorage()
    storage.values.set(HOME_VIEW_PREFERENCE_KEY, 'dashboard')
    expect(loadHomeViewPreference(storage)).toBe('operations')
    expect(storage.writes).toEqual([])
  })

  it('never throws when storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(loadHomeViewPreference(unavailable)).toBe('operations')
    expect(saveHomeViewPreference(unavailable, 'brief')).toBe(false)
    expect(loadHomeViewPreference(undefined)).toBe('operations')
  })

  it('defaults Metrics to Model Usage and remembers only a valid explicit choice', () => {
    const storage = new FakeStorage()
    expect(loadMetricsViewPreference(storage)).toBe('usage')
    expect(saveMetricsViewPreference(storage, 'analytics')).toBe(true)
    expect(storage.writes).toEqual([[METRICS_VIEW_PREFERENCE_KEY, 'analytics']])
    expect(loadMetricsViewPreference(storage)).toBe('analytics')
    storage.values.set(METRICS_VIEW_PREFERENCE_KEY, 'combined')
    expect(loadMetricsViewPreference(storage)).toBe('usage')
  })
})
