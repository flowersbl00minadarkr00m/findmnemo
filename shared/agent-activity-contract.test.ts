import { describe, expect, it } from 'vitest'
import {
  AssignmentEventValidationError,
  normalizeAssignmentEvent,
  parseAssignmentEventV1,
  parseAssignmentEventV2,
  type AssignmentEventV1,
  type AssignmentEventV2,
} from './agent-activity-contract.js'

export function assignmentEventFixture(overrides: Partial<AssignmentEventV1> = {}): AssignmentEventV1 {
  return {
    schema: 'findmnemo.assignment-event.v1',
    eventId: '018f6f7e-6f52-7e54-8aa5-3f44fc884b42',
    integrationId: 'integration-codex-1',
    agent: 'codex-cli',
    adapterVersion: '1.0.0',
    agentVersion: '0.144.3',
    assignment: {
      originAssignmentId: 'private-origin-assignment-42',
      generation: 1,
      summary: { text: 'Implement the activity tracer', source: 'explicit-user' },
      projectRef: { kind: 'unassigned' },
    },
    observation: {
      sequence: 1,
      kind: 'started',
      reportedState: 'active',
      observedAt: '2026-07-14T17:00:00.000Z',
      evidenceKind: 'manual-command',
      originEvidenceId: 'private-origin-evidence-7',
    },
    modelLabel: 'gpt-5-codex',
    ...overrides,
  }
}

export function assignmentEventV2Fixture(overrides: Partial<AssignmentEventV2> = {}): AssignmentEventV2 {
  return {
    schema: 'findmnemo.assignment-event.v2',
    eventId: '028f6f7e-6f52-7e54-8aa5-3f44fc884b42',
    integrationId: 'integration-codex-desktop-1',
    agentFamily: 'codex',
    executionSurface: 'codex-desktop',
    adapterVersion: '2.0.0',
    agentVersion: '1.2.3',
    assignment: {
      originAssignmentId: 'private-origin-assignment-42',
      generation: 1,
      summary: { text: 'Implement the surface-aware tracer', source: 'explicit-user' },
      projectRef: { kind: 'unassigned' },
    },
    observation: {
      sequence: 1,
      kind: 'started',
      reportedState: 'active',
      observedAt: '2026-07-14T17:00:00.000Z',
      evidenceKind: 'mcp-tool',
      originEvidenceId: 'private-origin-evidence-v2-7',
    },
    model: {
      label: 'openai/gpt-5-codex',
      source: 'host-reported',
      confidence: 'reported',
    },
    ...overrides,
  }
}

describe('assignment event v1 contract', () => {
  it('accepts the exact allowlisted V1 shape', () => {
    expect(parseAssignmentEventV1(assignmentEventFixture())).toEqual({
      event: assignmentEventFixture(),
      receiptCodes: [],
    })
  })

  it.each([
    ['unknown root key', { ...assignmentEventFixture(), extra: true }],
    ['unknown version', { ...assignmentEventFixture(), schema: 'findmnemo.assignment-event.v2' }],
    ['array value', { ...assignmentEventFixture(), modelLabel: ['forbidden'] }],
    ['oversized request', { ...assignmentEventFixture(), modelLabel: 'x'.repeat(17_000) }],
    ['private key', { ...assignmentEventFixture(), assignment: { ...assignmentEventFixture().assignment, prompt: 'private' } }],
    ['raw project path', { ...assignmentEventFixture(), assignment: { ...assignmentEventFixture().assignment, projectRef: { kind: 'approved-project', id: 'C:\\private\\project' } } }],
    ['oversized summary', { ...assignmentEventFixture(), assignment: { ...assignmentEventFixture().assignment, summary: { text: 'x'.repeat(161), source: 'explicit-user' } } }],
    ['terminal evidence on start', { ...assignmentEventFixture(), observation: { ...assignmentEventFixture().observation, terminalEvidence: { kind: 'agent-explicit', outcome: 'completed' } } }],
    ['terminal without evidence', { ...assignmentEventFixture(), observation: { ...assignmentEventFixture().observation, kind: 'completed', reportedState: undefined } }],
    ['terminal outcome mismatch', { ...assignmentEventFixture(), observation: { ...assignmentEventFixture().observation, kind: 'failed', reportedState: undefined, terminalEvidence: { kind: 'agent-explicit', outcome: 'completed' } } }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseAssignmentEventV1(value)).toThrow(AssignmentEventValidationError)
  })

  it('minimizes multiline or credential-like summaries before they can cross persistence', () => {
    const value = assignmentEventFixture({
      assignment: {
        ...assignmentEventFixture().assignment,
        summary: { text: `Bearer ${'abcdefghijklmnopqrstuvwxyz'}\npasted detail`, source: 'explicit-user' },
      },
    })
    const parsed = parseAssignmentEventV1(value)
    expect(parsed.event.assignment.summary).toEqual({
      text: 'Codex work — name this assignment',
      source: 'placeholder',
    })
    expect(parsed.receiptCodes).toEqual(['SUMMARY_MINIMIZED'])
    expect(JSON.stringify(parsed)).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })

  it.each([
    'accepted', 'started', 'heartbeat', 'waiting', 'blocked', 'needs-action',
    'resumed', 'completed', 'failed', 'cancelled', 'snapshot',
  ] as const)('accepts a sanitized %s lifecycle fixture', (kind) => {
    const terminal = kind === 'completed' || kind === 'failed' || kind === 'cancelled'
    const value = assignmentEventFixture({
      observation: {
        ...assignmentEventFixture().observation,
        kind,
        ...(terminal ? { reportedState: undefined, terminalEvidence: { kind: 'agent-explicit', outcome: kind } } : {}),
        ...(kind === 'snapshot' ? { evidenceKind: 'snapshot' } : {}),
      },
      ...(kind === 'snapshot' ? { snapshot: { requestId: 'snapshot-1', mode: 'explicit-report', coverageStartedAt: '2026-07-14T16:59:00.000Z' } } : {}),
    })
    expect(parseAssignmentEventV1(value).event.observation.kind).toBe(kind)
  })

  it.each(['codex-hook', 'claude-hook', 'claude-task-hook', 'pi-extension', 'mcp-tool', 'manual-command', 'snapshot'] as const)(
    'accepts allowlisted %s evidence without evidence detail',
    (evidenceKind) => {
      expect(parseAssignmentEventV1(assignmentEventFixture({
        observation: { ...assignmentEventFixture().observation, evidenceKind },
      })).event.observation.evidenceKind).toBe(evidenceKind)
    },
  )

  it('keeps strict v1 model rejection unchanged', () => {
    expect(() => parseAssignmentEventV1(assignmentEventFixture({ modelLabel: 'password=private-value' })))
      .toThrowError(expect.objectContaining({ code: 'INVALID_MODEL_LABEL' }))
  })
})

describe('assignment event v2 contract', () => {
  it('accepts exact v2 input and normalizes family, surface, and model attribution separately from v1', () => {
    const parsed = parseAssignmentEventV2(assignmentEventV2Fixture())
    expect(parsed).toEqual({ event: assignmentEventV2Fixture(), receiptCodes: [] })
    expect(normalizeAssignmentEvent(parsed.event)).toMatchObject({
      schemaVersion: 'v2',
      identityVersion: 'v2',
      agent: 'codex-cli',
      agentFamily: 'codex',
      executionSurface: 'codex-desktop',
      modelLabel: 'openai/gpt-5-codex',
      modelSource: 'host-reported',
      modelConfidence: 'reported',
    })
    expect(normalizeAssignmentEvent(assignmentEventFixture())).toMatchObject({
      schemaVersion: 'v1',
      identityVersion: 'v1',
      agentFamily: 'codex',
      executionSurface: 'legacy-ambiguous',
      modelLabel: 'gpt-5-codex',
      modelSource: null,
      modelConfidence: null,
    })
  })

  it.each([
    ['family/surface mismatch', { ...assignmentEventV2Fixture(), agentFamily: 'claude' }],
    ['new legacy ambiguity', { ...assignmentEventV2Fixture(), executionSurface: 'legacy-ambiguous' }],
    ['unknown root key', { ...assignmentEventV2Fixture(), extra: true }],
    ['private nested key', {
      ...assignmentEventV2Fixture(),
      assignment: { ...assignmentEventV2Fixture().assignment, transcript: 'private' },
    }],
    ['usage field', { ...assignmentEventV2Fixture(), tokenCount: 123 }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseAssignmentEventV2(value)).toThrow(AssignmentEventValidationError)
  })

  it('validates structural and private keys before ignoring an invalid optional model label', () => {
    const privateValue = 'password=never-persist-this'
    const structurallyUnsafe = {
      ...assignmentEventV2Fixture(),
      response: 'private',
      model: { label: privateValue, source: 'host-reported', confidence: 'reported' },
    }
    expect(() => parseAssignmentEventV2(structurallyUnsafe))
      .toThrowError(expect.objectContaining({ code: 'PRIVATE_KEY_NOT_ALLOWED' }))

    const parsed = parseAssignmentEventV2({
      ...assignmentEventV2Fixture(),
      model: { label: privateValue, source: 'host-reported', confidence: 'reported' },
    })
    expect(parsed.event.model).toBeNull()
    expect(parsed.receiptCodes).toEqual(['MODEL_LABEL_IGNORED'])
    expect(JSON.stringify(parsed)).not.toContain(privateValue)
  })

  it.each([
    undefined,
    null,
  ])('continues with a null normalized model when the v2 model is %s', (model) => {
    const input = { ...assignmentEventV2Fixture(), model }
    if (model === undefined) delete (input as Partial<AssignmentEventV2>).model
    const parsed = parseAssignmentEventV2(input)
    expect(normalizeAssignmentEvent(parsed.event)).toMatchObject({
      modelLabel: null,
      modelSource: null,
      modelConfidence: null,
    })
    expect(parsed.receiptCodes).toEqual([])
  })
})
