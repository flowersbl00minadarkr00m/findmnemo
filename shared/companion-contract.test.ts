import { describe, expect, it } from 'vitest'
import {
  COMPANION_PROTOCOL_VERSION,
  assertAgentActivityAssignmentSummaryDto,
  assertAgentActivityBrowserSafe,
  assertAgentActivityIntegrationDto,
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

  it('enforces the browser-safe agent activity boundary', () => {
    expect(() => assertAgentActivityBrowserSafe({ id: 'safe', coverageState: 'partial', gapCount: 1 })).not.toThrow()
    for (const privateField of ['canonicalPath', 'activityToken', 'hookPayload', 'originAssignmentId', 'transcriptPath', 'retryContent']) {
      expect(() => assertAgentActivityBrowserSafe({ [privateField]: 'private' })).toThrow('AGENT_ACTIVITY_PRIVATE_FIELD')
    }
  })

  it('validates exact surface integration DTOs and rejects unknown or private fields', () => {
    const dto = integrationDtoFixture()
    expect(() => assertAgentActivityIntegrationDto(dto)).not.toThrow()
    expect(() => assertAgentActivityIntegrationDto({ ...dto, family: 'claude' })).toThrow('INVALID_AGENT_ACTIVITY_INTEGRATION_DTO')
    const { surfaceLabel: _surfaceLabel, ...missing } = dto
    expect(() => assertAgentActivityIntegrationDto(missing)).toThrow('INVALID_AGENT_ACTIVITY_INTEGRATION_DTO')
    expect(() => assertAgentActivityIntegrationDto({ ...dto, credential: 'private' })).toThrow('AGENT_ACTIVITY_PRIVATE_FIELD')
  })

  it('validates exact additive assignment attribution from stored family and surface fields', () => {
    const dto = {
      id: 'a'.repeat(64), integrationId: 'surface:codex-cli', ticketId: 'ticket-1',
      agent: 'codex-cli', agentLabel: 'Codex', agentFamily: 'codex', executionSurface: 'codex-cli', surfaceLabel: 'Codex CLI',
      summary: 'Safe work', summaryOwner: 'source', project: { kind: 'unassigned' }, projectOwner: 'source',
      modelLabel: null, modelSource: null, modelConfidence: null,
      effectiveState: 'active', retainedLastState: 'active', lastObservedAt: '2026-07-23T05:00:00.000Z',
      freshUntil: null, terminalAt: null, terminalEvidence: null, terminalOutcome: null,
      evidenceKind: 'mcp-tool', sourceUpdatePolicy: 'follow', recordVersion: 1, linkedTicketKind: null,
    }
    expect(() => assertAgentActivityAssignmentSummaryDto(dto)).not.toThrow()
    expect(() => assertAgentActivityAssignmentSummaryDto({ ...dto, executionSurface: 'codex-desktop', surfaceLabel: 'Codex CLI' })).toThrow('INVALID_AGENT_ACTIVITY_ASSIGNMENT_DTO')
    expect(() => assertAgentActivityAssignmentSummaryDto({ ...dto, path: 'private' })).toThrow('AGENT_ACTIVITY_PRIVATE_FIELD')
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

function integrationDtoFixture() {
  return {
    id: 'surface:claude-desktop-code',
    agent: 'claude-code',
    label: 'Claude',
    agentFamily: 'claude',
    executionSurface: 'claude-desktop-code',
    surfaceLabel: 'Claude Desktop Code',
    installedVersion: '1.2.3',
    detectedVersion: '1.2.3',
    qualifiedVersions: ['1.2.3'],
    setupMechanism: 'owned-test-binding',
    setupState: 'verified',
    reachability: 'reachable',
    healthState: 'healthy',
    supported: true,
    configured: true,
    enabled: true,
    agentAuthState: 'authenticated',
    integrationAuthState: 'ready',
    trustState: 'trusted',
    statusCheckedAt: '2026-07-23T05:00:00.000Z',
    supportLevel: 'manual',
    coverageState: 'connected',
    coverageExplanation: 'Recent supported activity was received.',
    capabilities: {
      detection: true,
      manual: true,
      snapshot: 'next-interaction',
      automaticEvents: 'none',
      automaticTerminal: 'none',
      explicitTerminal: 'explicit',
    },
    freshnessProfile: 'surface-qualified',
    freshnessWindowSeconds: 900,
    lastEventAt: '2026-07-23T05:00:00.000Z',
    lastSuccessAt: '2026-07-23T05:00:00.000Z',
    lastQualifiedAt: '2026-07-23T05:00:00.000Z',
    retainedLastSuccess: false,
    pendingEventCount: 0,
    gapCount: 0,
    failureCode: null,
    primaryAction: 'test',
  }
}
