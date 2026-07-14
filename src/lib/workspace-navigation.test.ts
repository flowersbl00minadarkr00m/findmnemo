import { describe, expect, it } from 'vitest'
import { normalizeLegacyView, PRIMARY_AREAS, primaryAreaForView, resolvePrimaryArea } from './workspace-navigation'

describe('workspace navigation', () => {
  it('defines five plain-language areas in MNEMO order', () => {
    expect(PRIMARY_AREAS.map((area) => area.marker).join('')).toBe('MNEMO')
    expect(PRIMARY_AREAS.map((area) => area.label)).toEqual(['My Day', 'Next Actions', 'Engines', 'Metrics', 'Outreach'])
  })

  it('derives active areas and resolves saved subviews', () => {
    const storage = { getItem: (key: string) => key.includes('metrics') ? 'analytics' : 'brief' }
    expect(resolvePrimaryArea('my-day', storage)).toBe('brief')
    expect(resolvePrimaryArea('metrics', storage)).toBe('analytics')
    expect(primaryAreaForView('settings')).toBeNull()
    expect(primaryAreaForView('routing')).toBe('engines')
  })

  it('maps removed and legacy terms to supported destinations', () => {
    expect(normalizeLegacyView('sdd')).toBe('tickets')
    expect(normalizeLegacyView('Projects/SDD')).toBe('tickets')
    expect(normalizeLegacyView('model routing')).toBe('routing')
    expect(normalizeLegacyView('unknown')).toBe('operations')
  })
})
