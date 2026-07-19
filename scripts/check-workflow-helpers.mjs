#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import {
  computeTicketReadiness,
  getBlockingReferences,
  getBlockingTickets,
  getFrontierTickets,
  isFogMapResolved,
  summarizeReview,
} from '../src/lib/workflow-intelligence.ts'
import {
  approvedTaskToExecutionTicket,
  projectProgressToGatePlaceholderTicket,
  stableProjectProgressId,
  stableSddGatePlaceholderTicketId,
  stableSddTaskTicketId,
} from '../src/lib/generated-tickets.ts'
import {
  attentionIssuesForGate,
  deriveSddNextAction,
  normalizeProjectProgressItem,
} from '../src/lib/sdd-progress.ts'
import {
  buildAiReceipt,
  findReceiptPrivacyFindings,
  receiptToTelemetryEvents,
} from '../src/lib/ai-receipts.ts'
import { buildHumanActivityEvent } from '../src/lib/human-activity.ts'
import {
  parseApprovedTasksMarkdown,
  runSync,
  taskRecordToExecutionSeed,
} from './sync-sdd-progress.mjs'
import { buildReceiptCommandOutput } from './log-ai-receipt.mjs'

async function loadStorageSanitizer() {
  let source = await fs.readFile(new URL('../src/lib/storage.ts', import.meta.url), 'utf8')
  source = source
    .replace(/import type \{[\s\S]*?\} from '\.\.\/types'\r?\n/, '')
    .replace(/import \{ DEMO_TICKETS, DEMO_ACTIVITIES, DEMO_EMAILS \} from '\.\/demo-data'\r?\n/, 'const DEMO_TICKETS = []\nconst DEMO_ACTIVITIES = []\nconst DEMO_EMAILS = []\n')
    .replace(/import \{ recordTelemetry \} from '\.\/telemetry'\r?\n/, 'function recordTelemetry() {}\n')

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  })
  const encoded = Buffer.from(outputText, 'utf8').toString('base64')
  return import(`data:text/javascript;base64,${encoded}`)
}

const { sanitizeTicket } = await loadStorageSanitizer()

const checks = []

function check(name, fn) {
  checks.push({ name, fn })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function withPreTasksApprovedFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'findmnemo-sdd-fixture-'))
  try {
    const specDir = path.join(root, '.ai', 'sdd', 'specs', '001-pre-tasks')
    await fs.mkdir(specDir, { recursive: true })
    await fs.writeFile(path.join(specDir, '.status'), 'design:approved\n')
    await fs.writeFile(path.join(specDir, 'requirements.md'), '# Feature: Pre Tasks Fixture\n')
    await fs.writeFile(path.join(specDir, 'design.md'), '# Design: Pre Tasks Fixture\n')
    await fs.writeFile(path.join(specDir, 'tasks.md'), '# Tasks: Pre Tasks Fixture\n')

    const registryPath = path.join(root, 'fixture_registry.py')
    const escapedRoot = root.replace(/\\/g, '\\\\')
    await fs.writeFile(registryPath, [
      'import json',
      'import sys',
      'if sys.argv[1] == "resolve":',
      `    print(json.dumps({"id": "fixture-project", "name": "Fixture Project", "canonical_path": "${escapedRoot}", "health": "ok"}))`,
      'elif sys.argv[1] == "audit":',
      `    print("fixture-project ok ${escapedRoot}")`,
      'else:',
      '    raise SystemExit(1)',
      '',
    ].join('\n'))

    return await fn({ root, registryPath })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

check('workflow helper harness reports passing assertions', () => {
  assert(true, 'harness assertion should pass')
})

check('workflow helper harness reports failing assertions', () => {
  let failed = false
  try {
    assert(false, 'intentional failure')
  } catch {
    failed = true
  }
  assert(failed, 'harness assertion should throw on failure')
})

check('sanitizeTicket supplies safe workflow defaults for legacy tickets', () => {
  const ticket = sanitizeTicket({
    id: 'legacy-1',
    title: 'Legacy ticket',
    description: 'Stored before workflow metadata existed',
    source: 'Pi',
    status: 'todo',
    workNotes: undefined,
    artifacts: undefined,
    decisionLog: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  assert(ticket.origin === 'browser-ui', 'legacy non-demo tickets should default to browser-ui origin')
  assert(Array.isArray(ticket.blockedBy) && ticket.blockedBy.length === 0, 'missing blockedBy should become an empty array')
  assert(Array.isArray(ticket.acceptanceCriteria) && ticket.acceptanceCriteria.length === 0, 'missing acceptanceCriteria should become an empty array')
  assert(Array.isArray(ticket.verificationChecks) && ticket.verificationChecks.length === 0, 'missing verificationChecks should become an empty array')
  assert(Array.isArray(ticket.receiptIds) && ticket.receiptIds.length === 0, 'missing receiptIds should become an empty array')
  assert(ticket.generatedKind === undefined, 'generatedKind should not be inferred for legacy tickets')
  assert(ticket.projectProgressId === undefined, 'projectProgressId should not be inferred for legacy tickets')
  assert(ticket.sddGate === undefined, 'sddGate should not be inferred for legacy tickets')
})

check('sanitizeTicket preserves valid optional workflow fields', () => {
  const ticket = sanitizeTicket({
    id: 'workflow-1',
    title: 'Workflow ticket',
    description: 'Rich metadata survives migration',
    source: 'Codex',
    status: 'blocked',
    origin: 'registry-sync',
    generatedKind: 'sdd-gate-placeholder',
    projectProgressId: 'project:findmnemo:spec:002',
    sddSpecId: '002-workflow-intelligence-layer',
    sddGate: 'implementation:in-progress',
    blockedBy: ['t1', '', 42],
    delivers: 'Typed workflow metadata',
    acceptanceCriteria: [{ id: 'ac1', text: 'Legacy defaults pass', checked: true }],
    verificationChecks: [{ id: 'vc1', commandOrCheck: 'npm run check:workflow', result: 'passed' }],
    receiptRequired: false,
    receiptIds: ['receipt-1'],
    artifacts: [
      { id: 'a1', type: 'verification-evidence', label: 'check output', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', type: 'invalid-type', label: 'fallback artifact', createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    workNotes: [{ id: 'n1', text: 'Fact note', kind: 'fact', evidenceRefs: ['a1'], createdAt: '2026-01-01T00:00:00.000Z' }],
    decisionLog: [{ id: 'd1', timestamp: '2026-01-01T00:00:00.000Z', decision: 'Keep optional', reasoning: 'Migration safe', gateType: 'two-way', reversibility: 'high', kind: 'decision', evidenceRefs: ['a1'] }],
    review: {
      spec: { verdict: 'approved', findings: [] },
      standards: { verdict: 'approved-with-follow-ups', findings: [{ id: 'f1', severity: 'warning', message: 'Advisory smell', smellTags: ['duplicated-code', 'not-a-smell'] }] },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  assert(ticket.origin === 'registry-sync', 'valid origin should be preserved')
  assert(ticket.generatedKind === 'sdd-gate-placeholder', 'valid generatedKind should be preserved')
  assert(ticket.sddGate === 'implementation:in-progress', 'valid sddGate should be preserved')
  assert(ticket.blockedBy?.length === 1 && ticket.blockedBy[0] === 't1', 'blockedBy should keep only non-empty strings')
  assert(ticket.artifacts[0].type === 'verification-evidence', 'support artifact types should be preserved')
  assert(ticket.artifacts[1].type === 'url', 'invalid artifact types should fall back safely')
  assert(ticket.workNotes[0].kind === 'fact', 'work note knowledge kind should be preserved')
  assert(ticket.decisionLog[0].kind === 'decision', 'decision log knowledge kind should be preserved')
  assert(ticket.review?.standards.findings[0].smellTags?.length === 1, 'invalid smell tags should be dropped')
})

check('sanitizeTicket labels seeded Codex demo tickets as demo-derived', () => {
  const ticket = sanitizeTicket({
    id: 't1',
    title: 'Seeded demo',
    description: 'Existing localStorage demo seed without origin',
    source: 'Codex',
    status: 'in-progress',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  assert(ticket.origin === 'demo', 'seeded demo tickets should default to demo origin')
})

check('workflow readiness treats done blockers as satisfied and excludes done tickets from frontier', () => {
  const tickets = [
    sanitizeTicket({ id: 't1', title: 'Done blocker', source: 'Pi', status: 'done' }),
    sanitizeTicket({ id: 't2', title: 'Ready after blocker', source: 'Pi', status: 'todo', blockedBy: ['t1'] }),
    sanitizeTicket({ id: 't3', title: 'Blocked by incomplete ticket', source: 'Pi', status: 'todo', blockedBy: ['t4'] }),
    sanitizeTicket({ id: 't4', title: 'Incomplete blocker', source: 'Pi', status: 'in-progress' }),
    sanitizeTicket({ id: 't5', title: 'Explicitly blocked', source: 'Pi', status: 'blocked' }),
  ]

  assert(computeTicketReadiness(tickets[0], tickets) === 'done', 'done tickets should report done readiness')
  assert(computeTicketReadiness(tickets[1], tickets) === 'ready', 'tickets blocked only by done work should be ready')
  assert(computeTicketReadiness(tickets[2], tickets) === 'blocked', 'tickets blocked by incomplete work should be blocked')

  const frontierIds = getFrontierTickets(tickets).map((ticket) => ticket.id)
  assert(frontierIds.includes('t2'), 'frontier should include pending tickets whose blockers are done')
  assert(frontierIds.includes('t4'), 'frontier should include pending unblocked tickets')
  assert(!frontierIds.includes('t1'), 'frontier should exclude done tickets')
  assert(!frontierIds.includes('t3'), 'frontier should exclude blocked tickets')
  assert(!frontierIds.includes('t5'), 'frontier should exclude explicitly blocked tickets')
})

check('workflow blockers keep missing and self-referential blockers visible', () => {
  const tickets = [
    sanitizeTicket({ id: 'missing-blocker', title: 'Missing blocker ticket', source: 'Pi', status: 'todo', blockedBy: ['external-review'] }),
    sanitizeTicket({ id: 'self-blocker', title: 'Self blocker ticket', source: 'Pi', status: 'todo', blockedBy: ['self-blocker'] }),
  ]

  const missingReferences = getBlockingReferences(tickets[0], tickets)
  const selfReferences = getBlockingReferences(tickets[1], tickets)

  assert(computeTicketReadiness(tickets[0], tickets) === 'blocked', 'missing blockers should prevent readiness')
  assert(missingReferences[0]?.reason === 'missing-ticket', 'missing blockers should be reported as missing-ticket')
  assert(computeTicketReadiness(tickets[1], tickets) === 'blocked', 'self blockers should prevent readiness')
  assert(selfReferences[0]?.reason === 'self-reference', 'self blockers should be reported as self-reference')
  assert(getBlockingTickets(tickets[0], tickets).length === 0, 'missing blockers should not masquerade as real tickets')
})

check('workflow review summary preserves Spec and Standards axis outcomes', () => {
  const approved = {
    spec: { verdict: 'approved', findings: [] },
    standards: { verdict: 'approved', findings: [] },
  }
  const followUps = {
    spec: { verdict: 'approved', findings: [] },
    standards: { verdict: 'approved-with-follow-ups', findings: [] },
  }
  const needsFixes = {
    spec: { verdict: 'needs-fixes', findings: [] },
    standards: { verdict: 'approved', findings: [] },
  }

  assert(summarizeReview(approved) === 'approved', 'all approved axes should summarize as approved')
  assert(summarizeReview(followUps) === 'approved-with-follow-ups', 'follow-up verdict should be preserved')
  assert(summarizeReview(needsFixes) === 'needs-fixes', 'Spec failure plus Standards pass should summarize as needs-fixes')
})

check('workflow fog map helper treats outstanding fog items as unresolved', () => {
  assert(isFogMapResolved(undefined), 'missing fog map should be considered resolved')
  assert(isFogMapResolved({ destination: 'Clear route', decisionsSoFar: [], items: [], outOfScope: [] }), 'empty fog map should be resolved')
  assert(!isFogMapResolved({
    destination: 'Clear route',
    decisionsSoFar: [],
    items: [{ id: 'fog-1', type: 'research', state: 'frontier', text: 'Answer the next question' }],
    outOfScope: [],
  }), 'fog map with outstanding items should be unresolved')
})

check('generated SDD IDs are stable and idempotent', () => {
  const progressId = stableProjectProgressId('FindMnemo', '002-workflow-intelligence-layer')
  const progressIdAgain = stableProjectProgressId(' findmnemo ', '002 Workflow Intelligence Layer')
  const gateTicketId = stableSddGatePlaceholderTicketId('FindMnemo', '002-workflow-intelligence-layer')
  const gateTicketIdAgain = stableSddGatePlaceholderTicketId(' findmnemo ', '002 Workflow Intelligence Layer')
  const taskTicketId = stableSddTaskTicketId('FindMnemo', '002-workflow-intelligence-layer', 'T3')
  const taskTicketIdAgain = stableSddTaskTicketId(' findmnemo ', '002 Workflow Intelligence Layer', ' t3 ')

  assert(progressId === 'project:findmnemo:spec:002-workflow-intelligence-layer', 'project progress ID should use the approved stable shape')
  assert(progressId === progressIdAgain, 'project progress ID should be stable across spacing/case differences')
  assert(gateTicketId === 'ticket:sdd-gate:findmnemo:002-workflow-intelligence-layer', 'gate placeholder ticket ID should use the approved stable shape')
  assert(gateTicketId === gateTicketIdAgain, 'gate placeholder ticket ID should be stable across repeated scans')
  assert(taskTicketId === 'ticket:sdd-task:findmnemo:002-workflow-intelligence-layer:t3', 'task execution ticket ID should use the approved stable shape')
  assert(taskTicketId === taskTicketIdAgain, 'task execution ticket ID should be stable across repeated scans')
})

check('SDD progress next actions map approved gates and attention states', () => {
  assert(
    deriveSddNextAction('requirements:draft') === 'Review and approve requirements or request PRD changes',
    'requirements:draft should point to requirements approval',
  )
  assert(
    deriveSddNextAction('requirements:approved') === 'Create or update the technical design with sdd-spec',
    'requirements:approved should point to design work',
  )
  assert(
    deriveSddNextAction('design:approved') === 'Create or update implementation tasks with sdd-tasks',
    'design:approved should point to task planning',
  )
  assert(
    deriveSddNextAction('tasks:approved') === 'Start implementation with sdd-exec',
    'tasks:approved should point to implementation',
  )
  assert(
    deriveSddNextAction('implementation:done') === 'Review implementation with sdd-review',
    'implementation:done should point to review',
  )
  assert(
    deriveSddNextAction('invalid-status') === 'Repair the invalid .status file before continuing',
    'invalid-status should point to repair',
  )
  assert(
    deriveSddNextAction('stale-path') === 'Refresh or repair the project registry path before continuing',
    'stale-path should point to registry repair',
  )
})

check('SDD project progress normalization hides paths by default and preserves stable identity', () => {
  const hidden = normalizeProjectProgressItem({
    projectId: 'FindMnemo',
    projectName: 'FindMnemo',
    specId: '002-workflow-intelligence-layer',
    currentGate: 'tasks:approved',
    canonicalPath: 'C:/Users/fixture/findmnemo',
  })

  const visible = normalizeProjectProgressItem({
    projectId: 'FindMnemo',
    projectName: 'FindMnemo',
    specId: '002-workflow-intelligence-layer',
    currentGate: 'tasks:approved',
    canonicalPath: 'C:/Users/fixture/findmnemo',
    pathVisibility: 'local-only',
  })

  assert(hidden.id === 'project:findmnemo:spec:002-workflow-intelligence-layer', 'project progress ID should be stable')
  assert(hidden.nextSafeAction === 'Start implementation with sdd-exec', 'default next action should derive from gate')
  assert(hidden.canonicalPath === undefined, 'canonical path should be hidden by default')
  assert(visible.canonicalPath === 'C:/Users/fixture/findmnemo', 'canonical path should be preserved in local-only mode')
})

check('SDD attention states produce blocker issues', () => {
  assert(attentionIssuesForGate('invalid-status')[0]?.severity === 'blocker', 'invalid status should create blocker issue')
  assert(attentionIssuesForGate('stale-path')[0]?.severity === 'blocker', 'stale path should create blocker issue')
  assert(attentionIssuesForGate('tasks:approved').length === 0, 'normal gates should not create attention issues')
})

check('SDD gate placeholder tickets are idempotent and do not require receipts', () => {
  const item = normalizeProjectProgressItem({
    projectId: 'FindMnemo',
    projectName: 'FindMnemo',
    specId: '002-workflow-intelligence-layer',
    specTitle: 'Workflow Intelligence Layer',
    currentGate: 'requirements:draft',
    artifactRefs: [
      { kind: 'status', label: '.status', path: '.ai/sdd/specs/002-workflow-intelligence-layer/.status' },
      { kind: 'requirements', label: 'requirements.md', path: '.ai/sdd/specs/002-workflow-intelligence-layer/requirements.md' },
    ],
    lastScannedAt: '2026-07-09T00:00:00.000Z',
  })

  const first = projectProgressToGatePlaceholderTicket(item)
  const second = projectProgressToGatePlaceholderTicket({ ...item, lastScannedAt: '2026-07-09T01:00:00.000Z' })

  assert(first.id === 'ticket:sdd-gate:findmnemo:002-workflow-intelligence-layer', 'gate placeholder ticket ID should be stable')
  assert(first.id === second.id, 'repeated scans should update the same gate placeholder ticket')
  assert(first.generatedKind === 'sdd-gate-placeholder', 'placeholder ticket should be visibly generated')
  assert(first.origin === 'registry-sync', 'placeholder ticket should be registry-sync derived')
  assert(first.sddGate === 'requirements:draft', 'placeholder should carry the current gate')
  assert(first.receiptRequired === false, 'early gate placeholders should not require receipts')
  assert(first.artifacts.length === 2, 'placeholder should carry source artifact refs')
})

check('SDD scanner dry-run reflects an active registered spec without machine-local dependencies', async () => {
  const result = await withPreTasksApprovedFixture(({ registryPath }) => runSync({
    registry: registryPath,
    project: 'Fixture Project',
    write: false,
    json: false,
    pathVisibility: 'hidden',
    commandsOut: undefined,
  }))

  const item = result.projectProgressItems.find((candidate) => candidate.specId === '001-pre-tasks')
  const ticketCommand = result.ticketCommands.find((command) => command.payload.sddSpecId === '001-pre-tasks')
  assert(item?.currentGate === 'design:approved', 'dry-run should read the fixture .status from disk')
  assert(item?.canonicalPath === undefined, 'dry-run should hide canonical paths by default')
  assert(ticketCommand, 'dry-run should emit a gate placeholder ticket command for the active spec')
  assert(ticketCommand.payload.id === 'ticket:sdd-gate:fixture-project:001-pre-tasks', 'placeholder should use stable registry project/spec identity')
  assert(ticketCommand.payload.receiptRequired === false, 'gate placeholder command should not require receipts')
  assert(result.telemetryCommands.some((command) => command.payload.activity.id === 'sdd-gate-placeholder-upserted'), 'active dry-run should emit placeholder telemetry')
  assert(result.telemetryCommands.some((command) => command.payload.activity.id === 'sdd-status-scanned'), 'dry-run should emit SDD scan telemetry')
})

check('SDD approved tasks parse into stable receipt-required execution tickets', () => {
  const markdown = `## Task T1: First Task

**Blocked By:** none
**Delivers:** First approved behavior.

### Acceptance Criteria

- [ ] First acceptance criterion
- [ ] Second acceptance criterion

### Verification

- [ ] npm run check:workflow passes

## Task T2: Second Task

**Blocked By:** T1, external-review
**Delivers:** Second approved behavior.

### Acceptance Criteria

- [ ] Second task criterion

### Verification

- [ ] npm run build passes
`
  const tasks = parseApprovedTasksMarkdown(markdown)
  const item = normalizeProjectProgressItem({
    projectId: 'FindMnemo',
    projectName: 'FindMnemo',
    specId: '002-workflow-intelligence-layer',
    currentGate: 'tasks:approved',
    artifactRefs: [{ kind: 'tasks', label: 'tasks.md', path: '.ai/sdd/specs/002-workflow-intelligence-layer/tasks.md' }],
    lastScannedAt: '2026-07-09T00:00:00.000Z',
  })

  const t1 = approvedTaskToExecutionTicket(taskRecordToExecutionSeed(tasks[0], item, '2026-07-09T00:00:00.000Z'))
  const t2 = approvedTaskToExecutionTicket(taskRecordToExecutionSeed(tasks[1], item, '2026-07-09T00:00:00.000Z'))

  assert(tasks.length === 2, 'parser should find both approved task sections')
  assert(t1.id === 'ticket:sdd-task:findmnemo:002-workflow-intelligence-layer:t1', 'T1 execution ticket should use stable task ID')
  assert(t2.id === 'ticket:sdd-task:findmnemo:002-workflow-intelligence-layer:t2', 'T2 execution ticket should use stable task ID')
  assert(t2.blockedBy.includes(t1.id), 'task blockers should map to generated task ticket blockers')
  assert(t2.blockedBy.includes('external-review'), 'external blockers should remain visible')
  assert(t1.generatedKind === 'sdd-task-execution', 'execution ticket should be marked as task execution')
  assert(t1.receiptRequired === true, 'task execution tickets should require receipts')
  assert(t1.acceptanceCriteria.length === 2, 'acceptance criteria should map into ticket fields')
  assert(t1.verificationChecks[0]?.commandOrCheck === 'npm run check:workflow passes', 'verification checks should map into ticket fields')
})

check('SDD scanner dry-run does not generate task execution tickets before tasks:approved', async () => {
  const result = await withPreTasksApprovedFixture(({ registryPath }) => runSync({
    registry: registryPath,
    project: 'Fixture Project',
    write: false,
    json: false,
    pathVisibility: 'hidden',
    commandsOut: undefined,
  }))

  const activeSpec = result.projectProgressItems.find((candidate) => candidate.specId === '001-pre-tasks')
  assert(activeSpec?.currentGate === 'design:approved', 'fixture spec should be before tasks:approved during this check')
  assert(result.summary.taskExecutionTickets === 0, 'scanner should not generate task execution tickets before tasks:approved')
  assert(!result.ticketCommands.some((command) => command.payload.generatedKind === 'sdd-task-execution'), 'dry-run should contain no execution ticket commands before tasks:approved')
})

check('Ticket detail exposes human receipt disposition telemetry wiring', async () => {
  const source = await fs.readFile(new URL('../src/components/ReceiptDispositionControls.tsx', import.meta.url), 'utf8')
  assert(source.includes('buildHumanActivityEvent'), 'ticket detail should build explicit human activity events')
  assert(source.includes('human-accepted-ai-receipt'), 'ticket detail should expose receipt acceptance')
  assert(source.includes('human-rejected-output'), 'ticket detail should expose receipt rejection')
  assert(source.includes('human-verified-artifact'), 'ticket detail should expose human verification')
  assert(source.includes('appendTelemetry'), 'ticket detail should persist human activity telemetry')
})

check('Receipt disposition persists to Supabase when a linked receipt exists', async () => {
  const detail = await fs.readFile(new URL('../src/components/ReceiptDispositionControls.tsx', import.meta.url), 'utf8')
  const supabase = await fs.readFile(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
  const sql = await fs.readFile(new URL('../supabase/ai_receipts.sql', import.meta.url), 'utf8')

  assert(detail.includes('updateAiReceiptHumanDisposition'), 'ticket detail should call Supabase receipt disposition persistence')
  assert(detail.includes("'accepted'") && detail.includes("'rejected'"), 'ticket detail should map accept/reject actions to durable dispositions')
  assert(supabase.includes('updateAiReceiptHumanDisposition'), 'Supabase helper should expose receipt disposition update')
  assert(supabase.includes(".from('ai_receipts')"), 'Supabase helper should target ai_receipts')
  assert(supabase.includes('human_disposition'), 'Supabase helper should update human_disposition')
  assert(sql.includes('grant update (human_disposition)'), 'SQL should grant column-limited update for human_disposition')
  assert(sql.includes('for update'), 'SQL should include an update RLS policy for receipt disposition')
})

check('Large-view bundle splitting is implemented and documented as a review standard', async () => {
  const app = await fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const onboarding = await fs.readFile(new URL('../src/components/OperationalOnboarding.tsx', import.meta.url), 'utf8')
  const architecture = await fs.readFile(new URL('../docs/architecture.md', import.meta.url), 'utf8')

  assert(app.includes('lazy(') && app.includes('Suspense'), 'App should use React lazy/Suspense for split views')
  assert(app.includes("import('./components/Analytics')"), 'Analytics should be dynamically imported')
  assert(app.includes("import('./components/DataPrivacyView')"), 'Data & Privacy should be dynamically imported')
  assert(!app.includes('ProjectProgressView'), 'the contracted Projects/SDD leaf should not remain in the app shell')
  assert(app.includes("import('./components/EmailPanel')"), 'Email view should be dynamically imported')
  assert(!app.includes("import { Analytics } from './components/Analytics'"), 'Analytics should not be statically imported into the app shell')
  assert(onboarding.includes("lazy(() => import('../App'))"), 'the operational workspace should load only after companion verification')
  assert(!onboarding.includes("import App from '../App'"), 'the operational workspace should not inflate the public/pre-connection entry chunk')
  assert(architecture.includes('bundle-size warnings as a Standards-axis finding'), 'bundle warnings should be documented as a public review standard')
})

check('User-facing copy does not overclaim external agent ticket writes', async () => {
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8')
  const operationsDesk = await fs.readFile(new URL('../src/components/OperationsDesk.tsx', import.meta.url), 'utf8')
  const combined = `${readme}\n${operationsDesk}`
  assert(!combined.includes('Agents create tickets automatically when they start work.'), 'empty state should not claim external agents auto-create tickets')
  assert(!combined.includes('Agents call `agentCreateTicket'), 'README should not instruct external agents to call the browser helper')
  assert(readme.toLowerCase().includes('external codex, claude, and pi sessions need a local bridge or browser automation before their tickets count as live agent-created work'), 'README should state the agent write boundary')
})

check('AI receipts include evidence fields and produce telemetry without human acceptance', () => {
  const receipt = buildAiReceipt({
    ticketId: 'ticket:sdd-task:findmnemo:002:t8',
    projectProgressId: 'project:findmnemo:spec:002',
    agentSource: 'Codex',
    modelOrSurface: 'Codex CLI',
    request: 'Implement T8',
    summary: 'Generated approved task execution tickets.',
    actionsTaken: [{ label: 'Updated scanner', artifactRef: 'scripts/sync-sdd-progress.mjs' }],
    artifactRefs: [{ label: 'Scanner script', kind: 'file', ref: 'scripts/sync-sdd-progress.mjs', visibility: 'local-only' }],
    verification: [{ commandOrCheck: 'npm run check:workflow', result: 'passed', evidenceRef: 'workflow-check' }],
    facts: ['T8 verification passed'],
    assumptions: ['No live write requested'],
    decisions: ['Keep writes local by default'],
    recommendations: ['Proceed to T9'],
    openQuestions: [],
    outcome: 'verified',
    createdAt: '2026-07-09T00:00:00.000Z',
  })
  const events = receiptToTelemetryEvents(receipt)

  assert(receipt.actionsTaken.length === 1, 'receipt should preserve actions taken')
  assert(receipt.artifactRefs.length === 1, 'receipt should preserve artifact refs')
  assert(receipt.verification[0]?.result === 'passed', 'receipt should preserve verification result')
  assert(receipt.facts.length === 1 && receipt.decisions.length === 1, 'receipt should preserve fact and decision lists')
  assert(receipt.humanDisposition === undefined, 'agent receipt should not imply human disposition')
  assert(events[0]?.acceptedOutcome === false, 'AI receipt telemetry should not imply human acceptance')
  assert(events[0]?.activity.id === 'ai-receipt-created', 'receipt should convert to receipt telemetry')
})

check('AI receipt privacy checks reject secrets and raw reasoning markers', () => {
  const findings = findReceiptPrivacyFindings({
    summary: 'Do not store SUPABASE_SERVICE_ROLE_KEY=service_role_fake',
    facts: ['raw chain-of-thought was present'],
  })
  let threw = false
  try {
    buildAiReceipt({
      ticketId: 'ticket-1',
      agentSource: 'Codex',
      request: 'Unsafe',
      summary: `sk-${'thisShouldNotBeStoredBecauseItLooksSecret123'}`,
    })
  } catch {
    threw = true
  }

  assert(findings.length >= 2, 'privacy scan should report multiple prohibited findings')
  assert(threw, 'buildAiReceipt should reject obvious secret-like content')
})

check('Human acceptance or rejection is a separate user-confirmed activity event', () => {
  const accepted = buildHumanActivityEvent({
    activity: 'human-accepted-ai-receipt',
    ticketId: 'ticket:sdd-task:findmnemo:002:t8',
    receiptId: 'ai-receipt:ticket:sdd-task:findmnemo:002:t8:codex',
    note: 'Evidence accepted by Henry.',
  }, undefined, '2026-07-09T00:00:00.000Z')
  const rejected = buildHumanActivityEvent({
    activity: 'human-rejected-output',
    ticketId: 'ticket:sdd-task:findmnemo:002:t8',
    receiptId: 'ai-receipt:ticket:sdd-task:findmnemo:002:t8:codex',
    note: 'Needs follow-up.',
  }, undefined, '2026-07-09T00:01:00.000Z')

  assert(accepted.actor.type === 'human', 'human event should use human actor')
  assert(accepted.truthState === 'user-confirmed', 'human event should be user-confirmed')
  assert(accepted.acceptedOutcome === true, 'acceptance event should mark accepted outcome')
  assert(rejected.result.status === 'failure', 'rejection event should not be recorded as success')
  assert(rejected.acceptedOutcome === false, 'rejection event should not mark accepted outcome')
})

check('AI receipt bridge command shape produces receipt and telemetry dry-run output', () => {
  const output = buildReceiptCommandOutput({
    command: 'ai_receipt.create',
    producer: 'codex',
    sessionId: 'session-1',
    payload: {
      ticketId: 'ticket:sdd-task:findmnemo:002:t9',
      agentSource: 'Codex',
      request: 'Implement T9',
      summary: 'Added receipt command shape.',
      outcome: 'proposed',
    },
  })

  assert(output.receipt.id.includes('ai-receipt'), 'bridge should build a receipt')
  assert(output.receipt.outcome === 'proposed', 'bridge should preserve receipt outcome')
  assert(output.telemetryEvents.length === 1, 'bridge should produce linked telemetry')
})

check('Completed work uses explicit completion evidence rather than last edit time', async () => {
  const files = [
    new URL('../src/components/Analytics.tsx', import.meta.url),
    new URL('../src/components/CompletedWorkPanel.tsx', import.meta.url),
    new URL('../src/lib/attention-workspace.ts', import.meta.url),
  ]
  const source = (await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).join('\n')
  assert(!/status\s*===\s*['"]done['"][\s\S]{0,120}updatedAt|updatedAt[\s\S]{0,120}completed/i.test(source), 'completion calculations must not use updatedAt')
  assert(source.includes('completedAt'), 'completed-work surfaces must use explicit completedAt evidence')
})

let failures = 0

for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.message : error)
  }
}

if (failures > 0) {
  console.error(`\n${failures} workflow helper check(s) failed.`)
  process.exit(1)
}

console.log(`\n${checks.length} workflow helper check(s) passed.`)
