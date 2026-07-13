import type {
  ModelRouteTarget,
  ModelRoutingPolicy,
  ModelRoutingRecommendationInput,
  ModelRoutingValidationIssue,
  ModelRoutingValidationResult,
  RoutingCapabilityDefinition,
  RoutingCapabilityInferenceResult,
  RoutingDecisionRecord,
  RoutingRecommendationResult,
  Ticket,
} from '../types'

export const MODEL_ROUTING_SCHEMA_VERSION = '1.0.0' as const
export const MODEL_ROUTING_POLICY_PROFILE = 'findmnemo.model-routing.v1' as const
export const MODEL_ROUTING_CATALOG_VERSION = '1.0.0' as const
export const ROUTING_INFERENCE_RULE_VERSION = '1.0.0' as const

const BUILT_IN_CAPABILITY_EQUIVALENCE_ALIASES: Readonly<Record<string, string>> = {
  code: 'engineering.coding',
  coding: 'engineering.coding',
  'software-code': 'engineering.coding',
  'software-coding': 'engineering.coding',
}

export const BUILT_IN_ROUTING_CAPABILITIES: readonly RoutingCapabilityDefinition[] = [
  {
    id: 'orchestration.requirements-design',
    family: 'orchestration',
    label: 'Requirements design',
    description: 'Defines what a feature must achieve and why it matters.',
    origin: 'built-in',
  },
  {
    id: 'orchestration.technical-design',
    family: 'orchestration',
    label: 'Technical design',
    description: 'Designs architecture, contracts, data flow, and implementation boundaries.',
    origin: 'built-in',
  },
  {
    id: 'orchestration.task-design',
    family: 'orchestration',
    label: 'Task design',
    description: 'Decomposes approved designs into ordered, verifiable implementation work.',
    origin: 'built-in',
  },
  {
    id: 'orchestration.workflow-orchestration',
    family: 'orchestration',
    label: 'Workflow orchestration',
    description: 'Coordinates dependent work across tools, agents, or stages.',
    origin: 'built-in',
  },
  {
    id: 'review.spec-alignment',
    family: 'review',
    label: 'Specification alignment review',
    description: 'Checks delivered behavior against approved requirements, design, and tasks.',
    origin: 'built-in',
  },
  {
    id: 'review.code-quality',
    family: 'review',
    label: 'Code quality review',
    description: 'Reviews correctness, maintainability, security, and project conventions.',
    origin: 'built-in',
  },
  {
    id: 'review.quality-assurance',
    family: 'review',
    label: 'Quality assurance',
    description: 'Plans and performs functional, regression, and acceptance checks.',
    origin: 'built-in',
  },
  {
    id: 'creation.writing',
    family: 'creation',
    label: 'Writing',
    description: 'Drafts or revises clear written content for an intended audience.',
    origin: 'built-in',
  },
  {
    id: 'creation.image-generation',
    family: 'creation',
    label: 'Image generation',
    description: 'Creates or edits raster images and visual assets.',
    origin: 'built-in',
  },
  {
    id: 'creation.video-generation',
    family: 'creation',
    label: 'Video generation',
    description: 'Creates or edits video content and motion assets.',
    origin: 'built-in',
  },
  {
    id: 'engineering.coding',
    family: 'engineering',
    label: 'Coding',
    description: 'Implements or modifies software in a codebase.',
    origin: 'built-in',
  },
  {
    id: 'engineering.debugging',
    family: 'engineering',
    label: 'Debugging',
    description: 'Diagnoses software failures and identifies evidence-backed causes.',
    origin: 'built-in',
  },
  {
    id: 'research-analysis.web-research',
    family: 'research-analysis',
    label: 'Web research',
    description: 'Finds and synthesizes current information from authoritative sources.',
    origin: 'built-in',
  },
  {
    id: 'research-analysis.data-analysis',
    family: 'research-analysis',
    label: 'Data analysis',
    description: 'Examines structured evidence to identify patterns and conclusions.',
    origin: 'built-in',
  },
]

interface RoutingInferenceRule {
  id: string
  capabilityId: string
  patterns: RegExp[]
}

export const ROUTING_INFERENCE_RULES: readonly RoutingInferenceRule[] = [
  {
    id: 'routing-inference.v1.requirements-design',
    capabilityId: 'orchestration.requirements-design',
    patterns: [/\brequirements? design\b/, /\bprd\b/, /\buser stor(?:y|ies)\b/, /requirements:(?:draft|approved)/],
  },
  {
    id: 'routing-inference.v1.technical-design',
    capabilityId: 'orchestration.technical-design',
    patterns: [/\btechnical design\b/, /\barchitecture\b/, /\bapi contract\b/, /\bdata model\b/, /design:(?:draft|approved)/],
  },
  {
    id: 'routing-inference.v1.task-design',
    capabilityId: 'orchestration.task-design',
    patterns: [/\btask design\b/, /\btask decomposition\b/, /\bimplementation plan\b/, /tasks:(?:draft|approved)/],
  },
  {
    id: 'routing-inference.v1.workflow-orchestration',
    capabilityId: 'orchestration.workflow-orchestration',
    patterns: [/\borchestrat(?:e|ion|ing)\b/, /\bmulti-agent\b/, /\bworkflow coordination\b/],
  },
  {
    id: 'routing-inference.v1.spec-alignment',
    capabilityId: 'review.spec-alignment',
    patterns: [/\bspec(?:ification)? (?:alignment|review|quality)\b/, /\bacceptance criteria\b/, /\bsdd review\b/, /review:done/],
  },
  {
    id: 'routing-inference.v1.code-quality',
    capabilityId: 'review.code-quality',
    patterns: [/\bcode review\b/, /\bquality review\b/, /\bquality assurance\b/, /\blint(?:ing)?\b/, /\bregression\b/],
  },
  {
    id: 'routing-inference.v1.writing',
    capabilityId: 'creation.writing',
    patterns: [/\bwriting\b/, /\bdraft\b.{0,60}\b(?:post|article|document|email|copy)\b/, /\bcopywriting\b/, /\brevise (?:copy|prose|text)\b/],
  },
  {
    id: 'routing-inference.v1.image-generation',
    capabilityId: 'creation.image-generation',
    patterns: [/\bimage generation\b/, /\bgenerate (?:an? )?image\b/, /\bimage-generation\b/, /\bvisual asset\b/],
  },
  {
    id: 'routing-inference.v1.video-generation',
    capabilityId: 'creation.video-generation',
    patterns: [/\bvideo generation\b/, /\bgenerate (?:a )?video\b/, /\bvideo-generation\b/, /\bmotion asset\b/],
  },
  {
    id: 'routing-inference.v1.coding',
    capabilityId: 'engineering.coding',
    patterns: [/\bcod(?:e|ing)\b/, /\bimplement(?:ation|ing)?\b/, /\bsoftware change\b/, /\bnpm run build\b/, /implementation:in-progress/],
  },
  {
    id: 'routing-inference.v1.debugging',
    capabilityId: 'engineering.debugging',
    patterns: [/\bdebug(?:ging)?\b/, /\broot cause\b/, /\bdiagnos(?:e|is|ing)\b/, /\bfix (?:a |the )?bug\b/],
  },
  {
    id: 'routing-inference.v1.web-research',
    capabilityId: 'research-analysis.web-research',
    patterns: [/\bweb research\b/, /\bbrowse (?:the )?web\b/, /\bcurrent sources?\b/, /\bsource verification\b/],
  },
  {
    id: 'routing-inference.v1.data-analysis',
    capabilityId: 'research-analysis.data-analysis',
    patterns: [/\bdata analysis\b/, /\banaly[sz]e (?:the )?(?:data|dataset)\b/, /\bstatistical analysis\b/],
  },
]

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'policyProfile',
  'producer',
  'catalogVersion',
  'updatedAt',
  'routes',
  'capabilities',
  'defaultRouteOrder',
  'capabilityOverrides',
] as const
const PRODUCER_KEYS = ['productName', 'productId'] as const
const ROUTE_KEYS = [
  'id',
  'displayName',
  'provider',
  'model',
  'surface',
  'kind',
  'enabled',
  'availability',
  'capabilityIds',
] as const
const AVAILABILITY_KEYS = ['state', 'confirmedAt'] as const
const CAPABILITY_KEYS = ['id', 'family', 'label', 'description', 'origin'] as const
const OVERRIDE_KEYS = ['capabilityId', 'routeOrder'] as const

const CAPABILITY_FAMILIES = new Set([
  'orchestration',
  'review',
  'creation',
  'engineering',
  'research-analysis',
  'custom',
])
const CAPABILITY_ORIGINS = new Set(['built-in', 'custom', 'imported'])
const ROUTE_KINDS = new Set(['hosted', 'local', 'agent-surface', 'custom'])
const AVAILABILITY_STATES = new Set(['available', 'unavailable'])
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const CREDENTIAL_FIELD_PATTERN = /(?:api|access|refresh|session)[_-]?(?:key|token)|authorization|bearer|cookie|pass(?:word|wd)?|secret/i
const CREDENTIAL_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}\b/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password)\s*[:=]\s*\S+/i,
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedCapabilityLabel(label: string): string {
  return label
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function findEquivalentBuiltInRoutingCapabilityId(label: string): string | undefined {
  const normalized = normalizedCapabilityLabel(label)
  if (!normalized) return undefined

  const directBuiltIn = BUILT_IN_ROUTING_CAPABILITIES.find(
    (capability) => normalizedCapabilityLabel(capability.label) === normalized,
  )
  return directBuiltIn?.id ?? BUILT_IN_CAPABILITY_EQUIVALENCE_ALIASES[normalized]
}

function canonicalPolicyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPolicyJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalPolicyJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function getModelRoutingPolicyRevision(policy: ModelRoutingPolicy): string {
  const canonical = canonicalPolicyJson(policy)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `${policy.updatedAt}:${hash.toString(16).padStart(16, '0')}`
}

function addIssue(
  issues: ModelRoutingValidationIssue[],
  code: string,
  path: string,
  message: string,
) {
  issues.push({ code, path, message })
}

function checkUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  issues: ModelRoutingValidationIssue[],
) {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(issues, 'unknown-property', `${path}.${key}`, 'Property is not allowed by the routing policy schema.')
    }
  }
}

function scanForCredentials(
  value: unknown,
  path: string,
  issues: ModelRoutingValidationIssue[],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForCredentials(item, `${path}[${index}]`, issues))
    return
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`
      if (CREDENTIAL_FIELD_PATTERN.test(key)) {
        addIssue(issues, 'prohibited-credential-field', itemPath, 'Credential-shaped fields are not permitted.')
      }
      scanForCredentials(item, itemPath, issues)
    }
    return
  }

  if (typeof value === 'string' && CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    addIssue(issues, 'prohibited-credential-value', path, 'Credential-shaped content is not permitted.')
  }
}

function requireRecord(
  value: unknown,
  path: string,
  issues: ModelRoutingValidationIssue[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    addIssue(issues, 'invalid-object', path, 'Expected an object.')
    return undefined
  }
  return value
}

function requireString(
  value: unknown,
  path: string,
  issues: ModelRoutingValidationIssue[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    addIssue(issues, 'invalid-required-string', path, 'Expected a non-empty string.')
    return undefined
  }
  return value
}

function requireStableId(
  value: unknown,
  path: string,
  issues: ModelRoutingValidationIssue[],
): string | undefined {
  const id = requireString(value, path, issues)
  if (id !== undefined && !STABLE_ID_PATTERN.test(id)) {
    addIssue(issues, 'invalid-stable-id', path, 'Expected a stable identifier containing letters, numbers, dots, colons, underscores, or hyphens.')
    return undefined
  }
  return id
}

function checkTimestamp(value: unknown, path: string, issues: ModelRoutingValidationIssue[]) {
  const timestamp = requireString(value, path, issues)
  if (timestamp === undefined) return

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) {
    addIssue(issues, 'invalid-timestamp', path, 'Expected an ISO 8601 UTC timestamp with milliseconds.')
  }
}

function requireStringArray(
  value: unknown,
  path: string,
  issues: ModelRoutingValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, 'invalid-array', path, 'Expected an array.')
    return []
  }

  const strings: string[] = []
  value.forEach((item, index) => {
    const stringValue = requireStableId(item, `${path}[${index}]`, issues)
    if (stringValue !== undefined) strings.push(stringValue)
  })
  return strings
}

function checkDuplicates(
  values: string[],
  code: string,
  path: string,
  issues: ModelRoutingValidationIssue[],
) {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) {
      addIssue(issues, code, `${path}[${index}]`, 'Duplicate stable identifier is not allowed.')
    }
    seen.add(value)
  })
}

function validateCapability(
  value: unknown,
  index: number,
  issues: ModelRoutingValidationIssue[],
): string | undefined {
  const path = `$.capabilities[${index}]`
  const capability = requireRecord(value, path, issues)
  if (!capability) return undefined

  checkUnknownKeys(capability, CAPABILITY_KEYS, path, issues)
  const id = requireStableId(capability.id, `${path}.id`, issues)
  const family = requireString(capability.family, `${path}.family`, issues)
  requireString(capability.label, `${path}.label`, issues)
  requireString(capability.description, `${path}.description`, issues)
  const origin = requireString(capability.origin, `${path}.origin`, issues)

  if (family !== undefined && !CAPABILITY_FAMILIES.has(family)) {
    addIssue(issues, 'invalid-capability-family', `${path}.family`, 'Capability family is not supported.')
  }
  if (origin !== undefined && !CAPABILITY_ORIGINS.has(origin)) {
    addIssue(issues, 'invalid-capability-origin', `${path}.origin`, 'Capability origin is not supported.')
  }
  return id
}

function validateRoute(
  value: unknown,
  index: number,
  issues: ModelRoutingValidationIssue[],
): { id?: string; enabled: boolean; capabilityIds: string[] } {
  const path = `$.routes[${index}]`
  const route = requireRecord(value, path, issues)
  if (!route) return { enabled: false, capabilityIds: [] }

  checkUnknownKeys(route, ROUTE_KEYS, path, issues)
  const id = requireStableId(route.id, `${path}.id`, issues)
  requireString(route.displayName, `${path}.displayName`, issues)
  requireString(route.provider, `${path}.provider`, issues)
  requireString(route.model, `${path}.model`, issues)
  requireString(route.surface, `${path}.surface`, issues)
  const kind = requireString(route.kind, `${path}.kind`, issues)
  if (kind !== undefined && !ROUTE_KINDS.has(kind)) {
    addIssue(issues, 'invalid-route-kind', `${path}.kind`, 'Route kind is not supported.')
  }

  let enabled = false
  if (typeof route.enabled !== 'boolean') {
    addIssue(issues, 'invalid-boolean', `${path}.enabled`, 'Expected a boolean.')
  } else {
    enabled = route.enabled
  }

  const availability = requireRecord(route.availability, `${path}.availability`, issues)
  if (availability) {
    checkUnknownKeys(availability, AVAILABILITY_KEYS, `${path}.availability`, issues)
    const state = requireString(availability.state, `${path}.availability.state`, issues)
    if (state !== undefined && !AVAILABILITY_STATES.has(state)) {
      addIssue(issues, 'invalid-availability-state', `${path}.availability.state`, 'Availability must be available or unavailable.')
    }
    checkTimestamp(availability.confirmedAt, `${path}.availability.confirmedAt`, issues)
  }

  const capabilityIds = requireStringArray(route.capabilityIds, `${path}.capabilityIds`, issues)
  checkDuplicates(capabilityIds, 'duplicate-capability-assignment', `${path}.capabilityIds`, issues)
  return { id, enabled, capabilityIds }
}

export function normalizeCapabilityId(label: string): string {
  const slug = normalizedCapabilityLabel(label)

  if (!slug) {
    throw new Error('A custom capability label must contain at least one alphanumeric character.')
  }
  return `custom:${slug}`
}

export function createModelRouteId(randomId = globalThis.crypto.randomUUID()): string {
  if (!/^[A-Za-z0-9-]+$/.test(randomId)) {
    throw new Error('A generated route identifier must contain only letters, numbers, or hyphens.')
  }
  return `route:${randomId}`
}

export function createEmptyModelRoutingPolicy(
  updatedAt = new Date().toISOString(),
): ModelRoutingPolicy {
  return {
    schemaVersion: MODEL_ROUTING_SCHEMA_VERSION,
    policyProfile: MODEL_ROUTING_POLICY_PROFILE,
    producer: {
      productName: 'FindMnemo',
      productId: 'findmnemo',
    },
    catalogVersion: MODEL_ROUTING_CATALOG_VERSION,
    updatedAt,
    routes: [],
    capabilities: BUILT_IN_ROUTING_CAPABILITIES.map((capability) => ({ ...capability })),
    defaultRouteOrder: [],
    capabilityOverrides: [],
  }
}

export function validateModelRoutingPolicy(input: unknown): ModelRoutingValidationResult {
  const issues: ModelRoutingValidationIssue[] = []
  scanForCredentials(input, '$', issues)

  const policy = requireRecord(input, '$', issues)
  if (!policy) return { valid: false, issues }

  checkUnknownKeys(policy, TOP_LEVEL_KEYS, '$', issues)
  if (policy.schemaVersion !== MODEL_ROUTING_SCHEMA_VERSION) {
    addIssue(issues, 'unsupported-schema-version', '$.schemaVersion', 'Routing policy schema version is not supported.')
  }
  if (policy.policyProfile !== MODEL_ROUTING_POLICY_PROFILE) {
    addIssue(issues, 'unsupported-policy-profile', '$.policyProfile', 'Routing policy profile is not supported.')
  }
  if (policy.catalogVersion !== MODEL_ROUTING_CATALOG_VERSION) {
    addIssue(issues, 'unsupported-catalog-version', '$.catalogVersion', 'Routing capability catalog version is not supported.')
  }

  const producer = requireRecord(policy.producer, '$.producer', issues)
  if (producer) {
    checkUnknownKeys(producer, PRODUCER_KEYS, '$.producer', issues)
    if (producer.productName !== 'FindMnemo') {
      addIssue(issues, 'invalid-producer', '$.producer.productName', 'Routing policy producer name must be FindMnemo.')
    }
    if (producer.productId !== 'findmnemo') {
      addIssue(issues, 'invalid-producer', '$.producer.productId', 'Routing policy producer ID must be findmnemo.')
    }
  }
  checkTimestamp(policy.updatedAt, '$.updatedAt', issues)

  const capabilityIds: string[] = []
  if (!Array.isArray(policy.capabilities)) {
    addIssue(issues, 'invalid-array', '$.capabilities', 'Expected an array.')
  } else {
    policy.capabilities.forEach((capability, index) => {
      const id = validateCapability(capability, index, issues)
      if (id !== undefined) capabilityIds.push(id)
    })
  }
  checkDuplicates(capabilityIds, 'duplicate-capability-id', '$.capabilities', issues)
  const capabilityIdSet = new Set(capabilityIds)

  BUILT_IN_ROUTING_CAPABILITIES.forEach((builtIn) => {
    if (!capabilityIdSet.has(builtIn.id)) {
      addIssue(
        issues,
        'missing-built-in-capability',
        '$.capabilities',
        `Required built-in capability ${builtIn.id} is missing.`,
      )
    }
  })

  if (Array.isArray(policy.capabilities)) {
    policy.capabilities.forEach((value, index) => {
      if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return
      const equivalentBuiltInId = findEquivalentBuiltInRoutingCapabilityId(value.label)
      if (equivalentBuiltInId && value.id !== equivalentBuiltInId) {
        addIssue(
          issues,
          'equivalent-capability-collision',
          `$.capabilities[${index}].label`,
          `Capability is equivalent to ${equivalentBuiltInId}; reuse that stable ID or choose a distinct label.`,
        )
      }
    })
  }

  const routes: Array<{ id?: string; enabled: boolean; capabilityIds: string[] }> = []
  if (!Array.isArray(policy.routes)) {
    addIssue(issues, 'invalid-array', '$.routes', 'Expected an array.')
  } else {
    policy.routes.forEach((route, index) => routes.push(validateRoute(route, index, issues)))
  }
  const routeIds = routes.flatMap((route) => route.id === undefined ? [] : [route.id])
  checkDuplicates(routeIds, 'duplicate-route-id', '$.routes', issues)
  const routeIdSet = new Set(routeIds)

  routes.forEach((route, routeIndex) => {
    route.capabilityIds.forEach((capabilityId, capabilityIndex) => {
      if (!capabilityIdSet.has(capabilityId)) {
        addIssue(
          issues,
          'dangling-capability-reference',
          `$.routes[${routeIndex}].capabilityIds[${capabilityIndex}]`,
          'Route references an unknown capability.',
        )
      }
    })
  })

  const defaultRouteOrder = requireStringArray(policy.defaultRouteOrder, '$.defaultRouteOrder', issues)
  checkDuplicates(defaultRouteOrder, 'duplicate-order-entry', '$.defaultRouteOrder', issues)
  defaultRouteOrder.forEach((routeId, index) => {
    if (!routeIdSet.has(routeId)) {
      addIssue(issues, 'dangling-route-reference', `$.defaultRouteOrder[${index}]`, 'Order references an unknown route.')
    }
  })
  const defaultOrderSet = new Set(defaultRouteOrder)
  routes.forEach((route, index) => {
    if (route.enabled && route.id !== undefined && !defaultOrderSet.has(route.id)) {
      addIssue(issues, 'enabled-route-not-ordered', `$.routes[${index}].id`, 'Enabled route must appear in the default route order.')
    }
  })

  const overrideCapabilityIds: string[] = []
  if (!Array.isArray(policy.capabilityOverrides)) {
    addIssue(issues, 'invalid-array', '$.capabilityOverrides', 'Expected an array.')
  } else {
    policy.capabilityOverrides.forEach((value, index) => {
      const path = `$.capabilityOverrides[${index}]`
      const override = requireRecord(value, path, issues)
      if (!override) return

      checkUnknownKeys(override, OVERRIDE_KEYS, path, issues)
      const capabilityId = requireStableId(override.capabilityId, `${path}.capabilityId`, issues)
      if (capabilityId !== undefined) {
        overrideCapabilityIds.push(capabilityId)
        if (!capabilityIdSet.has(capabilityId)) {
          addIssue(issues, 'dangling-capability-reference', `${path}.capabilityId`, 'Override references an unknown capability.')
        }
      }

      const routeOrder = requireStringArray(override.routeOrder, `${path}.routeOrder`, issues)
      checkDuplicates(routeOrder, 'duplicate-order-entry', `${path}.routeOrder`, issues)
      routeOrder.forEach((routeId, routeIndex) => {
        if (!routeIdSet.has(routeId)) {
          addIssue(issues, 'dangling-route-reference', `${path}.routeOrder[${routeIndex}]`, 'Override references an unknown route.')
        }
      })
    })
  }
  checkDuplicates(overrideCapabilityIds, 'duplicate-capability-override', '$.capabilityOverrides', issues)

  if (issues.length > 0) return { valid: false, issues }
  return { valid: true, issues, policy: input as ModelRoutingPolicy }
}

function ticketInferenceText(ticket: Ticket): string {
  const parts: string[] = [
    ticket.title,
    ticket.description,
    ticket.generatedKind ?? '',
    ticket.sddGate ?? '',
    ticket.sddSpecId ?? '',
    ticket.delivers ?? '',
    ...ticket.artifacts.flatMap((artifact) => [artifact.type, artifact.label]),
    ...(ticket.acceptanceCriteria ?? []).map((criterion) => criterion.text),
    ...(ticket.verificationChecks ?? []).flatMap((check) => [check.commandOrCheck, check.expected ?? '']),
  ]

  if (ticket.review) {
    parts.push(
      ticket.review.spec.verdict,
      ticket.review.standards.verdict,
      ...ticket.review.spec.findings.map((finding) => finding.message),
      ...ticket.review.standards.findings.map((finding) => finding.message),
    )
  }

  return parts.join('\n').toLowerCase()
}

export function inferRequiredCapabilities(ticket: Ticket): RoutingCapabilityInferenceResult {
  const searchableText = ticketInferenceText(ticket)
  const capabilityIds: string[] = []
  const matchedRuleIds: string[] = []

  for (const rule of ROUTING_INFERENCE_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(searchableText))) continue
    matchedRuleIds.push(rule.id)
    if (!capabilityIds.includes(rule.capabilityId)) capabilityIds.push(rule.capabilityId)
  }

  return {
    capabilityIds,
    matchedRuleIds,
    ruleVersion: ROUTING_INFERENCE_RULE_VERSION,
  }
}

export function buildEffectiveRouteOrder(
  policy: ModelRoutingPolicy,
  requiredCapabilityIds: string[],
): { routeOrder: string[]; appliedOverrideCapabilityIds: string[] } {
  const required = new Set(requiredCapabilityIds)
  const appliedOverrides = policy.capabilityOverrides.filter((override) => required.has(override.capabilityId))
  const routeOrder: string[] = []

  for (const routeId of [
    ...appliedOverrides.flatMap((override) => override.routeOrder),
    ...policy.defaultRouteOrder,
  ]) {
    if (!routeOrder.includes(routeId)) routeOrder.push(routeId)
  }

  return {
    routeOrder,
    appliedOverrideCapabilityIds: appliedOverrides.map((override) => override.capabilityId),
  }
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

export function recommendModelRoute(
  input: ModelRoutingRecommendationInput,
): RoutingRecommendationResult {
  const validation = validateModelRoutingPolicy(input.policy)
  const policyRevision = validation.valid
    ? getModelRoutingPolicyRevision(input.policy)
    : typeof input.policy?.updatedAt === 'string' ? input.policy.updatedAt : 'unknown'
  const requiredCapabilityIds = uniqueStrings(input.requiredCapabilityIds)

  if (!validation.valid) {
    return {
      status: 'invalid-policy',
      policyRevision,
      requiredCapabilityIds,
      effectiveRouteOrder: [],
      appliedOverrideCapabilityIds: [],
      exactMatchRouteIds: [],
      partialMatches: [],
      exclusions: [],
      validationIssues: validation.issues,
    }
  }

  const { routeOrder, appliedOverrideCapabilityIds } = buildEffectiveRouteOrder(
    input.policy,
    requiredCapabilityIds,
  )
  if (requiredCapabilityIds.length === 0) {
    return {
      status: 'needs-capabilities',
      policyRevision,
      requiredCapabilityIds,
      effectiveRouteOrder: routeOrder,
      appliedOverrideCapabilityIds,
      exactMatchRouteIds: [],
      partialMatches: [],
      exclusions: [],
    }
  }

  const routeRank = new Map(routeOrder.map((routeId, index) => [routeId, index]))
  const routeById = new Map(input.policy.routes.map((route) => [route.id, route]))
  const exactMatchRouteIds: string[] = []
  const partialMatches: RoutingRecommendationResult['partialMatches'] = []
  const exclusions: RoutingRecommendationResult['exclusions'] = []

  for (const route of input.policy.routes) {
    const supportedCapabilityIds = requiredCapabilityIds.filter((capabilityId) => route.capabilityIds.includes(capabilityId))
    const missingCapabilityIds = requiredCapabilityIds.filter((capabilityId) => !route.capabilityIds.includes(capabilityId))
    const reasons: RoutingRecommendationResult['exclusions'][number]['reasons'] = []
    if (!route.enabled) reasons.push('disabled')
    if (route.availability.state !== 'available') reasons.push('unavailable')
    if (missingCapabilityIds.length > 0) reasons.push('missing-capability')
    if (!routeRank.has(route.id)) reasons.push('not-ordered')

    if (reasons.length === 0) {
      exactMatchRouteIds.push(route.id)
    } else {
      exclusions.push({ routeId: route.id, reasons })
    }

    if (
      route.enabled
      && route.availability.state === 'available'
      && routeRank.has(route.id)
      && supportedCapabilityIds.length > 0
      && missingCapabilityIds.length > 0
    ) {
      partialMatches.push({ routeId: route.id, supportedCapabilityIds, missingCapabilityIds })
    }
  }

  exactMatchRouteIds.sort((left, right) => (routeRank.get(left) ?? Infinity) - (routeRank.get(right) ?? Infinity))
  partialMatches.sort((left, right) => {
    const coverageDifference = right.supportedCapabilityIds.length - left.supportedCapabilityIds.length
    if (coverageDifference !== 0) return coverageDifference
    const rankDifference = (routeRank.get(left.routeId) ?? Infinity) - (routeRank.get(right.routeId) ?? Infinity)
    if (rankDifference !== 0) return rankDifference
    return left.routeId.localeCompare(right.routeId)
  })

  const orderedExactMatches = exactMatchRouteIds.filter((routeId) => routeById.has(routeId))
  return {
    status: orderedExactMatches.length > 0 ? 'exact-match' : 'no-match',
    policyRevision,
    requiredCapabilityIds,
    effectiveRouteOrder: routeOrder,
    appliedOverrideCapabilityIds,
    recommendedRouteId: orderedExactMatches[0],
    exactMatchRouteIds: orderedExactMatches,
    partialMatches,
    exclusions,
  }
}

interface RoutingDecisionInput {
  result: RoutingRecommendationResult
  ticketId: string
  currentPolicyRevision: string
  decidedAt?: string
  decisionId?: string
}

interface RoutingOverrideInput extends RoutingDecisionInput {
  routeId: string
  explicitlyConfirmed: boolean
}

function assertCurrentResult(result: RoutingRecommendationResult, currentPolicyRevision: string) {
  if (result.policyRevision !== currentPolicyRevision) {
    throw new Error('Routing recommendation is stale because the policy revision changed.')
  }
}

function createRoutingDecisionId(): string {
  return `routing-decision:${globalThis.crypto.randomUUID()}`
}

export function confirmRoutingRecommendation(input: RoutingDecisionInput): RoutingDecisionRecord {
  assertCurrentResult(input.result, input.currentPolicyRevision)
  if (input.result.status !== 'exact-match' || !input.result.recommendedRouteId) {
    throw new Error('Only an exact routing recommendation can be confirmed.')
  }

  return {
    id: input.decisionId ?? createRoutingDecisionId(),
    ticketId: input.ticketId,
    routeId: input.result.recommendedRouteId,
    decisionType: 'exact-confirmation',
    requiredCapabilityIds: [...input.result.requiredCapabilityIds],
    missingCapabilityIds: [],
    policyRevision: input.result.policyRevision,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  }
}

export function overridePartialRoute(input: RoutingOverrideInput): RoutingDecisionRecord {
  assertCurrentResult(input.result, input.currentPolicyRevision)
  if (!input.explicitlyConfirmed) {
    throw new Error('A partial routing override requires explicit confirmation.')
  }
  if (input.result.status !== 'no-match') {
    throw new Error('A partial routing override is only valid for a no-match result.')
  }

  const partialMatch = input.result.partialMatches.find((match) => match.routeId === input.routeId)
  if (!partialMatch) {
    throw new Error('The selected route is not a partial match in this routing result.')
  }

  return {
    id: input.decisionId ?? createRoutingDecisionId(),
    ticketId: input.ticketId,
    routeId: partialMatch.routeId,
    decisionType: 'partial-override',
    requiredCapabilityIds: [...input.result.requiredCapabilityIds],
    missingCapabilityIds: [...partialMatch.missingCapabilityIds],
    policyRevision: input.result.policyRevision,
    decidedAt: input.decidedAt ?? new Date().toISOString(),
  }
}

export function isModelRouteTarget(value: unknown): value is ModelRouteTarget {
  const policy = createEmptyModelRoutingPolicy()
  policy.routes = [value as ModelRouteTarget]
  if (isRecord(value) && typeof value.id === 'string') policy.defaultRouteOrder = [value.id]
  if (isRecord(value) && Array.isArray(value.capabilityIds)) {
    const missingCapabilities = value.capabilityIds
      .filter((id): id is string => typeof id === 'string')
      .filter((id) => !policy.capabilities.some((capability) => capability.id === id))
    policy.capabilities.push(...missingCapabilities.map((id) => ({
      id,
      family: 'custom' as const,
      label: id,
      description: 'Route-local capability definition.',
      origin: 'imported' as const,
    })))
  }
  return validateModelRoutingPolicy(policy).valid
}
