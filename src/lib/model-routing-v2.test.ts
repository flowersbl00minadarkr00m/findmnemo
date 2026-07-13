import { describe, expect, it } from 'vitest'
import type { ModelRoutingPolicy, OperationalRoutingPolicy } from '../types'
import {
  createEmptyModelRoutingPolicy,
  getOperationalRoutingPolicyRevision,
  migrateModelRoutingPolicyV1ToV2,
  preflightOperationalRoute,
  validateOperationalRoutingPolicy,
} from './model-routing'

const NOW = '2026-07-12T20:00:00.000Z'
const EXPIRED = '2026-07-12T20:15:00.000Z'
const LATER = '2026-07-12T21:00:00.000Z'

function legacyPolicy(): ModelRoutingPolicy {
  return {
    ...createEmptyModelRoutingPolicy(NOW),
    routes: [
      {
        id: 'route:pi-writing',
        displayName: 'Pi writing',
        provider: 'OpenRouter',
        model: 'anthropic/claude-sonnet-4',
        surface: 'Pi',
        kind: 'agent-surface',
        enabled: true,
        availability: { state: 'available', confirmedAt: NOW },
        capabilityIds: ['creation.writing'],
      },
      {
        id: 'route:codex-coding',
        displayName: 'Codex coding',
        provider: 'OpenAI',
        model: 'gpt-5-codex',
        surface: 'Codex',
        kind: 'agent-surface',
        enabled: true,
        availability: { state: 'available', confirmedAt: NOW },
        capabilityIds: ['engineering.coding'],
      },
    ],
    defaultRouteOrder: ['route:pi-writing', 'route:codex-coding'],
    capabilityOverrides: [
      { capabilityId: 'engineering.coding', routeOrder: ['route:codex-coding'] },
    ],
  }
}

function readyPolicy(behavior: 'recommend' | 'auto-exact' = 'auto-exact'): OperationalRoutingPolicy {
  const migrated = migrateModelRoutingPolicyV1ToV2(legacyPolicy(), 7).policy
  return {
    ...migrated,
    profiles: migrated.profiles.map((profile) => profile.id === 'route:pi-writing'
      ? {
          ...profile,
          destinationAdapterId: 'pi-rpc',
          destinationInstanceId: 'pi:default',
          behavior,
          readiness: {
            state: 'ready',
            checkedAt: NOW,
            expiresAt: LATER,
            adapterVersion: '1.0.0',
            installedVersion: '0.80.3',
            reasonCode: null,
          },
        }
      : profile),
  }
}

describe('operational model routing policy v2', () => {
  it('migrates Spec 004 routes without enabling dispatch or inventing effort', () => {
    const preview = migrateModelRoutingPolicyV1ToV2(legacyPolicy(), 7)

    expect(preview.sourcePolicyRevision).toContain(NOW)
    expect(preview.policy).toMatchObject({
      schemaVersion: '2.0.0',
      policyProfile: 'findmnemo.model-routing.v2',
      policyVersion: 7,
      defaultProfileOrder: ['route:pi-writing', 'route:codex-coding'],
      capabilityOverrides: [
        { capabilityId: 'engineering.coding', profileOrder: ['route:codex-coding'] },
      ],
    })
    expect(preview.policy.profiles.map((profile) => profile.id)).toEqual([
      'route:pi-writing',
      'route:codex-coding',
    ])
    expect(preview.policy.profiles.every((profile) => profile.behavior === 'recommend')).toBe(true)
    expect(preview.policy.profiles.every((profile) => profile.readiness.state === 'unchecked')).toBe(true)
    expect(preview.policy.profiles.every((profile) => profile.effort === null)).toBe(true)
    expect(validateOperationalRoutingPolicy(preview.policy)).toEqual({
      valid: true,
      issues: [],
      policy: preview.policy,
    })
  })

  it('returns one explainable auto-dispatch eligible exact match', () => {
    const policy = readyPolicy()
    const result = preflightOperationalRoute({
      policy,
      requiredCapabilityIds: ['creation.writing'],
      classificationSource: 'origin-inferred',
      classificationAmbiguous: false,
      override: { mode: 'none' },
      now: '2026-07-12T20:30:00.000Z',
    })

    expect(result.status).toBe('auto-dispatch-eligible')
    expect(result.selectedProfileId).toBe('route:pi-writing')
    expect(result.reasonCodes).toContain('EXACT_AUTO_PROFILE')
    expect(result.policyRevision).toBe(getOperationalRoutingPolicyRevision(policy))
  })

  it('keeps recommendation-only, explicit self, and ambiguous requests out of dispatch', () => {
    const recommendation = preflightOperationalRoute({
      policy: readyPolicy('recommend'),
      requiredCapabilityIds: ['creation.writing'],
      classificationSource: 'origin-inferred',
      classificationAmbiguous: false,
      override: { mode: 'none' },
      now: '2026-07-12T20:30:00.000Z',
    })
    expect(recommendation.status).toBe('recommend')

    const selfHandled = preflightOperationalRoute({
      policy: readyPolicy(),
      requiredCapabilityIds: ['creation.writing'],
      classificationSource: 'explicit',
      classificationAmbiguous: false,
      override: { mode: 'self' },
      now: '2026-07-12T20:30:00.000Z',
    })
    expect(selfHandled.status).toBe('self-handled')

    const ambiguous = preflightOperationalRoute({
      policy: readyPolicy(),
      requiredCapabilityIds: ['creation.writing'],
      classificationSource: 'origin-inferred',
      classificationAmbiguous: true,
      override: { mode: 'none' },
      now: '2026-07-12T20:30:00.000Z',
    })
    expect(ambiguous.status).toBe('decision-required')
    expect(ambiguous.reasonCodes).toContain('AMBIGUOUS_CLASSIFICATION')
  })

  it('blocks stale, unavailable, partial, excluded, and invalid profiles', () => {
    const stale = readyPolicy()
    stale.profiles[0].readiness.expiresAt = EXPIRED
    expect(preflightOperationalRoute({
      policy: stale,
      requiredCapabilityIds: ['creation.writing'],
      classificationSource: 'user-confirmed',
      classificationAmbiguous: false,
      override: { mode: 'none' },
      now: '2026-07-12T20:30:00.000Z',
    }).status).toBe('unavailable')

    expect(preflightOperationalRoute({
      policy: readyPolicy(),
      requiredCapabilityIds: ['creation.writing', 'engineering.coding'],
      classificationSource: 'user-confirmed',
      classificationAmbiguous: false,
      override: { mode: 'none' },
      now: '2026-07-12T20:30:00.000Z',
    }).status).toBe('decision-required')

    expect(preflightOperationalRoute({
      policy: readyPolicy(),
      requiredCapabilityIds: ['creation.writing'],
      classificationSource: 'explicit',
      classificationAmbiguous: false,
      override: { mode: 'exclude', profileIds: ['route:pi-writing'] },
      now: '2026-07-12T20:30:00.000Z',
    }).status).toBe('unavailable')

    const invalid = structuredClone(readyPolicy()) as OperationalRoutingPolicy & { apiKey?: string }
    invalid.apiKey = 'not-persisted'
    const validation = validateOperationalRoutingPolicy(invalid)
    expect(validation.valid).toBe(false)
    expect(validation.issues.some((issue) => issue.code === 'prohibited-credential-field')).toBe(true)
    expect(JSON.stringify(validation.issues)).not.toContain('not-persisted')
  })
})
