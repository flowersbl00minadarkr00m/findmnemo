import type {
  OperationalRoutingPolicy,
  OperationalRoutingValidationResult,
  RoutingExecutionProfile,
} from '../../shared/companion-contract.js'
import {
  isRoutingProfileBehavior,
  isRoutingReadinessState,
} from '../../shared/companion-contract.js'
import { assertPrivateBoundary } from '../db/operational-repository.js'

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/
const PRIVATE_PATH = /(?:[A-Za-z]:[\\/](?:Users|Documents|AppData)[\\/]|\/(?:home|Users)\/)/i

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function validProfile(value: unknown): value is RoutingExecutionProfile {
  if (!record(value) || !STABLE_ID.test(String(value.id ?? '')) || !STABLE_ID.test(String(value.destinationAdapterId ?? ''))
    || !STABLE_ID.test(String(value.destinationInstanceId ?? '')) || typeof value.displayName !== 'string'
    || typeof value.modelId !== 'string' || value.modelId.length === 0 || (value.providerId !== null && typeof value.providerId !== 'string')
    || (value.effort !== null && typeof value.effort !== 'string') || !strings(value.capabilityIds)
    || typeof value.enabled !== 'boolean' || !isRoutingProfileBehavior(value.behavior)
    || !Number.isInteger(value.fallbackOrder) || Number(value.fallbackOrder) < 0 || !record(value.readiness)
    || !isRoutingReadinessState(value.readiness.state)) return false
  const readiness = value.readiness
  for (const key of ['checkedAt', 'expiresAt', 'adapterVersion', 'installedVersion', 'reasonCode']) {
    if (readiness[key] !== null && typeof readiness[key] !== 'string') return false
  }
  if (readiness.state === 'ready') {
    if (value.destinationAdapterId === 'manual' || !readiness.checkedAt || !readiness.expiresAt || !readiness.adapterVersion || !readiness.installedVersion) return false
    if (Date.parse(String(readiness.expiresAt)) <= Date.parse(String(readiness.checkedAt))) return false
  }
  return new Set(value.capabilityIds).size === value.capabilityIds.length
}

export function validateOperationalPolicyForCompanion(input: unknown): OperationalRoutingValidationResult {
  const issues: OperationalRoutingValidationResult['issues'] = []
  try { assertPrivateBoundary(input) } catch { issues.push({ code: 'private-field', path: '$', message: 'Private fields are not allowed in routing policy.' }) }
  if (containsPrivatePath(input)) issues.push({ code: 'private-path', path: '$', message: 'Private executable or user paths are not allowed in routing policy.' })
  if (!record(input)) return { valid: false, issues: [...issues, { code: 'invalid-policy', path: '$', message: 'Policy must be an object.' }] }
  const policy = input as unknown as OperationalRoutingPolicy
  if (policy.schemaVersion !== '2.0.0' || policy.policyProfile !== 'findmnemo.model-routing.v2') issues.push({ code: 'unsupported-policy', path: '$', message: 'Unsupported routing policy contract.' })
  if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 0 || !Number.isFinite(Date.parse(policy.updatedAt))) issues.push({ code: 'invalid-version', path: '$.policyVersion', message: 'Policy version or timestamp is invalid.' })
  if (!Array.isArray(policy.capabilities) || !Array.isArray(policy.profiles) || !strings(policy.defaultProfileOrder) || !Array.isArray(policy.capabilityOverrides)) issues.push({ code: 'invalid-collections', path: '$', message: 'Policy collections are invalid.' })
  if (issues.length > 0) return { valid: false, issues }
  const capabilityIds = policy.capabilities.map((capability) => capability.id)
  const profileIds = policy.profiles.map((profile) => profile.id)
  if (new Set(capabilityIds).size !== capabilityIds.length || capabilityIds.some((id) => !STABLE_ID.test(id))) issues.push({ code: 'invalid-capabilities', path: '$.capabilities', message: 'Capability IDs must be unique stable IDs.' })
  if (new Set(profileIds).size !== profileIds.length || policy.profiles.some((profile) => !validProfile(profile))) issues.push({ code: 'invalid-profiles', path: '$.profiles', message: 'Execution profiles are invalid.' })
  if (new Set(policy.defaultProfileOrder).size !== policy.defaultProfileOrder.length || policy.defaultProfileOrder.some((id) => !profileIds.includes(id))) issues.push({ code: 'invalid-default-order', path: '$.defaultProfileOrder', message: 'Default order contains duplicates or dangling profiles.' })
  policy.profiles.forEach((profile) => {
    if (profile.enabled && !policy.defaultProfileOrder.includes(profile.id)) issues.push({ code: 'enabled-profile-not-ordered', path: `$.profiles.${profile.id}`, message: 'Enabled profiles must be ordered.' })
    if (profile.capabilityIds.some((id) => !capabilityIds.includes(id))) issues.push({ code: 'dangling-capability', path: `$.profiles.${profile.id}.capabilityIds`, message: 'Profile references an unknown capability.' })
  })
  policy.capabilityOverrides.forEach((override) => {
    if (!capabilityIds.includes(override.capabilityId) || !strings(override.profileOrder) || new Set(override.profileOrder).size !== override.profileOrder.length || override.profileOrder.some((id) => !profileIds.includes(id))) issues.push({ code: 'invalid-override', path: `$.capabilityOverrides.${override.capabilityId}`, message: 'Capability override is invalid.' })
  })
  return issues.length > 0 ? { valid: false, issues } : { valid: true, issues, policy }
}

function containsPrivatePath(value: unknown): boolean {
  if (typeof value === 'string') return PRIVATE_PATH.test(value)
  if (Array.isArray(value)) return value.some(containsPrivatePath)
  return record(value) && Object.values(value).some(containsPrivatePath)
}
