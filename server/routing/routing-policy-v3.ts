import type { OperationalPolicyV3MigrationPreview, OperationalRoutingPolicy, OperationalRoutingPolicyV3, RoutingConnectionDto, RoutingProfileV3, WorkTypeAssignmentDto } from '../../shared/companion-contract.js'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/
const EXECUTABLE_ADAPTERS = new Set(['pi-rpc', 'codex-cli', 'claude-code-cli', 'ollama-local', 'openrouter'])

export interface RoutingPolicyV3ValidationResult { valid: boolean; issues: string[]; policy?: OperationalRoutingPolicyV3 }

export function validateRoutingPolicyV3(input: unknown, connections: readonly RoutingConnectionDto[]): RoutingPolicyV3ValidationResult {
  const issues: string[] = []
  if (!isRecord(input)) return { valid: false, issues: ['invalid-policy'] }
  const policy = input as unknown as OperationalRoutingPolicyV3
  if (policy.schemaVersion !== '3.0.0' || policy.policyProfile !== 'findmnemo.model-routing.v3') issues.push('unsupported-policy')
  if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 0 || !Number.isFinite(Date.parse(policy.updatedAt))) issues.push('invalid-version')
  if (!Array.isArray(policy.capabilities) || !Array.isArray(policy.profiles) || !Array.isArray(policy.assignments)) return { valid: false, issues: [...issues, 'invalid-collections'] }
  const connectionIds = new Set(connections.map((connection) => connection.id))
  const profileIds = policy.profiles.map((profile) => profile.id)
  if (new Set(profileIds).size !== profileIds.length) issues.push('duplicate-profile')
  for (const profile of policy.profiles) {
    if (!SAFE_ID.test(profile.id) || !profile.displayName.trim() || !profile.modelId.trim()) issues.push(`invalid-profile:${profile.id}`)
    if (profile.kind === 'legacy-manual') {
      if (profile.enabled || profile.connectionId !== null) issues.push(`legacy-profile-active:${profile.id}`)
    } else if (!profile.connectionId || !connectionIds.has(profile.connectionId)) issues.push(`missing-connection:${profile.id}`)
  }
  const capabilityIds = policy.capabilities.map((capability) => capability.id)
  const assignmentIds = policy.assignments.map((assignment) => assignment.capabilityId)
  if (new Set(assignmentIds).size !== assignmentIds.length) issues.push('duplicate-assignment')
  const requiredAssignments = new Set(['default', ...capabilityIds])
  if (assignmentIds.some((id) => !requiredAssignments.has(id)) || [...requiredAssignments].some((id) => !assignmentIds.includes(id))) issues.push('assignment-coverage')
  for (const assignment of policy.assignments) {
    if (!['ask-before-send', 'send-automatically'].includes(assignment.behavior) || new Set(assignment.profileOrder).size !== assignment.profileOrder.length || assignment.profileOrder.some((id) => !profileIds.includes(id) || policy.profiles.find((profile) => profile.id === id)?.kind === 'legacy-manual')) issues.push(`invalid-assignment:${assignment.capabilityId}`)
  }
  return issues.length ? { valid: false, issues } : { valid: true, issues, policy }
}

export function migratePolicyV2ToV3(policy: OperationalRoutingPolicy, sourcePolicyRevision: string): { preview: OperationalPolicyV3MigrationPreview; connections: RoutingConnectionDto[] } {
  const connections: RoutingConnectionDto[] = []
  const connectionByInstance = new Map<string, RoutingConnectionDto>()
  const disabledLegacyProfileIds: string[] = []
  const profiles: RoutingProfileV3[] = policy.profiles.map((profile) => {
    const executable = EXECUTABLE_ADAPTERS.has(profile.destinationAdapterId) && profile.destinationAdapterId !== 'manual'
    if (!executable) {
      disabledLegacyProfileIds.push(profile.id)
      return { id: profile.id, displayName: profile.displayName, kind: 'legacy-manual', connectionId: null, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort, readiness: { ...profile.readiness, state: 'unsupported', reasonCode: 'LEGACY_MANUAL_ROUTE' }, enabled: false }
    }
    let connection = connectionByInstance.get(profile.destinationInstanceId)
    if (!connection) {
      const adapterId = profile.destinationAdapterId as RoutingConnectionDto['adapterId']
      connection = { id: connectionId(profile.destinationInstanceId), adapterId, displayName: profile.destinationInstanceId, enabled: false, authMode: authMode(adapterId), authState: 'unchecked', installedVersion: profile.readiness.installedVersion, supportedRange: null, readinessCheckedAt: profile.readiness.checkedAt, catalogRefreshedAt: null, config: {}, secretRef: null }
      connectionByInstance.set(profile.destinationInstanceId, connection)
      connections.push(connection)
    }
    return { id: profile.id, displayName: profile.displayName, kind: 'executable', connectionId: connection.id, providerId: profile.providerId, modelId: profile.modelId, effort: profile.effort, readiness: profile.readiness, enabled: false }
  })
  const orderFor = (capabilityId: string) => policy.capabilityOverrides.find((override) => override.capabilityId === capabilityId)?.profileOrder ?? policy.defaultProfileOrder
  const assignment = (capabilityId: string): WorkTypeAssignmentDto => {
    const order = orderFor(capabilityId).filter((id) => profiles.find((profile) => profile.id === id)?.kind === 'executable')
    const firstV2 = policy.profiles.find((profile) => profile.id === order[0])
    return { capabilityId, profileOrder: order, behavior: firstV2?.behavior === 'auto-exact' ? 'send-automatically' : 'ask-before-send' }
  }
  const assignments = [assignment('default'), ...policy.capabilities.map((capability) => assignment(capability.id))]
  return { preview: { sourcePolicyRevision, disabledLegacyProfileIds, policy: { schemaVersion: '3.0.0', policyProfile: 'findmnemo.model-routing.v3', policyVersion: 0, updatedAt: policy.updatedAt, capabilities: policy.capabilities, profiles, assignments } }, connections }
}

function connectionId(instanceId: string): string { return `connection:${instanceId.replace(/[^A-Za-z0-9:._/-]/g, '-').slice(0, 100)}` }
function authMode(adapterId: RoutingConnectionDto['adapterId']): RoutingConnectionDto['authMode'] { return adapterId === 'ollama-local' ? 'local-runtime' : adapterId === 'openrouter' ? 'companion-oauth' : 'tool-owned' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
