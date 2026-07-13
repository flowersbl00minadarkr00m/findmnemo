import {
  PERSONAL_ONTOLOGY_SCHEMA_VERSION,
  validatePersonalOntologyBundle,
  type PersonalOntologyBundle,
  type PersonalOntologyActionDefinition,
  type PersonalOntologyEvidenceReference,
  type PersonalOntologyHandoffEnvelope,
  type PersonalOntologyLink,
  type PersonalOntologyObject,
  type PersonalOntologyTruthState,
} from '@henry/personal-ontology'
import type {
  AgentActivity,
  AiReceipt,
  EmailThread,
  ProjectProgressItem,
  Ticket,
  WorkTelemetryEvent,
} from '../types.ts'

const PROFILE = 'findmnemo.observed-work.v1' as const
const LEGACY_LOCAL_STORAGE_KEYS = [
  'mnemosync_tickets',
  'mnemosync_agent_activity',
  'mnemosync_emails',
  'mnemosync_work_events_v1',
  'mnemosync_project_progress_items',
] as const
const PROJECT_PROGRESS_KEY = 'mnemosync_project_progress_items'
const SUPPORTED_CONSUMERS = ['FlowSensa', 'OSSensa', 'SancusSight', 'LocalCFO'] as const
const HANDOFF_PROFILE = 'personal-ontology.handoff.v1' as const

export const FINDMNEMO_ACTION_HANDOFFS = [
  {
    id: 'track-implementation',
    label: 'Track implementation',
    mode: 'propose-only',
    requiredFields: ['title'],
    optionalFields: ['description', 'source', 'status', 'acceptanceCriteria'],
    confirmationRequired: true,
    resultDescription: 'Proposes a FindMnemo ticket for user review.',
    failureBehavior: 'Reject the complete handoff without creating a ticket or telemetry event.',
  },
  {
    id: 'attach-artifact',
    label: 'Attach artifact',
    mode: 'propose-only',
    requiredFields: ['ticketId', 'artifact'],
    optionalFields: ['note'],
    confirmationRequired: true,
    resultDescription: 'Proposes attaching one artifact to an existing FindMnemo ticket.',
    failureBehavior: 'Reject the complete handoff without changing the ticket or artifact list.',
  },
  {
    id: 'record-decision',
    label: 'Record decision',
    mode: 'propose-only',
    requiredFields: ['ticketId', 'decision'],
    optionalFields: ['reasoning', 'gateType', 'reversibility'],
    confirmationRequired: true,
    resultDescription: 'Proposes a decision-log entry for an existing FindMnemo ticket.',
    failureBehavior: 'Reject the complete handoff without changing the decision log.',
  },
  {
    id: 'close-loop',
    label: 'Close loop',
    mode: 'propose-only',
    requiredFields: ['ticketId'],
    optionalFields: ['summary', 'evidenceRefs'],
    confirmationRequired: true,
    resultDescription: 'Proposes closing a tracked loop after user review.',
    failureBehavior: 'Reject the complete handoff without changing ticket status or telemetry.',
  },
] as const satisfies readonly PersonalOntologyActionDefinition[]

export interface FindMnemoCompatibilityReport {
  currentProduct: { name: 'FindMnemo'; id: 'findmnemo' }
  legacyNames: string[]
  acceptedSourceTypes: string[]
  emittedSourceTypes: string[]
  legacyLocalStorageKeys: string[]
  legacyUriSchemes: string[]
  supportedConsumers: string[]
  exportLabel: 'Observed work export'
}

export interface FindMnemoHandoffValidationResult {
  valid: boolean
  issues: Array<{ path: string; message: string }>
  handoff?: PersonalOntologyHandoffEnvelope
}

export function createCompatibilityReport(sourceTypes: string[] = ['mnemosync']): FindMnemoCompatibilityReport {
  const normalizedSourceTypes = [...new Set(sourceTypes.length > 0 ? sourceTypes : ['mnemosync'])].sort()
  return {
    currentProduct: { name: 'FindMnemo', id: 'findmnemo' },
    legacyNames: ['MnemoSync', 'Mnemosync', 'mnemosync'],
    acceptedSourceTypes: normalizedSourceTypes,
    emittedSourceTypes: normalizedSourceTypes,
    legacyLocalStorageKeys: [...LEGACY_LOCAL_STORAGE_KEYS],
    legacyUriSchemes: ['mnemosync://'],
    supportedConsumers: [...SUPPORTED_CONSUMERS],
    exportLabel: 'Observed work export',
  }
}

export function validateFindMnemoHandoff(input: unknown): FindMnemoHandoffValidationResult {
  const issues: FindMnemoHandoffValidationResult['issues'] = []
  if (!isRecord(input)) return { valid: false, issues: [{ path: '$', message: 'Handoff must be an object.' }] }

  const allowedKeys = new Set([
    'schemaVersion', 'handoffProfile', 'sourceProduct', 'targetProduct', 'actionType',
    'summary', 'objectRefs', 'evidenceRefs', 'payload', 'confirmationRequired',
  ])
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) issues.push({ path: `$.${key}`, message: 'Field is not allowed.' })
  }
  if (input.schemaVersion !== PERSONAL_ONTOLOGY_SCHEMA_VERSION) issues.push({ path: '$.schemaVersion', message: 'Unsupported schema version.' })
  if (input.handoffProfile !== HANDOFF_PROFILE) issues.push({ path: '$.handoffProfile', message: 'Unsupported handoff profile.' })
  if (typeof input.sourceProduct !== 'string' || input.sourceProduct.trim() === '') issues.push({ path: '$.sourceProduct', message: 'Source product is required.' })
  if (input.targetProduct !== 'FindMnemo') issues.push({ path: '$.targetProduct', message: 'Target product must be FindMnemo.' })
  if (typeof input.summary !== 'string' || input.summary.trim() === '') issues.push({ path: '$.summary', message: 'Summary is required.' })
  if (!Array.isArray(input.objectRefs) || !input.objectRefs.every((value) => typeof value === 'string')) issues.push({ path: '$.objectRefs', message: 'Object references must be a string array.' })
  if (!Array.isArray(input.evidenceRefs) || !input.evidenceRefs.every((value) => typeof value === 'string')) issues.push({ path: '$.evidenceRefs', message: 'Evidence references must be a string array.' })
  if (input.confirmationRequired !== true) issues.push({ path: '$.confirmationRequired', message: 'User confirmation must be required.' })

  const definition = FINDMNEMO_ACTION_HANDOFFS.find((action) => action.id === input.actionType)
  if (!definition) issues.push({ path: '$.actionType', message: 'Action type is not supported.' })
  if (!isRecord(input.payload)) {
    issues.push({ path: '$.payload', message: 'Payload must be an object.' })
  } else if (definition) {
    for (const field of definition.requiredFields) {
      if (!(field in input.payload) || input.payload[field] === undefined || input.payload[field] === '') {
        issues.push({ path: `$.payload.${field}`, message: 'Required action field is missing.' })
      }
    }
    const allowedPayloadFields = new Set<string>([...definition.requiredFields, ...definition.optionalFields])
    for (const field of Object.keys(input.payload)) {
      if (!allowedPayloadFields.has(field)) issues.push({ path: `$.payload.${field}`, message: 'Field is not allowed for this action.' })
    }
  }

  if (issues.length > 0) return { valid: false, issues }
  return { valid: true, issues, handoff: input as unknown as PersonalOntologyHandoffEnvelope }
}

export interface ObservedWorkSources {
  tickets: Ticket[]
  telemetry: WorkTelemetryEvent[]
  agentActivity: AgentActivity[]
  emails: EmailThread[]
  receipts: AiReceipt[]
  projectProgress: ProjectProgressItem[]
}

export interface CreateObservedWorkExportOptions {
  includePrivateSummaries?: boolean
  includeRawTelemetry?: boolean
  exportedAt?: string
  sources?: Partial<ObservedWorkSources>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loadStoredArray<T>(key: string): T[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function defaultSources(): ObservedWorkSources {
  if (typeof localStorage === 'undefined') {
    return {
      tickets: [],
      telemetry: [],
      agentActivity: [],
      emails: [],
      receipts: [],
      projectProgress: [],
    }
  }
  return {
    tickets: loadStoredArray<Ticket>('mnemosync_tickets'),
    telemetry: loadStoredArray<WorkTelemetryEvent>('mnemosync_work_events_v1'),
    agentActivity: loadStoredArray<AgentActivity>('mnemosync_agent_activity'),
    emails: loadStoredArray<EmailThread>('mnemosync_emails'),
    receipts: [],
    projectProgress: loadStoredArray<ProjectProgressItem>(PROJECT_PROGRESS_KEY),
  }
}

function resolveSources(overrides: Partial<ObservedWorkSources> | undefined): ObservedWorkSources {
  const defaults = defaultSources()
  return {
    tickets: overrides?.tickets ?? defaults.tickets,
    telemetry: overrides?.telemetry ?? defaults.telemetry,
    agentActivity: overrides?.agentActivity ?? defaults.agentActivity,
    emails: overrides?.emails ?? defaults.emails,
    receipts: overrides?.receipts ?? defaults.receipts,
    projectProgress: overrides?.projectProgress ?? defaults.projectProgress,
  }
}

function ticketTruthState(ticket: Ticket): PersonalOntologyTruthState {
  return ticket.origin === 'imported' || ticket.origin === 'registry-sync' ? 'imported' : 'observed'
}

function actorIdForSource(source: string): string {
  return `actor:agent-${source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

function privateProperties(
  includePrivateSummaries: boolean,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return includePrivateSummaries ? properties : {}
}

function telemetryObjectId(type: string, id: string): string | undefined {
  if (type === 'mnemosync-ticket' || type === 'ticket') return `ticket:${id}`
  if (type === 'ai-receipt') return `receipt:${id}`
  if (type === 'sdd-project-progress' || type === 'project-progress') return `project-progress:${id}`
  return undefined
}

export function createObservedWorkExport(
  options: CreateObservedWorkExportOptions = {},
): PersonalOntologyBundle {
  const includePrivateSummaries = options.includePrivateSummaries === true
  const sources = resolveSources(options.sources)
  const objects = new Map<string, PersonalOntologyObject>()
  const links = new Map<string, PersonalOntologyLink>()
  const evidence: PersonalOntologyEvidenceReference[] = []

  const addObject = (object: PersonalOntologyObject): void => {
    if (!objects.has(object.id)) objects.set(object.id, object)
  }
  const addLink = (link: PersonalOntologyLink): void => {
    if (!links.has(link.id)) links.set(link.id, link)
  }

  for (const ticket of sources.tickets) {
    const ticketId = `ticket:${ticket.id}`
    const ticketRef = `mnemosync://ticket/${ticket.id}`
    const truthState = ticketTruthState(ticket)
    const sourceActorId = actorIdForSource(ticket.source)
    addObject({
      id: ticketId,
      type: 'ticket',
      label: includePrivateSummaries ? ticket.title : `Ticket ${ticket.id}`,
      profile: PROFILE,
      properties: {
        status: ticket.status,
        source: ticket.source,
        origin: ticket.origin ?? 'browser-ui',
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        ...(ticket.generatedKind ? { generatedKind: ticket.generatedKind } : {}),
        ...(ticket.sddGate ? { sddGate: ticket.sddGate } : {}),
        ...privateProperties(includePrivateSummaries, {
          title: ticket.title,
          description: ticket.description,
          delivers: ticket.delivers,
        }),
      },
      sourceRefs: [ticketRef],
      truthState,
      classification: 'private-work-data',
    })
    addObject({
      id: sourceActorId,
      type: 'actor',
      label: ticket.source,
      profile: PROFILE,
      properties: { actorType: 'agent' },
      sourceRefs: [`mnemosync://actor/${sourceActorId.slice('actor:'.length)}`],
      truthState: 'observed',
      classification: 'private-work-data',
    })
    addLink({
      id: `link:${ticketId}:created-by:${sourceActorId}`,
      fromObjectId: ticketId,
      toObjectId: sourceActorId,
      type: 'created-by',
      sourceRefs: [ticketRef],
      truthState,
    })

    for (const note of ticket.workNotes) {
      const noteId = `evidence:ticket:${ticket.id}:note:${note.id}`
      const noteRef = `mnemosync://ticket/${ticket.id}/note/${note.id}`
      addObject({
        id: noteId,
        type: 'evidence',
        label: includePrivateSummaries ? note.text : `Work note ${note.id}`,
        profile: PROFILE,
        properties: {
          createdAt: note.createdAt,
          kind: note.kind ?? 'fact',
          evidenceRefs: note.evidenceRefs ?? [],
          ...privateProperties(includePrivateSummaries, { text: note.text }),
        },
        sourceRefs: [noteRef],
        truthState,
        classification: 'private-work-data',
      })
      addLink({
        id: `link:${ticketId}:has-evidence:${noteId}`,
        fromObjectId: ticketId,
        toObjectId: noteId,
        type: 'has-evidence',
        sourceRefs: [noteRef],
        truthState,
      })
    }

    for (const decision of ticket.decisionLog) {
      const decisionId = `decision:${ticket.id}:${decision.id}`
      const decisionRef = `mnemosync://ticket/${ticket.id}/decision/${decision.id}`
      addObject({
        id: decisionId,
        type: 'decision',
        label: includePrivateSummaries ? decision.decision : `Decision ${decision.id}`,
        profile: PROFILE,
        properties: {
          timestamp: decision.timestamp,
          gateType: decision.gateType,
          reversibility: decision.reversibility,
          kind: decision.kind ?? 'decision',
          evidenceRefs: decision.evidenceRefs ?? [],
          ...privateProperties(includePrivateSummaries, {
            decision: decision.decision,
            reasoning: decision.reasoning,
          }),
        },
        sourceRefs: [decisionRef],
        truthState,
        classification: 'private-work-data',
      })
      addLink({
        id: `link:${ticketId}:records-decision:${decisionId}`,
        fromObjectId: ticketId,
        toObjectId: decisionId,
        type: 'records-decision',
        sourceRefs: [decisionRef],
        truthState,
      })
    }

    for (const artifact of ticket.artifacts) {
      const artifactId = `artifact:${ticket.id}:${artifact.id}`
      const artifactRef = artifact.url ?? `mnemosync://ticket/${ticket.id}/artifact/${artifact.id}`
      addObject({
        id: artifactId,
        type: 'artifact',
        label: includePrivateSummaries ? artifact.label : `Artifact ${artifact.id}`,
        profile: PROFILE,
        properties: {
          artifactType: artifact.type,
          createdAt: artifact.createdAt,
          status: artifact.status ?? 'available',
          ...privateProperties(includePrivateSummaries, {
            label: artifact.label,
            url: artifact.url,
          }),
        },
        sourceRefs: [artifactRef],
        truthState,
        classification: 'private-work-data',
      })
      addLink({
        id: `link:${ticketId}:attached-artifact:${artifactId}`,
        fromObjectId: ticketId,
        toObjectId: artifactId,
        type: 'attached-artifact',
        sourceRefs: [artifactRef],
        truthState,
      })
    }
  }

  for (const activity of sources.agentActivity) {
    const activityId = `agent-activity:${activity.id}`
    const actorId = actorIdForSource(activity.agent)
    const activityRef = `mnemosync://agent-activity/${activity.id}`
    addObject({
      id: actorId,
      type: 'actor',
      label: activity.agent,
      profile: PROFILE,
      properties: { actorType: 'agent' },
      sourceRefs: [`mnemosync://actor/${actorId.slice('actor:'.length)}`],
      truthState: 'observed',
      classification: 'private-work-data',
    })
    addObject({
      id: activityId,
      type: 'agent-activity',
      label: `Agent activity ${activity.id}`,
      profile: PROFILE,
      properties: {
        state: activity.state,
        lastActive: activity.lastActive,
        hasSession: Boolean(activity.sessionId),
        ...privateProperties(includePrivateSummaries, { currentTask: activity.currentTask }),
      },
      sourceRefs: [activityRef],
      truthState: 'observed',
      classification: 'private-work-data',
    })
    addLink({
      id: `link:${activityId}:performed-by:${actorId}`,
      fromObjectId: activityId,
      toObjectId: actorId,
      type: 'performed-by',
      sourceRefs: [activityRef],
      truthState: 'observed',
    })
  }

  for (const email of sources.emails) {
    const emailId = `email:${email.messageId}`
    const emailRef = `mnemosync://email/${email.messageId}`
    addObject({
      id: emailId,
      type: 'email-thread',
      label: includePrivateSummaries ? email.subject : `Email thread ${email.messageId}`,
      profile: PROFILE,
      properties: {
        needsResponse: email.needsResponse,
        receivedAt: email.receivedAt,
        ...privateProperties(includePrivateSummaries, {
          subject: email.subject,
          from: email.from,
          snippet: email.snippet,
        }),
      },
      sourceRefs: [emailRef],
      truthState: 'imported',
      classification: 'private-work-data',
    })
  }

  for (const receipt of sources.receipts) {
    const receiptId = `receipt:${receipt.id}`
    const receiptRef = `mnemosync://ai-receipt/${receipt.id}`
    const receiptTruth: PersonalOntologyTruthState = receipt.humanDisposition === 'accepted'
      ? 'user-confirmed'
      : 'derived'
    addObject({
      id: receiptId,
      type: 'ai-receipt',
      label: `AI receipt ${receipt.id}`,
      profile: PROFILE,
      properties: {
        agentSource: receipt.agentSource,
        modelOrSurface: receipt.modelOrSurface,
        outcome: receipt.outcome,
        humanDisposition: receipt.humanDisposition,
        createdAt: receipt.createdAt,
        actionCount: receipt.actionsTaken.length,
        artifactRefCount: receipt.artifactRefs.length,
        verificationCount: receipt.verification.length,
        ...privateProperties(includePrivateSummaries, {
          request: receipt.request,
          summary: receipt.summary,
        }),
      },
      sourceRefs: [receiptRef],
      truthState: receiptTruth,
      classification: 'private-work-data',
    })
    const targetId = receipt.ticketId
      ? `ticket:${receipt.ticketId}`
      : receipt.projectProgressId
        ? `project-progress:${receipt.projectProgressId}`
        : undefined
    if (targetId) {
      addLink({
        id: `link:${targetId}:supports-receipt:${receiptId}`,
        fromObjectId: targetId,
        toObjectId: receiptId,
        type: 'supports-receipt',
        sourceRefs: [receiptRef],
        truthState: receiptTruth,
      })
    }
  }

  for (const item of sources.projectProgress) {
    const progressId = `project-progress:${item.id}`
    const progressRef = `mnemosync://project-progress/${item.id}`
    addObject({
      id: progressId,
      type: 'project-progress',
      label: includePrivateSummaries ? item.projectName : `Project progress ${item.id}`,
      profile: PROFILE,
      properties: {
        projectId: item.projectId,
        currentGate: item.currentGate,
        pathVisibility: item.pathVisibility,
        lastScannedAt: item.lastScannedAt,
        issueCount: item.issues.length,
        ...privateProperties(includePrivateSummaries, {
          projectName: item.projectName,
          specId: item.specId,
          specTitle: item.specTitle,
          nextSafeAction: item.nextSafeAction,
          canonicalPath: item.canonicalPath,
        }),
      },
      sourceRefs: [progressRef],
      truthState: 'imported',
      classification: 'private-work-data',
    })
    item.artifactRefs.forEach((artifact, index) => {
      const artifactId = `artifact:project-progress:${item.id}:${index + 1}`
      const sourceRef = `mnemosync://project-progress/${item.id}/artifact/${index + 1}`
      addObject({
        id: artifactId,
        type: 'artifact',
        label: includePrivateSummaries ? artifact.label : `Project artifact ${index + 1}`,
        profile: PROFILE,
        properties: {
          artifactType: artifact.kind,
          ...privateProperties(includePrivateSummaries, {
            label: artifact.label,
            path: artifact.path,
          }),
        },
        sourceRefs: [sourceRef],
        truthState: 'imported',
        classification: 'private-work-data',
      })
      addLink({
        id: `link:${progressId}:attached-artifact:${artifactId}`,
        fromObjectId: progressId,
        toObjectId: artifactId,
        type: 'attached-artifact',
        sourceRefs: [sourceRef],
        truthState: 'imported',
      })
    })
  }

  for (const event of sources.telemetry) {
    const eventId = `event:${event.eventId}`
    const eventRef = event.provenance.sourceRef
    const actorId = `actor:${event.actor.id}`
    addObject({
      id: actorId,
      type: 'actor',
      label: event.actor.label,
      profile: PROFILE,
      properties: {
        actorType: event.actor.type,
        role: event.actor.role,
        authorityLevel: event.actor.authorityLevel,
      },
      sourceRefs: [`mnemosync://actor/${event.actor.id}`],
      truthState: event.truthState,
      classification: 'private-work-data',
    })
    addObject({
      id: eventId,
      type: 'work-event',
      label: event.activity.label,
      profile: PROFILE,
      properties: {
        caseId: event.caseId,
        traceId: event.traceId,
        parentEventId: event.parentEventId,
        timestamp: event.timestamp,
        sequence: event.sequence,
        activityId: event.activity.id,
        activityType: event.activity.type,
        resultStatus: event.result.status,
        acceptedOutcome: event.acceptedOutcome,
        sourceType: event.provenance.sourceType,
        ingestedAt: event.provenance.ingestedAt,
        transformation: event.provenance.transformation,
        ...privateProperties(includePrivateSummaries, {
          intent: event.intent,
          resultMessage: event.result.message,
        }),
      },
      sourceRefs: [eventRef],
      truthState: event.truthState,
      classification: 'private-work-data',
    })
    addLink({
      id: `link:${eventId}:performed-by:${actorId}`,
      fromObjectId: eventId,
      toObjectId: actorId,
      type: 'performed-by',
      sourceRefs: [eventRef],
      truthState: event.truthState,
    })

    for (const referencedObject of event.objects ?? []) {
      const targetId = telemetryObjectId(referencedObject.type, referencedObject.id)
      if (!targetId || !objects.has(targetId)) continue
      addLink({
        id: `link:${eventId}:references:${targetId}`,
        fromObjectId: eventId,
        toObjectId: targetId,
        type: 'references',
        sourceRefs: [referencedObject.sourceRef ?? eventRef],
        truthState: event.truthState,
      })
    }

    for (const item of event.evidence ?? []) {
      const evidenceId = `evidence:event:${event.eventId}:${item.id}`
      addObject({
        id: evidenceId,
        type: 'evidence',
        label: includePrivateSummaries && item.label ? item.label : `Evidence ${item.id}`,
        profile: PROFILE,
        properties: {
          classification: item.classification,
          ...privateProperties(includePrivateSummaries, { label: item.label }),
        },
        sourceRefs: [item.sourceRef],
        truthState: event.truthState,
        classification: item.classification === 'redacted' ? 'redacted' : 'private-work-data',
      })
      addLink({
        id: `link:${eventId}:has-evidence:${evidenceId}`,
        fromObjectId: eventId,
        toObjectId: evidenceId,
        type: 'has-evidence',
        sourceRefs: [item.sourceRef],
        truthState: event.truthState,
      })
      evidence.push({
        id: evidenceId,
        sourceRefs: [item.sourceRef],
        truthState: event.truthState,
        eventId: event.eventId,
        actorId: event.actor.id,
        timestamp: event.timestamp,
      })
    }
  }

  const sourceTypes = [...new Set(sources.telemetry.map((event) => event.provenance.sourceType))].sort()
  if (sourceTypes.length === 0) sourceTypes.push('mnemosync')
  const eventIds = sources.telemetry.map((event) => event.eventId)

  return {
    schemaVersion: PERSONAL_ONTOLOGY_SCHEMA_VERSION,
    bundleProfile: PROFILE,
    bundleKind: 'observed-work',
    producer: {
      productName: 'FindMnemo',
      productId: 'findmnemo',
      exportedAt: options.exportedAt ?? new Date().toISOString(),
      legacyNames: ['MnemoSync', 'Mnemosync', 'mnemosync'],
      sourceTypes,
      compatibilityMode: 'legacy-compatible',
    },
    compatibility: {
      acceptedSourceTypes: sourceTypes,
      emittedSourceTypes: sourceTypes,
      legacyLocalStorageKeys: [...LEGACY_LOCAL_STORAGE_KEYS],
      legacyUriSchemes: ['mnemosync://'],
    },
    objects: [...objects.values()],
    links: [...links.values()],
    evidence,
    sourceEventIds: eventIds,
    extensions: {
      sourceTelemetry: {
        schemaVersion: '1.0.0',
        eventCount: eventIds.length,
        eventIds,
      },
      ...(options.includeRawTelemetry ? { rawTelemetry: sources.telemetry } : {}),
    },
  }
}

export function validateObservedWorkExport(input: unknown): input is PersonalOntologyBundle {
  const validation = validatePersonalOntologyBundle(input)
  if (!validation.valid || !isRecord(input)) return false
  if (input.bundleProfile !== PROFILE || input.bundleKind !== 'observed-work') return false
  if (!isRecord(input.compatibility)) return false
  return (
    Array.isArray(input.compatibility.acceptedSourceTypes) &&
    input.compatibility.acceptedSourceTypes.includes('mnemosync') &&
    Array.isArray(input.compatibility.legacyUriSchemes) &&
    input.compatibility.legacyUriSchemes.includes('mnemosync://')
  )
}

export function downloadObservedWorkExport(
  options: CreateObservedWorkExportOptions = {},
): { ok: true; filename: string } | { ok: false; message: string } {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return { ok: false, message: 'Observed work download is unavailable in this environment.' }
  }
  const bundle = createObservedWorkExport(options)
  if (!validateObservedWorkExport(bundle)) {
    return { ok: false, message: 'Observed work could not be validated and was not downloaded.' }
  }
  const date = bundle.producer.exportedAt.slice(0, 10).replaceAll('-', '')
  const filename = `findmnemo-observed-work-${date}.json`
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return { ok: true, filename }
}
