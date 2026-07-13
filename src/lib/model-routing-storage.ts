import type {
  AppliedModelRoutingPolicyImport,
  ModelRoutingImportPreview,
  ModelRoutingPolicy,
  ModelRoutingPolicyExportResult,
  ModelRoutingPolicyLoadResult,
  ModelRoutingPolicySaveResult,
  ModelRoutingPolicyStorage,
  ModelRoutingValidationIssue,
  StagedModelRoutingPolicyImport,
} from '../types.ts'
import {
  createEmptyModelRoutingPolicy,
  getModelRoutingPolicyRevision,
  validateModelRoutingPolicy,
} from './model-routing.ts'

export const MODEL_ROUTING_POLICY_STORAGE_KEY = 'findmnemo_model_routing_policy_v1'
export const MODEL_ROUTING_POLICY_CHANGED_EVENT = 'findmnemo:model-routing-policy-changed'

const INVALID_JSON_ISSUE: ModelRoutingValidationIssue = {
  code: 'invalid-json',
  path: '$',
  message: 'Routing policy import is not valid JSON.',
}

function browserStorage(): ModelRoutingPolicyStorage {
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error('Local storage is unavailable.')
  }
  return globalThis.localStorage
}

function notifyPolicyChanged(policyRevision: string) {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return
  globalThis.dispatchEvent(new CustomEvent(MODEL_ROUTING_POLICY_CHANGED_EVENT, {
    detail: { policyRevision },
  }))
}

export function loadModelRoutingPolicy(
  storage?: ModelRoutingPolicyStorage,
  emptyPolicyUpdatedAt?: string,
): ModelRoutingPolicyLoadResult {
  let serialized: string | null
  try {
    serialized = (storage ?? browserStorage()).getItem(MODEL_ROUTING_POLICY_STORAGE_KEY)
  } catch {
    return {
      status: 'error',
      code: 'storage-read-failed',
      message: 'The routing policy could not be read from local storage.',
    }
  }

  if (serialized === null) {
    return {
      status: 'empty',
      policy: createEmptyModelRoutingPolicy(emptyPolicyUpdatedAt),
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return { status: 'invalid', issues: [{ ...INVALID_JSON_ISSUE }] }
  }

  const validation = validateModelRoutingPolicy(parsed)
  if (!validation.valid || !validation.policy) {
    return { status: 'invalid', issues: validation.issues }
  }
  return { status: 'loaded', policy: validation.policy }
}

export function saveModelRoutingPolicy(
  policy: unknown,
  storage?: ModelRoutingPolicyStorage,
): ModelRoutingPolicySaveResult {
  const validation = validateModelRoutingPolicy(policy)
  if (!validation.valid || !validation.policy) {
    return { status: 'invalid', issues: validation.issues }
  }

  try {
    ;(storage ?? browserStorage()).setItem(
      MODEL_ROUTING_POLICY_STORAGE_KEY,
      JSON.stringify(validation.policy),
    )
  } catch {
    return {
      status: 'error',
      code: 'storage-write-failed',
      message: 'The routing policy could not be saved to local storage.',
    }
  }

  const policyRevision = getModelRoutingPolicyRevision(validation.policy)
  notifyPolicyChanged(policyRevision)
  return { status: 'saved', policyRevision }
}

function ids<T extends { id: string }>(values: T[]): string[] {
  return values.map((value) => value.id)
}

function changedOrder(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}

function createImportPreview(
  currentPolicy: ModelRoutingPolicy,
  importedPolicy: ModelRoutingPolicy,
): ModelRoutingImportPreview {
  const currentRouteIds = new Set(ids(currentPolicy.routes))
  const importedRouteIds = new Set(ids(importedPolicy.routes))
  const currentCapabilityIds = new Set(ids(currentPolicy.capabilities))
  const importedCapabilityIds = new Set(ids(importedPolicy.capabilities))
  const currentRoutes = new Map(currentPolicy.routes.map((route) => [route.id, route]))

  return {
    addedRouteIds: importedPolicy.routes.map((route) => route.id).filter((id) => !currentRouteIds.has(id)),
    removedRouteIds: currentPolicy.routes.map((route) => route.id).filter((id) => !importedRouteIds.has(id)),
    addedCapabilityIds: importedPolicy.capabilities.map((capability) => capability.id)
      .filter((id) => !currentCapabilityIds.has(id)),
    removedCapabilityIds: currentPolicy.capabilities.map((capability) => capability.id)
      .filter((id) => !importedCapabilityIds.has(id)),
    availabilityChanges: importedPolicy.routes.flatMap((route) => {
      const currentRoute = currentRoutes.get(route.id)
      if (!currentRoute || currentRoute.availability.state === route.availability.state) return []
      return [{
        routeId: route.id,
        from: currentRoute.availability.state,
        to: route.availability.state,
      }]
    }),
    defaultOrderChanged: changedOrder(currentPolicy.defaultRouteOrder, importedPolicy.defaultRouteOrder),
    capabilityOverrideOrderChanged: changedOrder(
      currentPolicy.capabilityOverrides,
      importedPolicy.capabilityOverrides,
    ),
  }
}

export function stageModelRoutingPolicyImport(
  serialized: string,
  currentPolicy: ModelRoutingPolicy,
): StagedModelRoutingPolicyImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return { status: 'invalid', issues: [{ ...INVALID_JSON_ISSUE }] }
  }

  const currentValidation = validateModelRoutingPolicy(currentPolicy)
  if (!currentValidation.valid || !currentValidation.policy) {
    return { status: 'invalid', issues: currentValidation.issues }
  }
  const importedValidation = validateModelRoutingPolicy(parsed)
  if (!importedValidation.valid || !importedValidation.policy) {
    return { status: 'invalid', issues: importedValidation.issues }
  }

  return {
    status: 'ready',
    policy: importedValidation.policy,
    preview: createImportPreview(currentValidation.policy, importedValidation.policy),
  }
}

export function applyStagedModelRoutingPolicy(
  stagedImport: StagedModelRoutingPolicyImport,
  storage?: ModelRoutingPolicyStorage,
): AppliedModelRoutingPolicyImport {
  if (stagedImport.status !== 'ready') {
    return {
      status: 'invalid-stage',
      message: 'Only a valid, previewed routing policy can be applied.',
    }
  }
  return saveModelRoutingPolicy(stagedImport.policy, storage)
}

export function exportModelRoutingPolicy(
  policy: unknown,
  exportedAt = new Date().toISOString(),
): ModelRoutingPolicyExportResult {
  const validation = validateModelRoutingPolicy(policy)
  if (!validation.valid || !validation.policy) {
    return { status: 'invalid', issues: validation.issues }
  }

  return {
    status: 'ready',
    filename: `findmnemo-model-routing-policy-${exportedAt.slice(0, 10)}.json`,
    json: `${JSON.stringify(validation.policy, null, 2)}\n`,
  }
}

export function downloadModelRoutingPolicy(
  policy: unknown,
  exportedAt = new Date().toISOString(),
): ModelRoutingPolicyExportResult {
  const exported = exportModelRoutingPolicy(policy, exportedAt)
  if (exported.status !== 'ready') return exported

  if (
    typeof globalThis.document === 'undefined'
    || typeof globalThis.URL?.createObjectURL !== 'function'
  ) {
    return {
      status: 'error',
      code: 'download-unavailable',
      message: 'Policy download is unavailable in this environment.',
    }
  }

  const url = URL.createObjectURL(new Blob([exported.json], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = exported.filename
  anchor.click()
  URL.revokeObjectURL(url)
  return exported
}
