export type LLMSource = 'Pi' | 'Codex' | 'Claude Cowork'

export type View = 'operations' | 'brief' | 'tickets' | 'routing' | 'usage' | 'analytics' | 'emails' | 'settings'

export type PrimaryArea = 'my-day' | 'next-actions' | 'engines' | 'metrics' | 'outreach'

export type HomeView = Extract<View, 'operations' | 'brief'>

export type MetricsView = Extract<View, 'usage' | 'analytics'>

export type AttentionItemKind = 'ticket' | 'gmail' | 'source'

export type AttentionBucket = 'needs-action' | 'waiting' | 'recently-resolved'

export type AttentionPriority = 'critical' | 'high' | 'normal' | 'low'

export type AttentionTruthState = 'current' | 'stale' | 'partial' | 'disconnected' | 'unverified' | 'fictional'

export type AttentionActionKind =
  | 'open-ticket'
  | 'change-status'
  | 'review-gmail'
  | 'choose-ticket'
  | 'retry-source'
  | 'run-sync'
  | 'review-receipt'
  | 'open-artifact'
  | 'none'

export interface AttentionAction {
  id: string
  kind: AttentionActionKind
  label: string
  recordRef: string
  targetStatus?: TicketStatus
  disabledReason?: string
}

export interface AttentionEvidenceRef {
  label: string
  value?: string
  state?: 'available' | 'missing' | 'unavailable'
}

export interface AttentionEvidence {
  availability: 'available' | 'partial' | 'missing' | 'required-missing'
  refs: AttentionEvidenceRef[]
  blockers: Array<{ id: string; state: 'resolved' | 'unresolved' | 'missing' }>
  receiptIds: string[]
  reasonCodes: string[]
  rollbackRefs?: AttentionEvidenceRef[]
}

export interface AttentionItem {
  id: string
  kind: AttentionItemKind
  recordRef: string
  title: string
  summary: string
  sourceLabel: string
  ownerLabel?: string
  bucket: AttentionBucket
  priority: AttentionPriority
  priorityReason: string
  truthState: AttentionTruthState
  updatedAt?: string
  evidence: AttentionEvidence
  primaryAction: AttentionAction
  secondaryActions: AttentionAction[]
}

export interface AttentionSourceStatus {
  id: string
  label: string
  enabled?: boolean
  truthState: AttentionTruthState
  detail: string
  lastSuccessAt?: string
  recoveryAction?: 'retry-source' | 'open-settings'
}

export interface AttentionDayStatus {
  queued: number
  resolved: number
  progress: number | null
  label: string
}

export interface AttentionWorkspaceProjection {
  items: AttentionItem[]
  sources: AttentionSourceStatus[]
  dayStatus: AttentionDayStatus
}

export type TicketStatus = 'todo' | 'in-progress' | 'done' | 'blocked'

export type GateType = 'one-way' | 'two-way'

export type Reversibility = 'high' | 'medium' | 'low'

export type AgentState = 'idle' | 'working' | 'waiting' | 'error'

export type TicketOrigin = 'demo' | 'browser-ui' | 'agent-runtime' | 'imported' | 'local-bridge' | 'registry-sync'

export type GeneratedTicketKind = 'sdd-gate-placeholder' | 'sdd-task-execution' | 'manual'

export type KnowledgeEntryKind = 'fact' | 'assumption' | 'decision' | 'preference' | 'open-question'

export type FogItemType = 'research' | 'prototype' | 'grilling' | 'task'

export type FogItemState = 'frontier' | 'blocked' | 'not-yet-specified'

export type ReadinessState = 'ready' | 'blocked' | 'done'

export type SddGate =
  | 'uninitialized'
  | 'requirements:draft'
  | 'requirements:approved'
  | 'design:draft'
  | 'design:approved'
  | 'tasks:draft'
  | 'tasks:approved'
  | 'implementation:in-progress'
  | 'implementation:done'
  | 'review:done'
  | 'invalid-status'
  | 'stale-path'

export type ReviewAxis = 'Spec' | 'Standards'

export type ReviewVerdict = 'approved' | 'approved-with-follow-ups' | 'needs-fixes'

export type SmellTag =
  | 'mysterious-name'
  | 'duplicated-code'
  | 'feature-envy'
  | 'data-clumps'
  | 'primitive-obsession'
  | 'repeated-switches'
  | 'shotgun-surgery'
  | 'divergent-change'
  | 'speculative-generality'
  | 'message-chains'
  | 'middle-man'
  | 'refused-bequest'

export type AiReceiptOutcome = 'proposed' | 'verified' | 'accepted' | 'rejected' | 'superseded'

export type HumanReceiptDisposition = 'accepted' | 'rejected' | 'needs-follow-up'

export type HumanActivityKind =
  | 'human-requested-work'
  | 'human-approved-requirements'
  | 'human-approved-design'
  | 'human-approved-tasks'
  | 'human-rejected-output'
  | 'human-verified-artifact'
  | 'human-accepted-ai-receipt'
  | 'human-overrode-status'

export interface DecisionLogEntry {
  id: string
  timestamp: string
  decision: string
  reasoning: string
  gateType: GateType
  reversibility: Reversibility
  kind?: KnowledgeEntryKind
  evidenceRefs?: string[]
}

export interface Artifact {
  id: string
  type: 'commit' | 'pr' | 'file' | 'url' | 'research-note' | 'prototype' | 'spike' | 'source' | 'verification-evidence'
  label: string
  url?: string
  createdAt: string
  status?: 'available' | 'missing' | 'unavailable'
}

export interface WorkNote {
  id: string
  text: string
  createdAt: string
  kind?: KnowledgeEntryKind
  evidenceRefs?: string[]
}

export interface ChecklistItem {
  id: string
  text: string
  checked: boolean
}

export interface VerificationCheck {
  id: string
  commandOrCheck: string
  expected?: string
  result?: 'passed' | 'failed' | 'not-run'
  evidenceRef?: string
}

export interface FogMapItem {
  id: string
  type: FogItemType
  state: FogItemState
  text: string
  blockedBy?: string[]
  evidenceRefs?: string[]
}

export interface FogMap {
  destination: string
  decisionsSoFar: string[]
  items: FogMapItem[]
  outOfScope: string[]
}

export interface ExpandContractPhase {
  id: string
  label: string
  status: 'pending' | 'in-progress' | 'done' | 'blocked'
  verificationChecks?: VerificationCheck[]
}

export interface ExpandContractPlan {
  expand: ExpandContractPhase[]
  migrate: ExpandContractPhase[]
  contract: ExpandContractPhase[]
}

export interface ExecutionEvidence {
  testSeam?: string
  firstFailingCheck?: VerificationCheck
  passingCheck?: VerificationCheck
  refactorNote?: string
  finalVerification?: VerificationCheck
}

export interface ReviewFinding {
  id: string
  axis: ReviewAxis
  severity: 'info' | 'warning' | 'blocker'
  message: string
  refs?: string[]
  smellTags?: SmellTag[]
}

export interface ReviewAxisRecord {
  verdict: ReviewVerdict
  findings: ReviewFinding[]
}

export interface ReviewRecord {
  spec: ReviewAxisRecord
  standards: ReviewAxisRecord
  reviewedAt?: string
  reviewer?: string
}

export interface ArtifactRef {
  label: string
  kind: string
  ref: string
  visibility: 'public' | 'local-only' | 'redacted'
}

export interface AiReceipt {
  id: string
  ticketId?: string
  projectProgressId?: string
  agentSource: LLMSource | 'FindMnemo' | string
  modelOrSurface?: string
  request: string
  summary: string
  actionsTaken: Array<{ label: string; artifactRef?: string; telemetryEventId?: string }>
  artifactRefs: ArtifactRef[]
  verification: Array<{ commandOrCheck: string; result: 'passed' | 'failed' | 'not-run'; evidenceRef?: string }>
  facts: string[]
  assumptions: string[]
  decisions: string[]
  recommendations: string[]
  openQuestions: string[]
  outcome: AiReceiptOutcome
  humanDisposition?: HumanReceiptDisposition
  createdAt: string
}

export interface HumanActivityCommand {
  activity: HumanActivityKind
  ticketId?: string
  projectProgressId?: string
  receiptId?: string
  note?: string
  artifactRefs?: Array<{ label: string; ref: string }>
}

export interface ProjectProgressArtifactRef {
  label: string
  path: string
  kind: 'requirements' | 'design' | 'tasks' | 'review' | 'status' | 'steering'
}

export interface ProjectProgressIssue {
  severity: 'info' | 'warning' | 'blocker'
  message: string
}

export interface ProjectProgressItem {
  id: string
  projectId: string
  projectName: string
  specId?: string
  specTitle?: string
  currentGate: SddGate
  nextSafeAction: string
  artifactRefs: ProjectProgressArtifactRef[]
  canonicalPath?: string
  pathVisibility: 'hidden' | 'local-only' | 'visible'
  origin: 'registry-sync'
  lastScannedAt: string
  issues: ProjectProgressIssue[]
}

export interface SddTaskExecutionTicketSeed {
  id: string
  projectProgressId: string
  projectId: string
  specId: string
  taskId: string
  title: string
  description: string
  delivers?: string
  acceptanceCriteria: ChecklistItem[]
  verificationChecks: VerificationCheck[]
  blockedBy: string[]
  artifactRefs: ProjectProgressArtifactRef[]
  generatedAt?: string
}

export interface Ticket {
  id: string
  title: string
  description: string
  source: LLMSource
  status: TicketStatus
  workNotes: WorkNote[]
  artifacts: Artifact[]
  decisionLog: DecisionLogEntry[]
  createdAt: string
  updatedAt: string
  completedAt?: string | null
  origin?: TicketOrigin
  generatedKind?: GeneratedTicketKind
  projectProgressId?: string
  sddSpecId?: string
  sddGate?: SddGate
  blockedBy?: string[]
  delivers?: string
  acceptanceCriteria?: ChecklistItem[]
  verificationChecks?: VerificationCheck[]
  fogMap?: FogMap
  expandContractPlan?: ExpandContractPlan
  executionEvidence?: ExecutionEvidence
  review?: ReviewRecord
  receiptRequired?: boolean
  receiptIds?: string[]
  activityState?: 'active' | 'waiting' | 'blocked' | 'needs-action' | 'completed' | 'failed' | 'cancelled'
  projectId?: string | null
  projectMappingState?: 'approved-project' | 'unassigned' | 'needs-review'
  summaryOwner?: 'source' | 'human'
  projectOwner?: 'source' | 'human'
}

export interface AgentActivity {
  id: string
  agent: LLMSource
  state: AgentState
  currentTask: string
  lastActive: string
  sessionId?: string
}

export type TelemetryActorType = 'human' | 'agent' | 'system' | 'service-account' | 'external'

export type TelemetryActivityType =
  | 'intake'
  | 'extract'
  | 'validate'
  | 'decide'
  | 'review'
  | 'execute'
  | 'handoff'
  | 'reconcile'
  | 'close'
  | 'other'

export interface WorkTelemetryEvent {
  eventId: string
  caseId: string
  traceId?: string
  parentEventId?: string
  timestamp: string
  sequence: number
  intent?: string
  activity: {
    id: string
    label: string
    type: TelemetryActivityType
    primitiveVersion?: string
  }
  transition?: {
    fromState?: string
    toState?: string
  }
  actor: {
    id: string
    label: string
    type: TelemetryActorType
    role?: string
    authorityLevel?: number
  }
  objects?: Array<{
    id: string
    type: string
    role: 'input' | 'output' | 'subject' | 'evidence'
    sourceRef?: string
    classification?: string
  }>
  decision?: {
    id: string
    selectedPath: string
    rationale?: string
    decidingAuthority?: string
  }
  result: {
    status: 'success' | 'failure' | 'exception' | 'retry' | 'rollback' | 'cancelled'
    reasonCode?: string
    message?: string
  }
  evidence?: Array<{
    id: string
    sourceRef: string
    label?: string
    classification?: string
  }>
  acceptedOutcome?: boolean
  truthState: 'observed' | 'inferred' | 'user-confirmed' | 'overridden'
  provenance: {
    sourceType: 'mnemosync'
    sourceRef: string
    ingestedAt: string
    transformation?: string
  }
  tags?: string[]
}

export interface WorkTelemetryCollection {
  schemaVersion: '1.0.0'
  exportedAt: string
  events: WorkTelemetryEvent[]
}

export type RoutingCapabilityFamily =
  | 'orchestration'
  | 'review'
  | 'creation'
  | 'engineering'
  | 'research-analysis'
  | 'custom'

export type RoutingCapabilityOrigin = 'built-in' | 'custom' | 'imported'

export interface RoutingCapabilityDefinition {
  id: string
  family: RoutingCapabilityFamily
  label: string
  description: string
  origin: RoutingCapabilityOrigin
}

export type ModelRouteKind = 'hosted' | 'local' | 'agent-surface' | 'custom'

export type ModelRouteAvailabilityState = 'available' | 'unavailable'

export interface ModelRouteAvailability {
  state: ModelRouteAvailabilityState
  confirmedAt: string
}

export interface ModelRouteTarget {
  id: string
  displayName: string
  provider: string
  model: string
  surface: string
  kind: ModelRouteKind
  enabled: boolean
  availability: ModelRouteAvailability
  capabilityIds: string[]
}

export interface ModelRoutingCapabilityOverride {
  capabilityId: string
  routeOrder: string[]
}

export interface ModelRoutingPolicy {
  schemaVersion: '1.0.0'
  policyProfile: 'findmnemo.model-routing.v1'
  producer: {
    productName: 'FindMnemo'
    productId: 'findmnemo'
  }
  catalogVersion: '1.0.0'
  updatedAt: string
  routes: ModelRouteTarget[]
  capabilities: RoutingCapabilityDefinition[]
  defaultRouteOrder: string[]
  capabilityOverrides: ModelRoutingCapabilityOverride[]
}

export interface ModelRoutingValidationIssue {
  code: string
  path: string
  message: string
}

export interface ModelRoutingValidationResult {
  valid: boolean
  issues: ModelRoutingValidationIssue[]
  policy?: ModelRoutingPolicy
}

export interface RoutingCapabilityInferenceResult {
  capabilityIds: string[]
  matchedRuleIds: string[]
  ruleVersion: '1.0.0'
}

export interface RoutingRequestContext {
  ticketId: string
  inferredCapabilityIds: string[]
  confirmedCapabilityIds: string[]
  inferenceRuleIds: string[]
  capabilityState: 'inferred' | 'user-confirmed'
}

export interface ModelRoutingRecommendationInput {
  policy: ModelRoutingPolicy
  requiredCapabilityIds: string[]
  currentRouteId?: string
}

export type ModelRoutingExclusionReason =
  | 'disabled'
  | 'unavailable'
  | 'missing-capability'
  | 'not-ordered'

export interface ModelRoutingPartialMatch {
  routeId: string
  supportedCapabilityIds: string[]
  missingCapabilityIds: string[]
}

export interface RoutingRecommendationResult {
  status: 'exact-match' | 'no-match' | 'needs-capabilities' | 'invalid-policy'
  policyRevision: string
  requiredCapabilityIds: string[]
  effectiveRouteOrder: string[]
  appliedOverrideCapabilityIds: string[]
  recommendedRouteId?: string
  exactMatchRouteIds: string[]
  partialMatches: ModelRoutingPartialMatch[]
  exclusions: Array<{
    routeId: string
    reasons: ModelRoutingExclusionReason[]
  }>
  validationIssues?: ModelRoutingValidationIssue[]
}

export type RoutingDecisionType = 'exact-confirmation' | 'partial-override'

export interface RoutingDecisionRecord {
  id: string
  ticketId: string
  routeId: string
  decisionType: RoutingDecisionType
  requiredCapabilityIds: string[]
  missingCapabilityIds: string[]
  policyRevision: string
  decidedAt: string
}

export interface ModelRoutingPolicyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ModelRoutingImportPreview {
  addedRouteIds: string[]
  removedRouteIds: string[]
  addedCapabilityIds: string[]
  removedCapabilityIds: string[]
  availabilityChanges: Array<{
    routeId: string
    from: ModelRouteAvailabilityState
    to: ModelRouteAvailabilityState
  }>
  defaultOrderChanged: boolean
  capabilityOverrideOrderChanged: boolean
}

export type ModelRoutingPolicyLoadResult =
  | { status: 'empty' | 'loaded'; policy: ModelRoutingPolicy }
  | { status: 'invalid'; issues: ModelRoutingValidationIssue[] }
  | { status: 'error'; code: 'storage-read-failed'; message: string }

export type ModelRoutingPolicySaveResult =
  | { status: 'saved'; policyRevision: string }
  | { status: 'invalid'; issues: ModelRoutingValidationIssue[] }
  | { status: 'error'; code: 'storage-write-failed'; message: string }

export type StagedModelRoutingPolicyImport =
  | {
      status: 'ready'
      policy: ModelRoutingPolicy
      preview: ModelRoutingImportPreview
    }
  | { status: 'invalid'; issues: ModelRoutingValidationIssue[] }

export type AppliedModelRoutingPolicyImport =
  | ModelRoutingPolicySaveResult
  | { status: 'invalid-stage'; message: string }

export type ModelRoutingPolicyExportResult =
  | { status: 'ready'; filename: string; json: string }
  | { status: 'invalid'; issues: ModelRoutingValidationIssue[] }
  | { status: 'error'; code: 'download-unavailable'; message: string }

export type {
  ActualRouteSnapshot,
  OperationalPolicyMigrationPreview,
  OperationalRoutingPolicy,
  OperationalRoutingValidationResult,
  RequestedProfileSnapshot,
  RoutingClassificationSource,
  RoutingExecutionProfile,
  RoutingPolicyValidationIssueDto,
  RoutingPreflightRequest,
  RoutingPreflightResult,
  RoutingPreflightStatus,
  RoutingProfileBehavior,
  RoutingProfileReadiness,
  RoutingReadinessState,
  RoutingRequestOverride,
} from '../shared/companion-contract'

export interface EmailThread {
  id: string
  subject: string
  from: string
  snippet: string
  needsResponse: boolean
  receivedAt: string
  messageId: string
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'done': 'Done',
  'blocked': 'Blocked',
}

export const SOURCE_COLORS: Record<LLMSource, string> = {
  'Pi': 'bg-purple-600',
  'Codex': 'bg-blue-600',
  'Claude Cowork': 'bg-amber-600',
}

export const SOURCE_BORDER_COLORS: Record<LLMSource, string> = {
  'Pi': 'border-purple-600',
  'Codex': 'border-blue-600',
  'Claude Cowork': 'border-amber-600',
}

/* Mid-500 hues stay legible on both the light canvas and the dark chrome. */
export const SOURCE_TEXT_COLORS: Record<LLMSource, string> = {
  'Pi': 'text-purple-500',
  'Codex': 'text-blue-500',
  'Claude Cowork': 'text-amber-500',
}

export const AGENT_STATE_COLORS: Record<AgentState, string> = {
  'idle': 'bg-slate-400',
  'working': 'bg-emerald-500',
  'waiting': 'bg-amber-500',
  'error': 'bg-red-500',
}

export const STATUS_ACCENTS: Record<TicketStatus, string> = {
  'todo': 'bg-sync',
  'in-progress': 'bg-memory',
  'done': 'bg-emerald-500',
  'blocked': 'bg-rose-500',
}

export const SOURCE_HEX: Record<LLMSource, string> = {
  'Pi': '#8b5cf6',
  'Codex': '#3b82f6',
  'Claude Cowork': '#d97706',
}
