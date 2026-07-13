#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  approvedTaskToExecutionTicket,
  projectProgressToGatePlaceholderTicket,
  stableProjectProgressId,
  stableSddTaskTicketId,
} from '../src/lib/generated-tickets.ts'
import {
  attentionIssuesForGate,
  isValidSddGate,
  normalizePathVisibility,
  normalizeProjectProgressItem,
} from '../src/lib/sdd-progress.ts'
import { scanSddProjectRoot } from '../shared/sdd-scanner.ts'

const DEFAULT_REGISTRY = path.join(os.homedir(), 'Vaults', 'LLM Wiki', 'system', 'projects', 'project_registry.py')

const ACTIVE_PLACEHOLDER_GATES = new Set([
  'requirements:draft',
  'requirements:approved',
  'design:draft',
  'design:approved',
  'tasks:draft',
  'tasks:approved',
  'implementation:in-progress',
  'implementation:done',
  'invalid-status',
  'stale-path',
])

function parseArgs(argv) {
  const options = {
    registry: process.env.FINDMNEMO_PROJECT_REGISTRY || DEFAULT_REGISTRY,
    project: undefined,
    write: false,
    json: false,
    pathVisibility: normalizePathVisibility(process.env.FINDMNEMO_PATH_VISIBILITY),
    commandsOut: undefined,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.write = false
    else if (arg === '--write') options.write = true
    else if (arg === '--json') options.json = true
    else if (arg === '--registry') options.registry = argv[++i]
    else if (arg === '--project') options.project = argv[++i]
    else if (arg === '--path-visibility') options.pathVisibility = normalizePathVisibility(argv[++i])
    else if (arg === '--commands-out') options.commandsOut = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: node scripts/sync-sdd-progress.mjs [options]

Options:
  --dry-run                 Scan and print generated rows/commands without writes (default)
  --write                   Upsert project_progress_items with SUPABASE_SERVICE_ROLE_KEY
  --project <name-or-alias> Resolve and scan one registry project
  --registry <path>         Path to project_registry.py
  --path-visibility <mode>  hidden, local-only, or visible (default: hidden)
  --commands-out <path>     Write generated ticket/telemetry commands as JSONL
  --json                    Print full JSON result
`)
}

function runRegistry(registryPath, args) {
  return execFileSync('python', [registryPath, ...args], { encoding: 'utf8' })
}

function resolveProject(registryPath, name) {
  const output = runRegistry(registryPath, ['resolve', name, '--json'])
  return JSON.parse(output)
}

function listRegistryProjects(registryPath) {
  const output = runRegistry(registryPath, ['audit'])
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/)
      return match ? { id: match[1], health: match[2], path: match[3] } : undefined
    })
    .filter(Boolean)
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

function toProjectRelative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/')
}

function attachScannerSource(item, projectRoot, specDir) {
  Object.defineProperty(item, 'sourceRoot', {
    value: projectRoot,
    enumerable: false,
  })
  if (specDir) {
    Object.defineProperty(item, 'sourceSpecDir', {
      value: specDir,
      enumerable: false,
    })
  }
  return item
}

function sectionText(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = markdown.match(new RegExp(`### ${escaped}\\r?\\n([\\s\\S]*?)(?=\\r?\\n### |\\r?\\n## |$)`))
  return match?.[1]?.trim() ?? ''
}

function checklistItemsFromSection(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^-\s+\[[ xX]\]\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
}

function metadataValue(block, label) {
  const match = block.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\r\\n]+)`))
  return match?.[1]?.trim()
}

function parseTaskBlock(block) {
  const heading = block.match(/^## Task (T[0-9A-Za-z.-]+):\s+(.+)$/m)
  if (!heading) return undefined
  const taskId = heading[1].trim()
  const title = heading[2].trim()
  const blockedByText = metadataValue(block, 'Blocked By') ?? 'none'
  const delivers = metadataValue(block, 'Delivers')
  const acceptanceCriteria = checklistItemsFromSection(sectionText(block, 'Acceptance Criteria'))
  const verificationChecks = checklistItemsFromSection(sectionText(block, 'Verification'))
  const blockers = blockedByText
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.toLowerCase() !== 'none')

  return {
    taskId,
    title,
    description: delivers ?? title,
    delivers,
    blockedByTaskIds: blockers,
    acceptanceCriteria,
    verificationChecks,
  }
}

export function parseApprovedTasksMarkdown(markdown) {
  const taskBlocks = markdown
    .split(/\r?\n(?=## Task T[0-9A-Za-z.-]+:)/)
    .filter((block) => block.startsWith('## Task '))

  return taskBlocks.map(parseTaskBlock).filter(Boolean)
}

export function taskRecordToExecutionSeed(task, item, scannedAt) {
  const projectId = item.projectId
  const specId = item.specId ?? 'uninitialized'
  const taskTicketId = stableSddTaskTicketId(projectId, specId, task.taskId)
  const blockedBy = task.blockedByTaskIds.map((blocker) => (
    /^T[0-9A-Za-z.-]+$/.test(blocker)
      ? stableSddTaskTicketId(projectId, specId, blocker)
      : blocker
  ))

  return {
    id: taskTicketId,
    projectProgressId: item.id,
    projectId,
    specId,
    taskId: task.taskId,
    title: `${item.projectName} ${task.taskId}: ${task.title}`,
    description: task.description,
    delivers: task.delivers,
    acceptanceCriteria: task.acceptanceCriteria.map((text, index) => ({
      id: `ac:${task.taskId.toLowerCase()}:${index + 1}`,
      text,
      checked: false,
    })),
    verificationChecks: task.verificationChecks.map((text, index) => ({
      id: `vc:${task.taskId.toLowerCase()}:${index + 1}`,
      commandOrCheck: text,
      result: 'not-run',
    })),
    blockedBy,
    artifactRefs: item.artifactRefs,
    generatedAt: scannedAt,
  }
}

async function scanProject(project, options, scannedAt) {
  const projectRoot = project.canonical_path
  const projectId = project.id
  const projectName = project.name || project.id

  const scan = await scanSddProjectRoot(projectRoot)
  if (scan.state === 'missing') {
    const item = normalizeProjectProgressItem({
      id: stableProjectProgressId(projectId, 'registry-attention'),
      projectId,
      projectName,
      specId: 'registry-attention',
      specTitle: 'Registry path attention',
      currentGate: 'stale-path',
      artifactRefs: [],
      canonicalPath: projectRoot,
      pathVisibility: options.pathVisibility,
      lastScannedAt: scannedAt,
      issues: attentionIssuesForGate('stale-path', `Registry path is missing or unavailable: ${projectRoot ?? 'unknown'}`),
    })
    return [item]
  }

  if (scan.state === 'uninitialized') {
    const item = normalizeProjectProgressItem({
      projectId,
      projectName,
      specId: 'uninitialized',
      specTitle: 'No SDD specs found',
      currentGate: 'uninitialized',
      artifactRefs: [],
      canonicalPath: projectRoot,
      pathVisibility: options.pathVisibility,
      lastScannedAt: scannedAt,
    })
    return [attachScannerSource(item, projectRoot)]
  }

  const items = []
  for (const spec of scan.specs) {
    const specId = spec.specId
    const specDir = path.join(projectRoot, '.ai', 'sdd', 'specs', specId)
    const statusPath = path.join(specDir, '.status')
    const rawStatus = spec.rawStatus
    const currentGate = isValidSddGate(rawStatus) ? rawStatus : 'invalid-status'
    const issueMessage = rawStatus
      ? `Invalid .status value "${rawStatus}" in ${toProjectRelative(projectRoot, statusPath)}`
      : `Missing .status file in ${toProjectRelative(projectRoot, specDir)}`

    const item = normalizeProjectProgressItem({
      projectId,
      projectName,
      specId,
      specTitle: spec.specTitle,
      currentGate,
      artifactRefs: spec.artifactRefs,
      canonicalPath: projectRoot,
      pathVisibility: options.pathVisibility,
      lastScannedAt: scannedAt,
      issues: currentGate === 'invalid-status' ? attentionIssuesForGate('invalid-status', issueMessage) : [],
    })
    items.push(attachScannerSource(item, projectRoot, specDir))
  }

  return items
}

function projectProgressRow(item) {
  return {
    id: item.id,
    project_id: item.projectId,
    project_name: item.projectName,
    spec_id: item.specId ?? null,
    spec_title: item.specTitle ?? null,
    current_gate: item.currentGate,
    next_safe_action: item.nextSafeAction,
    artifact_refs: item.artifactRefs,
    canonical_path: item.canonicalPath ?? null,
    path_visibility: item.pathVisibility,
    origin: item.origin,
    last_scanned_at: item.lastScannedAt,
    issues: item.issues,
  }
}

function makeTelemetryEvent({ id, caseId, label, timestamp, resultStatus = 'success', message, tags = [] }) {
  return {
    eventId: id,
    caseId,
    traceId: `sdd-sync-${caseId}`,
    timestamp,
    sequence: 0,
    intent: 'Sync SDD project progress',
    activity: {
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label,
      type: 'reconcile',
      primitiveVersion: '1.0.0',
    },
    actor: {
      id: 'system-sdd-progress-scanner',
      label: 'SDD Progress Scanner',
      type: 'system',
      role: 'registry sync',
      authorityLevel: 2,
    },
    objects: [{
      id: caseId,
      type: 'sdd-project-progress',
      role: 'subject',
      sourceRef: `mnemosync://project-progress/${caseId}`,
      classification: 'private-work-data',
    }],
    result: {
      status: resultStatus,
      ...(message ? { message } : {}),
    },
    truthState: 'observed',
    provenance: {
      sourceType: 'mnemosync',
      sourceRef: 'scripts/sync-sdd-progress.mjs',
      ingestedAt: timestamp,
      transformation: 'FindMnemo local SDD registry scanner',
    },
    tags: [...new Set(['mnemosync', 'sdd-sync', ...tags])],
  }
}

async function buildTaskExecutionCommands(items, scannedAt) {
  const commands = []
  for (const item of items) {
    if (item.currentGate !== 'tasks:approved') continue
    const tasksRef = item.artifactRefs.find((ref) => ref.kind === 'tasks')
    const projectRoot = item.sourceRoot
    if (!tasksRef || !projectRoot) continue
    const tasksMarkdown = await readTextIfExists(path.join(projectRoot, tasksRef.path))
    if (!tasksMarkdown) continue
    for (const task of parseApprovedTasksMarkdown(tasksMarkdown)) {
      commands.push({
        command: 'ticket.upsert',
        producer: 'sdd-progress-scanner',
        payload: approvedTaskToExecutionTicket(taskRecordToExecutionSeed(task, item, scannedAt)),
      })
    }
  }
  return commands
}

async function buildCommands(items, scannedAt) {
  const activeItems = items.filter((item) => ACTIVE_PLACEHOLDER_GATES.has(item.currentGate))
  const gatePlaceholderCommands = activeItems.map((item) => ({
    command: 'ticket.upsert',
    producer: 'sdd-progress-scanner',
    payload: projectProgressToGatePlaceholderTicket(item),
  }))
  const taskExecutionCommands = await buildTaskExecutionCommands(items, scannedAt)

  const scanEvents = items.map((item) => makeTelemetryEvent({
    id: `mnemo-sdd-scan-${item.id}`,
    caseId: item.id,
    label: 'SDD status scanned',
    timestamp: scannedAt,
    resultStatus: item.issues.some((issue) => issue.severity === 'blocker') ? 'exception' : 'success',
    message: `${item.projectName} ${item.specId ?? 'project'} scanned at ${item.currentGate}`,
    tags: ['sdd-status-scanned', item.currentGate],
  }))

  const placeholderEvents = gatePlaceholderCommands.map((command) => makeTelemetryEvent({
    id: `mnemo-sdd-placeholder-${command.payload.id}`,
    caseId: command.payload.id,
    label: 'SDD gate placeholder upserted',
    timestamp: scannedAt,
    message: command.payload.title,
    tags: ['sdd-gate-placeholder', command.payload.sddGate],
  }))

  const taskExecutionEvents = taskExecutionCommands.map((command) => makeTelemetryEvent({
    id: `mnemo-sdd-task-${command.payload.id}`,
    caseId: command.payload.id,
    label: 'SDD task execution ticket upserted',
    timestamp: scannedAt,
    message: command.payload.title,
    tags: ['sdd-task-execution', command.payload.sddSpecId],
  }))

  return {
    gatePlaceholderCommands,
    taskExecutionCommands,
    ticketCommands: [...gatePlaceholderCommands, ...taskExecutionCommands],
    telemetryCommands: [...scanEvents, ...placeholderEvents, ...taskExecutionEvents].map((event) => ({
      command: 'telemetry.emit',
      producer: 'sdd-progress-scanner',
      payload: event,
    })),
  }
}

async function upsertProjectProgress(rows) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for --write')
  }

  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) throw new Error('SUPABASE_URL is required for --write')
  const response = await fetch(`${supabaseUrl}/rest/v1/project_progress_items?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })

  if (!response.ok) {
    throw new Error(`Supabase upsert failed: ${response.status} ${await response.text()}`)
  }
}

async function writeCommandsJsonl(filePath, commands) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, commands.map((command) => JSON.stringify(command)).join('\n') + '\n')
}

async function loadProjects(options) {
  if (options.project) return [resolveProject(options.registry, options.project)]

  const auditRows = listRegistryProjects(options.registry)
  return auditRows.map((row) => {
    try {
      return resolveProject(options.registry, row.id)
    } catch {
      return {
        id: row.id,
        name: row.id,
        canonical_path: row.path,
        health: row.health,
      }
    }
  })
}

export async function runSync(options) {
  const scannedAt = new Date().toISOString()
  const projects = await loadProjects(options)
  const items = []

  for (const project of projects) {
    items.push(...await scanProject(project, options, scannedAt))
  }

  const { gatePlaceholderCommands, taskExecutionCommands, ticketCommands, telemetryCommands } = await buildCommands(items, scannedAt)
  const rows = items.map(projectProgressRow)

  if (options.write) {
    await upsertProjectProgress(rows)
  }

  const allCommands = [...ticketCommands, ...telemetryCommands]
  if (options.commandsOut) {
    await writeCommandsJsonl(options.commandsOut, allCommands)
  }

  return {
    mode: options.write ? 'write' : 'dry-run',
    scannedAt,
    projectProgressItems: items,
    projectProgressRows: rows,
    ticketCommands,
    telemetryCommands,
    summary: {
      projects: projects.length,
      projectProgressItems: items.length,
      gatePlaceholderTickets: gatePlaceholderCommands.length,
      taskExecutionTickets: taskExecutionCommands.length,
      telemetryEvents: telemetryCommands.length,
      supabaseUpserted: options.write ? rows.length : 0,
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = await runSync(options)
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`FindMnemo SDD sync ${result.mode}`)
      console.log(`Projects scanned: ${result.summary.projects}`)
      console.log(`Project progress items: ${result.summary.projectProgressItems}`)
      console.log(`Gate placeholder tickets: ${result.summary.gatePlaceholderTickets}`)
      console.log(`Task execution tickets: ${result.summary.taskExecutionTickets}`)
      console.log(`Telemetry events: ${result.summary.telemetryEvents}`)
      if (options.write) console.log(`Supabase rows upserted: ${result.summary.supabaseUpserted}`)
      if (options.commandsOut) console.log(`Commands written: ${options.commandsOut}`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
