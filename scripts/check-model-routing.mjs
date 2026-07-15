import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BUILT_IN_ROUTING_CAPABILITIES,
  MODEL_ROUTING_CATALOG_VERSION,
  MODEL_ROUTING_POLICY_PROFILE,
  MODEL_ROUTING_SCHEMA_VERSION,
  OPERATIONAL_ROUTING_POLICY_PROFILE,
  OPERATIONAL_ROUTING_SCHEMA_VERSION,
  ROUTING_INFERENCE_RULE_VERSION,
  buildEffectiveRouteOrder,
  confirmRoutingRecommendation,
  createEmptyModelRoutingPolicy,
  createModelRouteId,
  findEquivalentBuiltInRoutingCapabilityId,
  getModelRoutingPolicyRevision,
  getOperationalRoutingPolicyRevision,
  inferRequiredCapabilities,
  migrateModelRoutingPolicyV1ToV2,
  normalizeCapabilityId,
  overridePartialRoute,
  preflightOperationalRoute,
  recommendModelRoute,
  validateModelRoutingPolicy,
  validateOperationalRoutingPolicy,
} from '../src/lib/model-routing.ts'
import {
  MODEL_ROUTING_POLICY_STORAGE_KEY,
  applyStagedModelRoutingPolicy,
  exportModelRoutingPolicy,
  loadModelRoutingPolicy,
  saveModelRoutingPolicy,
  stageModelRoutingPolicyImport,
} from '../src/lib/model-routing-storage.ts'
import { routingDecisionToTelemetryEvent } from '../src/lib/model-routing-evidence.ts'

const NOW = '2026-07-10T18:00:00.000Z'

const executableUi = readFileSync(new URL('../src/components/routing/ExecutableRoutingSetup.tsx', import.meta.url), 'utf8')
const dispatchService = readFileSync(new URL('../server/routing/dispatch-service.ts', import.meta.url), 'utf8')
assert.match(executableUi, /Connect the engines you already use/)
assert.match(executableUi, /Choose who handles each kind of work/)
assert.match(executableUi, /raw paths never enter the browser|empty local scratch folder/)
assert.match(dispatchService, /recursive-dispatch-blocked/)
assert.match(dispatchService, /NO_READY_EXECUTABLE_ROUTE/)
assert.doesNotMatch(dispatchService, /shell\s*:\s*true/)

function assertValid(policy, label) {
  const result = validateModelRoutingPolicy(policy)
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.issues)}`)
  return result.policy
}

function assertInvalid(policy, expectedCode, label) {
  const result = validateModelRoutingPolicy(policy)
  assert.equal(result.valid, false, `${label}: expected invalid policy`)
  assert.ok(
    result.issues.some((issue) => issue.code === expectedCode),
    `${label}: expected ${expectedCode}, got ${JSON.stringify(result.issues)}`,
  )
  assert.equal(result.policy, undefined, `${label}: invalid input must not expose a policy`)
  return result
}

function assertOperationalValid(policy, label) {
  const result = validateOperationalRoutingPolicy(policy)
  assert.equal(result.valid, true, `${label}: ${JSON.stringify(result.issues)}`)
  return result.policy
}

function clone(value) {
  return structuredClone(value)
}

const requiredBuiltIns = [
  'orchestration.requirements-design',
  'orchestration.technical-design',
  'orchestration.task-design',
  'review.spec-alignment',
  'review.code-quality',
  'creation.writing',
  'creation.image-generation',
  'creation.video-generation',
  'engineering.coding',
  'research-analysis.web-research',
  'research-analysis.data-analysis',
]

assert.equal(MODEL_ROUTING_SCHEMA_VERSION, '1.0.0')
assert.equal(MODEL_ROUTING_POLICY_PROFILE, 'findmnemo.model-routing.v1')
assert.equal(MODEL_ROUTING_CATALOG_VERSION, '1.0.0')
assert.deepEqual(
  requiredBuiltIns.filter((id) => !BUILT_IN_ROUTING_CAPABILITIES.some((capability) => capability.id === id)),
  [],
  'built-in catalog must cover the approved capability families and examples',
)
assert.deepEqual(
  new Set(BUILT_IN_ROUTING_CAPABILITIES.map((capability) => capability.family)),
  new Set(['orchestration', 'review', 'creation', 'engineering', 'research-analysis']),
)

const emptyPolicy = createEmptyModelRoutingPolicy(NOW)
assertValid(emptyPolicy, 'empty policy')
assert.equal(emptyPolicy.routes.length, 0)
assert.equal(emptyPolicy.defaultRouteOrder.length, 0)
assert.deepEqual(emptyPolicy.capabilities, BUILT_IN_ROUTING_CAPABILITIES)

assert.equal(normalizeCapabilityId(' Software coding '), 'custom:software-coding')
assert.equal(normalizeCapabilityId('software---coding'), 'custom:software-coding')
assert.equal(normalizeCapabilityId('SOFTWARE coding'), 'custom:software-coding')
assert.throws(() => normalizeCapabilityId('---'), /alphanumeric/i)
assert.equal(findEquivalentBuiltInRoutingCapabilityId('code'), 'engineering.coding')
assert.equal(findEquivalentBuiltInRoutingCapabilityId('coding'), 'engineering.coding')
assert.equal(findEquivalentBuiltInRoutingCapabilityId('software coding'), 'engineering.coding')

const generatedRouteId = createModelRouteId('018f6f64-7f91-7a77-b7b8-67c640c6673c')
assert.equal(generatedRouteId, 'route:018f6f64-7f91-7a77-b7b8-67c640c6673c')

const routeDefinitions = [
  ['openai', 'OpenAI', 'gpt-example', 'ChatGPT', 'hosted'],
  ['anthropic', 'Anthropic', 'claude-example', 'Claude', 'hosted'],
  ['gemini', 'Google', 'gemini-example', 'Gemini', 'hosted'],
  ['hermes', 'Nous Research', 'hermes-example', 'Hermes', 'hosted'],
  ['local', 'Local', 'local-example', 'Ollama', 'local'],
  ['agent', 'OpenAI', 'codex-example', 'Codex', 'agent-surface'],
  ['custom', 'My Provider', 'future-model', 'Private surface', 'custom'],
]

const routes = routeDefinitions.map(([slug, provider, model, surface, kind]) => ({
  id: `route:${slug}`,
  displayName: `${surface} route`,
  provider,
  model,
  surface,
  kind,
  enabled: true,
  availability: { state: 'available', confirmedAt: NOW },
  capabilityIds: ['engineering.coding'],
}))

const importedCapability = {
  id: 'custom:workflow-synthesis',
  family: 'custom',
  label: 'Workflow synthesis',
  description: 'Combines work evidence into an operational workflow.',
  origin: 'imported',
}

const representativePolicy = {
  ...createEmptyModelRoutingPolicy(NOW),
  routes: routes.map((route, index) => index === 6
    ? { ...route, capabilityIds: ['engineering.coding', importedCapability.id] }
    : route),
  capabilities: [...BUILT_IN_ROUTING_CAPABILITIES, importedCapability],
  defaultRouteOrder: routes.map((route) => route.id),
  capabilityOverrides: [{ capabilityId: importedCapability.id, routeOrder: ['route:custom'] }],
}

const validatedRepresentative = assertValid(representativePolicy, 'mixed provider-neutral policy')
assert.equal(validatedRepresentative.capabilities.at(-1).label, importedCapability.label)

const renamedImportedPolicy = clone(representativePolicy)
renamedImportedPolicy.capabilities.at(-1).label = 'Renamed workflow synthesis'
assertValid(renamedImportedPolicy, 'imported capability display-name change')
assert.equal(renamedImportedPolicy.capabilities.at(-1).id, importedCapability.id)

const duplicateRoute = clone(representativePolicy)
duplicateRoute.routes.push(clone(duplicateRoute.routes[0]))
assertInvalid(duplicateRoute, 'duplicate-route-id', 'duplicate route ID')

const duplicateCapability = clone(representativePolicy)
duplicateCapability.capabilities.push({
  ...importedCapability,
  label: 'workflow synthesis',
  id: normalizeCapabilityId('workflow synthesis'),
})
assertInvalid(duplicateCapability, 'duplicate-capability-id', 'normalized custom collision')

const missingBuiltInCapability = clone(representativePolicy)
missingBuiltInCapability.capabilities = missingBuiltInCapability.capabilities.filter(
  (capability) => capability.id !== 'engineering.coding',
)
assertInvalid(missingBuiltInCapability, 'missing-built-in-capability', 'required built-in catalog integrity')

const equivalentCapability = clone(representativePolicy)
equivalentCapability.capabilities.push({
  id: 'custom:software-coding',
  family: 'custom',
  label: 'Software coding',
  description: 'Equivalent coding capability.',
  origin: 'imported',
})
assertInvalid(equivalentCapability, 'equivalent-capability-collision', 'semantic built-in collision')

const danglingCapability = clone(representativePolicy)
danglingCapability.routes[0].capabilityIds.push('custom:missing')
assertInvalid(danglingCapability, 'dangling-capability-reference', 'dangling route capability')

const danglingRoute = clone(representativePolicy)
danglingRoute.capabilityOverrides[0].routeOrder.push('route:missing')
assertInvalid(danglingRoute, 'dangling-route-reference', 'dangling override route')

const omittedEnabledRoute = clone(representativePolicy)
omittedEnabledRoute.defaultRouteOrder.pop()
assertInvalid(omittedEnabledRoute, 'enabled-route-not-ordered', 'enabled route omitted from default order')

const duplicateOrder = clone(representativePolicy)
duplicateOrder.defaultRouteOrder.push(duplicateOrder.defaultRouteOrder[0])
assertInvalid(duplicateOrder, 'duplicate-order-entry', 'duplicate default order entry')

const malformedTimestamp = clone(representativePolicy)
malformedTimestamp.routes[0].availability.confirmedAt = 'yesterday'
assertInvalid(malformedTimestamp, 'invalid-timestamp', 'malformed availability timestamp')

const unsupportedProfile = clone(representativePolicy)
unsupportedProfile.policyProfile = 'findmnemo.model-routing.v2'
assertInvalid(unsupportedProfile, 'unsupported-policy-profile', 'unsupported policy profile')

const unknownProperty = clone(representativePolicy)
unknownProperty.routes[0].endpoint = 'https://provider.invalid'
assertInvalid(unknownProperty, 'unknown-property', 'closed route shape')

const credentialField = clone(representativePolicy)
credentialField.routes[0].apiKey = 'not-echoed'
const credentialFieldResult = assertInvalid(
  credentialField,
  'prohibited-credential-field',
  'credential-shaped field',
)
assert.ok(credentialFieldResult.issues.some((issue) => issue.path === '$.routes[0].apiKey'))
assert.ok(!JSON.stringify(credentialFieldResult.issues).includes('not-echoed'))

const credentialValue = clone(representativePolicy)
credentialValue.routes[0].displayName = `sk-${'0123456789abcdefghijklmnop'}`
const credentialValueResult = assertInvalid(
  credentialValue,
  'prohibited-credential-value',
  'credential-shaped value',
)
assert.ok(credentialValueResult.issues.some((issue) => issue.path === '$.routes[0].displayName'))
assert.ok(!JSON.stringify(credentialValueResult.issues).includes(credentialValue.routes[0].displayName))

assert.equal(OPERATIONAL_ROUTING_SCHEMA_VERSION, '2.0.0')
assert.equal(OPERATIONAL_ROUTING_POLICY_PROFILE, 'findmnemo.model-routing.v2')
const operationalPreview = migrateModelRoutingPolicyV1ToV2(representativePolicy, 1)
const operationalPolicy = assertOperationalValid(operationalPreview.policy, 'v1-to-v2 operational preview')
assert.equal(operationalPreview.sourcePolicyRevision, getModelRoutingPolicyRevision(representativePolicy))
assert.deepEqual(operationalPolicy.defaultProfileOrder, representativePolicy.defaultRouteOrder)
assert.deepEqual(
  operationalPolicy.capabilityOverrides.map((override) => override.profileOrder),
  representativePolicy.capabilityOverrides.map((override) => override.routeOrder),
)
assert.ok(operationalPolicy.profiles.every((profile) => profile.behavior === 'recommend'))
assert.ok(operationalPolicy.profiles.every((profile) => profile.readiness.state === 'unchecked'))
assert.ok(operationalPolicy.profiles.every((profile) => profile.effort === null))

const readyOperational = clone(operationalPolicy)
const selectedOperationalProfile = readyOperational.profiles.find((profile) => profile.id === 'route:custom')
selectedOperationalProfile.destinationAdapterId = 'pi-rpc'
selectedOperationalProfile.destinationInstanceId = 'pi:default'
selectedOperationalProfile.behavior = 'auto-exact'
selectedOperationalProfile.readiness = {
  state: 'ready',
  checkedAt: NOW,
  expiresAt: '2026-07-10T19:00:00.000Z',
  adapterVersion: '1.0.0',
  installedVersion: '0.80.3',
  reasonCode: null,
}
const operationalPreflight = preflightOperationalRoute({
  policy: readyOperational,
  requiredCapabilityIds: [importedCapability.id],
  classificationSource: 'user-confirmed',
  classificationAmbiguous: false,
  override: { mode: 'none' },
  now: '2026-07-10T18:30:00.000Z',
})
assert.equal(operationalPreflight.status, 'auto-dispatch-eligible')
assert.equal(operationalPreflight.selectedProfileId, 'route:custom')
assert.equal(operationalPreflight.policyRevision, getOperationalRoutingPolicyRevision(readyOperational))

const operationalCredential = clone(operationalPolicy)
operationalCredential.profiles[0].accessToken = 'not-echoed'
const operationalCredentialResult = validateOperationalRoutingPolicy(operationalCredential)
assert.equal(operationalCredentialResult.valid, false)
assert.ok(operationalCredentialResult.issues.some((issue) => issue.code === 'prohibited-credential-field'))
assert.ok(!JSON.stringify(operationalCredentialResult.issues).includes('not-echoed'))

assert.equal(ROUTING_INFERENCE_RULE_VERSION, '1.0.0')
const inferred = inferRequiredCapabilities({
  id: 'ticket:routing-engine',
  title: 'Implement image-generation task design',
  description: 'Code the approved design and perform a spec quality review.',
  source: 'Codex',
  status: 'in-progress',
  workNotes: [],
  artifacts: [],
  decisionLog: [],
  createdAt: NOW,
  updatedAt: NOW,
  generatedKind: 'sdd-task-execution',
  sddGate: 'implementation:in-progress',
  delivers: 'A verified image generation implementation.',
  acceptanceCriteria: [{ id: 'ac-1', text: 'Image output matches the approved specification', checked: false }],
  verificationChecks: [{ id: 'v-1', commandOrCheck: 'npm run build', result: 'not-run' }],
})
assert.deepEqual(
  inferred.capabilityIds,
  [
    'orchestration.task-design',
    'review.spec-alignment',
    'review.code-quality',
    'creation.image-generation',
    'engineering.coding',
  ],
)
assert.ok(inferred.matchedRuleIds.every((ruleId) => ruleId.startsWith('routing-inference.v1.')))

const noInference = inferRequiredCapabilities({
  id: 'ticket:empty',
  title: 'Miscellaneous',
  description: 'Unclassified work',
  source: 'Pi',
  status: 'todo',
  workNotes: [],
  artifacts: [],
  decisionLog: [],
  createdAt: NOW,
  updatedAt: NOW,
})
assert.deepEqual(noInference, { capabilityIds: [], matchedRuleIds: [], ruleVersion: '1.0.0' })

const writingInference = inferRequiredCapabilities({
  id: 'ticket:linkedin-draft',
  title: 'Draft LinkedIn launch post for FindMnemo demo',
  description: 'Create a concise launch narrative for the product.',
  source: 'Pi',
  status: 'in-progress',
  workNotes: [],
  artifacts: [],
  decisionLog: [],
  createdAt: NOW,
  updatedAt: NOW,
})
assert.deepEqual(writingInference.capabilityIds, ['creation.writing'])
assert.deepEqual(writingInference.matchedRuleIds, ['routing-inference.v1.writing'])

const enginePolicy = {
  ...createEmptyModelRoutingPolicy(NOW),
  routes: [
    {
      id: 'route:preferred',
      displayName: 'Preferred coding route',
      provider: 'Provider A',
      model: 'model-a',
      surface: 'Surface A',
      kind: 'hosted',
      enabled: true,
      availability: { state: 'unavailable', confirmedAt: NOW },
      capabilityIds: ['engineering.coding', 'review.code-quality'],
    },
    {
      id: 'route:exact',
      displayName: 'Exact fallback',
      provider: 'Provider B',
      model: 'model-b',
      surface: 'Surface B',
      kind: 'hosted',
      enabled: true,
      availability: { state: 'available', confirmedAt: NOW },
      capabilityIds: ['engineering.coding', 'review.code-quality'],
    },
    {
      id: 'route:partial',
      displayName: 'Coding specialist',
      provider: 'Provider C',
      model: 'model-c',
      surface: 'Surface C',
      kind: 'local',
      enabled: true,
      availability: { state: 'available', confirmedAt: NOW },
      capabilityIds: ['engineering.coding'],
    },
  ],
  defaultRouteOrder: ['route:preferred', 'route:exact', 'route:partial'],
  capabilityOverrides: [
    { capabilityId: 'engineering.coding', routeOrder: ['route:partial', 'route:exact'] },
    { capabilityId: 'review.code-quality', routeOrder: ['route:exact', 'route:partial'] },
  ],
}
assertValid(enginePolicy, 'engine policy')

assert.deepEqual(
  buildEffectiveRouteOrder(enginePolicy, ['engineering.coding', 'review.code-quality']),
  {
    routeOrder: ['route:partial', 'route:exact', 'route:preferred'],
    appliedOverrideCapabilityIds: ['engineering.coding', 'review.code-quality'],
  },
)

const exactResult = recommendModelRoute({
  policy: enginePolicy,
  requiredCapabilityIds: ['review.code-quality', 'engineering.coding', 'engineering.coding'],
})
const enginePolicyRevision = getModelRoutingPolicyRevision(enginePolicy)
assert.equal(exactResult.policyRevision, enginePolicyRevision)
assert.equal(exactResult.status, 'exact-match')
assert.equal(exactResult.recommendedRouteId, 'route:exact')
assert.deepEqual(exactResult.requiredCapabilityIds, ['review.code-quality', 'engineering.coding'])
assert.deepEqual(exactResult.exactMatchRouteIds, ['route:exact'])
assert.deepEqual(exactResult.partialMatches, [{
  routeId: 'route:partial',
  supportedCapabilityIds: ['engineering.coding'],
  missingCapabilityIds: ['review.code-quality'],
}])
assert.deepEqual(
  exactResult.exclusions.find((exclusion) => exclusion.routeId === 'route:preferred').reasons,
  ['unavailable'],
)
assert.deepEqual(
  exactResult,
  recommendModelRoute({
    policy: enginePolicy,
    requiredCapabilityIds: ['review.code-quality', 'engineering.coding', 'engineering.coding'],
  }),
  'identical routing inputs must produce identical results',
)

const needsCapabilities = recommendModelRoute({ policy: enginePolicy, requiredCapabilityIds: [] })
assert.equal(needsCapabilities.status, 'needs-capabilities')
assert.equal(needsCapabilities.recommendedRouteId, undefined)

const noMatchPolicy = clone(enginePolicy)
noMatchPolicy.routes[1].capabilityIds = ['review.code-quality']
const noMatchResult = recommendModelRoute({
  policy: noMatchPolicy,
  requiredCapabilityIds: ['review.code-quality', 'engineering.coding'],
})
assert.equal(noMatchResult.status, 'no-match')
assert.equal(noMatchResult.recommendedRouteId, undefined)
assert.deepEqual(noMatchResult.partialMatches.map((match) => match.routeId), ['route:partial', 'route:exact'])
assert.deepEqual(noMatchResult.partialMatches[0].missingCapabilityIds, ['review.code-quality'])
assert.deepEqual(noMatchResult.partialMatches[1].missingCapabilityIds, ['engineering.coding'])

const invalidEnginePolicy = clone(enginePolicy)
invalidEnginePolicy.hiddenToken = 'value'
const invalidResult = recommendModelRoute({
  policy: invalidEnginePolicy,
  requiredCapabilityIds: ['engineering.coding'],
})
assert.equal(invalidResult.status, 'invalid-policy')
assert.ok(invalidResult.validationIssues.length > 0)

const confirmedDecision = confirmRoutingRecommendation({
  result: exactResult,
  ticketId: 'ticket:routing-engine',
  currentPolicyRevision: enginePolicyRevision,
  decidedAt: NOW,
  decisionId: 'routing-decision:exact',
})
assert.deepEqual(confirmedDecision, {
  id: 'routing-decision:exact',
  ticketId: 'ticket:routing-engine',
  routeId: 'route:exact',
  decisionType: 'exact-confirmation',
  requiredCapabilityIds: ['review.code-quality', 'engineering.coding'],
  missingCapabilityIds: [],
  policyRevision: enginePolicyRevision,
  decidedAt: NOW,
})
assert.throws(
  () => confirmRoutingRecommendation({
    result: exactResult,
    ticketId: 'ticket:routing-engine',
    currentPolicyRevision: '2026-07-10T18:01:00.000Z',
  }),
  /stale/i,
)

const sameTimestampChangedPolicy = clone(enginePolicy)
sameTimestampChangedPolicy.routes.find((route) => route.id === exactResult.recommendedRouteId).availability.state = 'unavailable'
assert.equal(sameTimestampChangedPolicy.updatedAt, enginePolicy.updatedAt)
const sameTimestampChangedRevision = getModelRoutingPolicyRevision(sameTimestampChangedPolicy)
assert.notEqual(sameTimestampChangedRevision, enginePolicyRevision)
assert.throws(
  () => confirmRoutingRecommendation({
    result: exactResult,
    ticketId: 'ticket:routing-engine',
    currentPolicyRevision: sameTimestampChangedRevision,
  }),
  /stale/i,
)

assert.throws(
  () => overridePartialRoute({
    result: noMatchResult,
    ticketId: 'ticket:routing-engine',
    routeId: 'route:partial',
    explicitlyConfirmed: false,
    currentPolicyRevision: noMatchResult.policyRevision,
  }),
  /explicit/i,
)
const overrideDecision = overridePartialRoute({
  result: noMatchResult,
  ticketId: 'ticket:routing-engine',
  routeId: 'route:partial',
  explicitlyConfirmed: true,
  currentPolicyRevision: noMatchResult.policyRevision,
  decidedAt: NOW,
  decisionId: 'routing-decision:override',
})
assert.equal(overrideDecision.decisionType, 'partial-override')
assert.deepEqual(overrideDecision.missingCapabilityIds, ['review.code-quality'])

class MemoryStorage {
  values = new Map()
  failReads = false
  failWrites = false

  getItem(key) {
    if (this.failReads) throw new Error('read unavailable')
    return this.values.get(key) ?? null
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error('quota exceeded')
    this.values.set(key, value)
  }
}

const memoryStorage = new MemoryStorage()
const missingLoad = loadModelRoutingPolicy(memoryStorage, NOW)
assert.equal(missingLoad.status, 'empty')
assert.equal(missingLoad.policy.updatedAt, NOW)
assert.equal(memoryStorage.getItem(MODEL_ROUTING_POLICY_STORAGE_KEY), null)

const saveResult = saveModelRoutingPolicy(enginePolicy, memoryStorage)
assert.equal(saveResult.status, 'saved')
assert.equal(saveResult.policyRevision, getModelRoutingPolicyRevision(enginePolicy))
const storedPolicyJson = memoryStorage.getItem(MODEL_ROUTING_POLICY_STORAGE_KEY)
assert.deepEqual(loadModelRoutingPolicy(memoryStorage).policy, enginePolicy)

memoryStorage.setItem(MODEL_ROUTING_POLICY_STORAGE_KEY, '{invalid-json')
const invalidStoredLoad = loadModelRoutingPolicy(memoryStorage)
assert.equal(invalidStoredLoad.status, 'invalid')
assert.equal(memoryStorage.getItem(MODEL_ROUTING_POLICY_STORAGE_KEY), '{invalid-json')
assert.ok(invalidStoredLoad.issues.some((issue) => issue.code === 'invalid-json'))

memoryStorage.setItem(MODEL_ROUTING_POLICY_STORAGE_KEY, storedPolicyJson)
const invalidImportText = JSON.stringify({ ...enginePolicy, apiKey: 'not-echoed' })
const invalidStage = stageModelRoutingPolicyImport(invalidImportText, enginePolicy)
assert.equal(invalidStage.status, 'invalid')
assert.ok(invalidStage.issues.some((issue) => issue.code === 'prohibited-credential-field'))
assert.ok(!JSON.stringify(invalidStage.issues).includes('not-echoed'))
assert.equal(memoryStorage.getItem(MODEL_ROUTING_POLICY_STORAGE_KEY), storedPolicyJson)
const invalidApply = applyStagedModelRoutingPolicy(invalidStage, memoryStorage)
assert.equal(invalidApply.status, 'invalid-stage')
assert.equal(memoryStorage.getItem(MODEL_ROUTING_POLICY_STORAGE_KEY), storedPolicyJson)

const importedPolicy = clone(enginePolicy)
importedPolicy.updatedAt = '2026-07-10T19:00:00.000Z'
importedPolicy.routes = importedPolicy.routes.slice(1)
importedPolicy.defaultRouteOrder = importedPolicy.defaultRouteOrder.filter((routeId) => routeId !== 'route:preferred')
importedPolicy.routes[0].availability.state = 'unavailable'
importedPolicy.routes.push({
  id: 'route:new-local',
  displayName: 'New local route',
  provider: 'Local',
  model: 'new-local',
  surface: 'Ollama',
  kind: 'local',
  enabled: false,
  availability: { state: 'available', confirmedAt: importedPolicy.updatedAt },
  capabilityIds: ['engineering.coding'],
})
const readyStage = stageModelRoutingPolicyImport(JSON.stringify(importedPolicy), enginePolicy)
assert.equal(readyStage.status, 'ready')
assert.deepEqual(readyStage.preview.addedRouteIds, ['route:new-local'])
assert.deepEqual(readyStage.preview.removedRouteIds, ['route:preferred'])
assert.deepEqual(readyStage.preview.availabilityChanges, [{
  routeId: 'route:exact',
  from: 'available',
  to: 'unavailable',
}])
assert.equal(readyStage.preview.defaultOrderChanged, true)
assert.equal(memoryStorage.getItem(MODEL_ROUTING_POLICY_STORAGE_KEY), storedPolicyJson)
const appliedImport = applyStagedModelRoutingPolicy(readyStage, memoryStorage)
assert.equal(appliedImport.status, 'saved')
assert.deepEqual(loadModelRoutingPolicy(memoryStorage).policy, importedPolicy)

const exportResult = exportModelRoutingPolicy(importedPolicy, '2026-07-10T20:00:00.000Z')
assert.equal(exportResult.status, 'ready')
assert.equal(exportResult.filename, 'findmnemo-model-routing-policy-2026-07-10.json')
assert.deepEqual(JSON.parse(exportResult.json), importedPolicy)
assert.equal(/apiKey|accessToken|password|credential/i.test(exportResult.json), false)

const invalidExport = exportModelRoutingPolicy({ ...importedPolicy, password: 'not-echoed' }, NOW)
assert.equal(invalidExport.status, 'invalid')
assert.ok(!JSON.stringify(invalidExport.issues).includes('not-echoed'))

const failingReadStorage = new MemoryStorage()
failingReadStorage.failReads = true
assert.equal(loadModelRoutingPolicy(failingReadStorage).status, 'error')
const failingWriteStorage = new MemoryStorage()
failingWriteStorage.failWrites = true
assert.equal(saveModelRoutingPolicy(enginePolicy, failingWriteStorage).status, 'error')

const exactEvidence = routingDecisionToTelemetryEvent(confirmedDecision, 3)
assert.equal(exactEvidence.eventId, 'model-route:routing-decision:exact')
assert.equal(exactEvidence.caseId, 'ticket:routing-engine')
assert.equal(exactEvidence.sequence, 3)
assert.equal(exactEvidence.activity.id, 'model-route-confirmed')
assert.equal(exactEvidence.activity.type, 'decide')
assert.equal(exactEvidence.actor.type, 'human')
assert.equal(exactEvidence.truthState, 'user-confirmed')
assert.equal(exactEvidence.decision.selectedPath, 'route:exact')
assert.ok(exactEvidence.objects.some((object) => object.sourceRef === 'mnemosync://model-route/route:exact'))
assert.ok(exactEvidence.tags.includes('capability:engineering.coding'))
assert.ok(exactEvidence.tags.includes(`policy-revision:${enginePolicyRevision}`))

const overrideEvidence = routingDecisionToTelemetryEvent(overrideDecision, 4)
assert.equal(overrideEvidence.activity.id, 'model-route-overridden')
assert.equal(overrideEvidence.truthState, 'overridden')
assert.ok(overrideEvidence.tags.includes('missing-capability:review.code-quality'))
assert.equal(overrideEvidence.decision.selectedPath, 'route:partial')

const evidenceSerialization = JSON.stringify([exactEvidence, overrideEvidence])
for (const privateMarker of [
  'PRIVATE ticket description',
  'PRIVATE prompt body',
  'PRIVATE work note',
  'https://provider.example/private-endpoint',
  `sk-${'0123456789abcdefghijklmnop'}`,
]) {
  assert.equal(evidenceSerialization.includes(privateMarker), false, `routing evidence leaked ${privateMarker}`)
}

const guidedRoutingSource = readFileSync(new URL('../src/components/routing/GuidedRoutingSetup.tsx', import.meta.url), 'utf8')
const dispatchHistorySource = readFileSync(new URL('../src/components/routing/DispatchHistory.tsx', import.meta.url), 'utf8')
const chatHarnessSource = readFileSync(new URL('./verify-chat-routing.mjs', import.meta.url), 'utf8')
for (const requiredText of ['Detection did not enable a profile', 'Enable this profile', 'Delegate only on a clear exact match', 'Backup order']) {
  assert.ok(guidedRoutingSource.includes(requiredText), `Guided routing release control is missing: ${requiredText}`)
}
for (const requiredText of ['Requested route', 'Actual route', 'Retry as new generation', 'Prompts, responses, credentials']) {
  assert.ok(dispatchHistorySource.includes(requiredText), `Dispatch history release control is missing: ${requiredText}`)
}
for (const requiredText of ['codex-mcp', 'claude-code-mcp', 'duplicateProtected', 'privateCanariesPersisted']) {
  assert.ok(chatHarnessSource.includes(requiredText), `Integrated chat-routing gate is missing: ${requiredText}`)
}

console.log('Model routing checks passed: policy engine, guided controls, dispatch evidence, integrated gate, portability, telemetry, and credential privacy.')
