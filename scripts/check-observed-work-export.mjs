import assert from 'node:assert/strict'
import {
  createCompatibilityReport,
  createObservedWorkExport,
  downloadObservedWorkExport,
  FINDMNEMO_ACTION_HANDOFFS,
  validateFindMnemoHandoff,
  validateObservedWorkExport,
} from '../src/lib/ontology.ts'

const exportedAt = '2026-07-10T12:00:00.000Z'
const privateMarkers = [
  'PRIVATE ticket title',
  'PRIVATE ticket description',
  'PRIVATE note body',
  'PRIVATE decision text',
  'PRIVATE decision reasoning',
  'PRIVATE artifact label',
  'PRIVATE receipt request',
  'PRIVATE receipt summary',
  'PRIVATE email subject',
  'PRIVATE email snippet',
]

const ticket = {
  id: 'ticket-1',
  title: privateMarkers[0],
  description: privateMarkers[1],
  source: 'Codex',
  status: 'in-progress',
  workNotes: [{ id: 'note-1', text: privateMarkers[2], createdAt: exportedAt }],
  artifacts: [{ id: 'artifact-1', type: 'file', label: privateMarkers[5], createdAt: exportedAt }],
  decisionLog: [{
    id: 'decision-1',
    timestamp: exportedAt,
    decision: privateMarkers[3],
    reasoning: privateMarkers[4],
    gateType: 'two-way',
    reversibility: 'high',
  }],
  createdAt: exportedAt,
  updatedAt: exportedAt,
}

const event = {
  eventId: 'event-1',
  caseId: ticket.id,
  timestamp: exportedAt,
  sequence: 0,
  intent: 'PRIVATE telemetry intent',
  activity: { id: 'work-executed', label: 'Execute work', type: 'execute' },
  actor: { id: 'agent-codex', label: 'Codex', type: 'agent' },
  result: { status: 'success', message: 'PRIVATE result message' },
  truthState: 'observed',
  provenance: {
    sourceType: 'mnemosync',
    sourceRef: 'mnemosync://telemetry/event-1',
    ingestedAt: exportedAt,
    transformation: 'FindMnemo fixture mapping',
  },
}

const bundle = createObservedWorkExport({
  exportedAt,
  sources: {
    tickets: [ticket],
    telemetry: [event],
    agentActivity: [{
      id: 'agent-activity-1',
      agent: 'Codex',
      state: 'working',
      currentTask: 'PRIVATE current task',
      lastActive: exportedAt,
    }],
    emails: [{
      id: 'email-1',
      subject: privateMarkers[8],
      from: 'private@example.com',
      snippet: privateMarkers[9],
      needsResponse: true,
      receivedAt: exportedAt,
      messageId: 'message-1',
    }],
    receipts: [{
      id: 'receipt-1',
      ticketId: ticket.id,
      agentSource: 'Codex',
      request: privateMarkers[6],
      summary: privateMarkers[7],
      actionsTaken: [],
      artifactRefs: [],
      verification: [],
      facts: [],
      assumptions: [],
      decisions: [],
      recommendations: [],
      openQuestions: [],
      outcome: 'verified',
      createdAt: exportedAt,
    }],
    projectProgress: [{
      id: 'progress-1',
      projectId: 'findmnemo',
      projectName: 'FindMnemo',
      currentGate: 'implementation:in-progress',
      nextSafeAction: 'Continue T2',
      artifactRefs: [],
      pathVisibility: 'hidden',
      origin: 'registry-sync',
      lastScannedAt: exportedAt,
      issues: [],
    }],
  },
})

assert.equal(bundle.bundleProfile, 'findmnemo.observed-work.v1')
assert.equal(bundle.bundleKind, 'observed-work')
assert.equal(bundle.producer.productName, 'FindMnemo')
assert.equal(bundle.producer.compatibilityMode, 'legacy-compatible')
assert.deepEqual(bundle.compatibility?.acceptedSourceTypes, ['mnemosync'])
assert.deepEqual(bundle.compatibility?.legacyLocalStorageKeys, [
  'mnemosync_tickets',
  'mnemosync_agent_activity',
  'mnemosync_emails',
  'mnemosync_work_events_v1',
  'mnemosync_project_progress_items',
])

const objectIds = new Set(bundle.objects.map((object) => object.id))
for (const id of [
  'ticket:ticket-1',
  'event:event-1',
  'actor:agent-codex',
  'decision:ticket-1:decision-1',
  'artifact:ticket-1:artifact-1',
  'receipt:receipt-1',
  'project-progress:progress-1',
  'email:message-1',
]) {
  assert(objectIds.has(id), `missing expected object ${id}`)
}

assert(bundle.links.some((link) =>
  link.fromObjectId === 'ticket:ticket-1' &&
  link.toObjectId === 'decision:ticket-1:decision-1' &&
  link.type === 'records-decision'))
assert(bundle.links.some((link) =>
  link.fromObjectId === 'ticket:ticket-1' &&
  link.toObjectId === 'artifact:ticket-1:artifact-1' &&
  link.type === 'attached-artifact'))
assert(bundle.links.some((link) =>
  link.fromObjectId === 'event:event-1' &&
  link.toObjectId === 'actor:agent-codex' &&
  link.type === 'performed-by'))
assert.equal(validateObservedWorkExport(bundle), true)

const serialized = JSON.stringify(bundle)
for (const marker of [...privateMarkers, 'PRIVATE telemetry intent', 'PRIVATE result message', 'PRIVATE current task']) {
  assert(!serialized.includes(marker), `default export leaked ${marker}`)
}

const emptyBundle = createObservedWorkExport({
  exportedAt,
  sources: {
    tickets: [],
    telemetry: [],
    agentActivity: [],
    emails: [],
    receipts: [],
    projectProgress: [],
  },
})
assert.equal(validateObservedWorkExport(emptyBundle), true)
assert.deepEqual(emptyBundle.objects, [])
assert.deepEqual(emptyBundle.links, [])

const compatibility = createCompatibilityReport(['mnemosync'])
assert.deepEqual(compatibility.currentProduct, { name: 'FindMnemo', id: 'findmnemo' })
assert.equal(compatibility.exportLabel, 'Observed work export')
assert(compatibility.legacyNames.includes('mnemosync'))
assert(compatibility.legacyUriSchemes.includes('mnemosync://'))
assert.deepEqual(compatibility.supportedConsumers, ['FlowSensa', 'OSSensa', 'SancusSight', 'LocalCFO'])

assert.deepEqual(FINDMNEMO_ACTION_HANDOFFS.map((action) => action.id), [
  'track-implementation',
  'attach-artifact',
  'record-decision',
  'close-loop',
])
assert(FINDMNEMO_ACTION_HANDOFFS.every((action) =>
  action.mode === 'propose-only' && action.confirmationRequired && action.failureBehavior.length > 0))

const validHandoff = {
  schemaVersion: '1.0.0',
  handoffProfile: 'personal-ontology.handoff.v1',
  sourceProduct: 'FlowSensa',
  targetProduct: 'FindMnemo',
  actionType: 'track-implementation',
  summary: 'Propose tracking the approved process revision.',
  objectRefs: ['process:example'],
  evidenceRefs: ['event:event-1'],
  payload: { title: 'Implement approved process revision' },
  confirmationRequired: true,
}
assert.equal(validateFindMnemoHandoff(validHandoff).valid, true)

const invalidHandoff = structuredClone(validHandoff)
delete invalidHandoff.payload.title
invalidHandoff.confirmationRequired = false
invalidHandoff.payload.unapprovedMutation = true
const invalidResult = validateFindMnemoHandoff(invalidHandoff)
assert.equal(invalidResult.valid, false)
assert.equal(invalidResult.handoff, undefined)
assert(invalidResult.issues.some((issue) => issue.path === '$.payload.title'))
assert(invalidResult.issues.some((issue) => issue.path === '$.confirmationRequired'))
assert(invalidResult.issues.some((issue) => issue.path === '$.payload.unapprovedMutation'))
assert.deepEqual(downloadObservedWorkExport(), {
  ok: false,
  message: 'Observed work download is unavailable in this environment.',
})

console.log(`Observed-work export checks passed (${bundle.objects.length} objects, ${bundle.links.length} links).`)
