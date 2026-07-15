import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_ADAPTER_MANIFESTS, ActivityCapabilityRegistry, qualifyActivityAdapterManifest, type ActivityAdapterManifest } from './capability-manifests.js'

describe('agent activity adapter qualification', () => {
  it('requires independent lifecycle, privacy, freshness, snapshot, terminal, version, and platform evidence', () => {
    for (const manifest of ACTIVITY_ADAPTER_MANIFESTS) expect(qualifyActivityAdapterManifest(manifest)).toEqual(manifest)
    const incomplete = { ...ACTIVITY_ADAPTER_MANIFESTS[0], agent: 'pi', qualification: { ...ACTIVITY_ADAPTER_MANIFESTS[0].qualification, privacy: false } } as ActivityAdapterManifest
    expect(() => qualifyActivityAdapterManifest(incomplete)).toThrow('ACTIVITY_MANIFEST_UNQUALIFIED')
    expect(() => new ActivityCapabilityRegistry(new DatabaseSync(':memory:'), [incomplete])).toThrow('ACTIVITY_MANIFEST_UNQUALIFIED')
  })

  it('cannot claim automatic terminal support without qualified terminal evidence', () => {
    const optimistic = { ...ACTIVITY_ADAPTER_MANIFESTS[0], supportLevel: 'automatic-task-terminal', qualification: { ...ACTIVITY_ADAPTER_MANIFESTS[0].qualification, terminal: 'none' } } as ActivityAdapterManifest
    expect(() => qualifyActivityAdapterManifest(optimistic)).toThrow('ACTIVITY_MANIFEST_TERMINAL_UNQUALIFIED')
  })
})
