import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { resolveMcpServerConstruction } from '../mcp/findmnemo-mcp.js'
import { ACTIVITY_ADAPTER_MANIFESTS, ActivityCapabilityRegistry, qualifyActivityAdapterManifest, type ActivityAdapterManifest } from './capability-manifests.js'
import {
  PRECISE_ACTIVITY_CELLS,
  SurfaceQualificationRegistry,
  loadSurfaceQualifications,
  unavailableQualification,
  type SurfaceQualificationModule,
} from './qualifications/index.js'

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

  it('loads exactly six fixed independent surface slots with inert unavailable defaults', () => {
    const modules = new SurfaceQualificationRegistry().list()
    expect(modules).toHaveLength(6)
    expect(modules.map((module) => module.integrationId)).toEqual(PRECISE_ACTIVITY_CELLS.map((cell) => cell.integrationId))
    expect(modules.every((module) => module.setup.bindingVerified === false && module.qualification.manual === false)).toBe(true)

    const healthy = healthyModule(PRECISE_ACTIVITY_CELLS[0])
    const oneHealthy = loadSurfaceQualifications(PRECISE_ACTIVITY_CELLS.map((cell, index) => index === 0 ? healthy : unavailableQualification(cell)))
    expect(oneHealthy.filter((module) => module.health.state === 'healthy')).toEqual([healthy])
    expect(oneHealthy.slice(1).every((module) => module.health.state === 'unavailable')).toBe(true)
  })

  it('rejects missing, duplicate, mismatched, and cross-cell qualification modules', () => {
    const modules = PRECISE_ACTIVITY_CELLS.map(unavailableQualification)
    expect(() => loadSurfaceQualifications(modules.slice(0, 5))).toThrow('ACTIVITY_QUALIFICATION_SLOT_MISSING')
    expect(() => loadSurfaceQualifications([...modules.slice(0, 5), modules[0]])).toThrow('ACTIVITY_QUALIFICATION_SLOT_DUPLICATE')
    expect(() => loadSurfaceQualifications(modules.map((module, index) => index === 0 ? { ...module, executionSurface: 'claude-code-cli' } as SurfaceQualificationModule : module))).toThrow('ACTIVITY_QUALIFICATION_SLOT_MISMATCH')
    expect(() => loadSurfaceQualifications(modules.map((module, index) => index === 0 ? { ...module, integrationId: 'surface:claude-code-cli' } as SurfaceQualificationModule : module))).toThrow('ACTIVITY_QUALIFICATION_SLOT_DUPLICATE')
  })

  it('keeps the six opaque surface ids aligned with T2 construction without deriving behavior from prefixes', () => {
    for (const cell of PRECISE_ACTIVITY_CELLS.filter((candidate) => candidate.agentFamily !== 'pi')) {
      const origin = cell.agentFamily === 'claude' ? 'claude-code-mcp' : 'codex-mcp'
      const construction = resolveMcpServerConstruction([`--origin=${origin}`, `--surface=${cell.executionSurface}`])
      expect(construction.integrationId).toBe(cell.integrationId)
      expect(construction.activityBinding).toEqual({
        integrationId: cell.integrationId,
        agentFamily: cell.agentFamily,
        executionSurface: cell.executionSurface,
      })
    }
    expect(PRECISE_ACTIVITY_CELLS.some((cell) => cell.integrationId.startsWith('manual:'))).toBe(false)
  })
})

function healthyModule(cell: (typeof PRECISE_ACTIVITY_CELLS)[number]): SurfaceQualificationModule {
  return {
    ...unavailableQualification(cell),
    adapterVersion: 'manual-1.0.0',
    detection: { state: 'detected', detectedVersion: '1.2.3', checkedAt: '2026-07-23T05:00:00.000Z' },
    setup: { state: 'verified', mechanism: 'owned-test-binding', credentialState: 'ready', bindingVerified: true },
    reachability: { state: 'reachable', checkedAt: '2026-07-23T05:00:00.000Z' },
    qualification: { qualifiedVersions: ['1.2.3'], manual: true, snapshot: 'next-interaction', automaticEvents: 'none', explicitTerminal: 'explicit', lastQualifiedAt: '2026-07-23T05:00:00.000Z' },
    health: { state: 'healthy', checkedAt: '2026-07-23T05:00:00.000Z', lastSuccessAt: '2026-07-23T05:00:00.000Z', failureCode: null },
  }
}
