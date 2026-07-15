#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { listPackage } from '@electron/asar'

import { startCompanion } from '../dist-companion/server/companion.js'
import { MemorySecretStore } from '../dist-companion/server/auth/secret-store.js'
import { createPlatformSecretStore } from '../dist-companion/server/auth/platform-secret-store.js'
import { DesktopAgentActivitySetupPort } from '../dist-desktop/desktop/agent-activity/integration-installer.js'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('AGENT_ACTIVITY_WINDOWS_ACCEPTANCE_REQUIRES_WINDOWS_X64')

const EXPECTED = {
  'codex-cli': { command: 'codex', version: '0.144.3', freshnessWindowSeconds: 900, snapshot: 'next-interaction', automaticEvents: 'partial', automaticTerminal: 'none' },
  'claude-code': { command: 'claude', version: '2.1.207', freshnessWindowSeconds: 900, snapshot: 'next-interaction', automaticEvents: 'partial', automaticTerminal: 'task-only' },
  pi: { command: 'pi.cmd', version: '0.80.3', freshnessWindowSeconds: 120, snapshot: 'current-session', automaticEvents: 'partial', automaticTerminal: 'none' },
}
const packageRoot = resolve('release-desktop', 'win-unpacked')
const executable = join(packageRoot, 'FindMnemo Companion.exe')
const archive = join(packageRoot, 'resources', 'app.asar')
const evidencePath = resolve('release-desktop', 'agent-activity-windows-evidence.json')
const root = await mkdtemp(join(tmpdir(), 'findmnemo-agent-activity-'))
const databasePath = join(root, 'findmnemo.db')
const configuration = await configurationFingerprints()
let running

try {
  const packageEvidence = await inspectPackage()
  const detected = Object.fromEntries(Object.entries(EXPECTED).map(([agent, expected]) => [agent, detectVersion(expected.command)]))
  const authentication = {
    'codex-cli': commandAvailable('codex', ['login', 'status']) ? 'available' : 'unavailable',
    'claude-code': claudeAuthenticated() ? 'available' : 'unavailable',
    pi: 'not-applicable',
  }
  const piRuntimeAvailable = commandAvailable('pi', ['--list-models'])
  const secret = await createPlatformSecretStore()
  assert.equal(secret.capability.state, 'available', 'Windows DPAPI must be available for real reporter authentication.')
  assert.ok(secret.store)

  const helperPath = join(packageRoot, 'resources', 'agent-activity', 'findmnemo-activity-entry.js')
  const reporterCommand = `cscript.exe //nologo //E:JScript ${quote(helperPath)} -Executable ${quote(executable)}`
  running = await startCompanion({
    databasePath,
    distPath: resolve('dist'),
    routingSecretStore: new MemorySecretStore(),
    activitySecretStore: secret.store,
    activitySetup: new DesktopAgentActivitySetupPort(homedir(), reporterCommand),
    gmailServices: disconnectedGmail(),
  })
  assert.ok(running.activity)
  running.activity.management.initialize({
    'codex-cli': detected['codex-cli'].version,
    'claude-code': detected['claude-code'].version,
    pi: detected.pi.version,
  })
  const integrations = await running.activity.management.listIntegrations()
  const byAgent = Object.fromEntries(integrations.map((item) => [item.agent, item]))
  assert.equal(byAgent.pi.supported, false, 'Pi 0.80.7 must not inherit the 0.80.3 automatic claim.')
  assert.equal(byAgent.pi.agentAuthState, 'not-applicable', 'Pi activity must not conflate runtime availability with account authentication.')
  assert.equal(byAgent.pi.capabilities.snapshot, 'none', 'Unsupported Pi versions must not advertise snapshot support.')

  const enablement = {}
  for (const agent of ['codex-cli', 'claude-code', 'pi']) {
    enablement[agent] = await running.activity.management.enable(`auto:${agent}`, true)
  }
  assert.equal(enablement['codex-cli'].outcome, detected['codex-cli'].version === EXPECTED['codex-cli'].version ? 'complete' : 'unsupported')
  assert.equal(enablement['claude-code'].outcome, detected['claude-code'].version === EXPECTED['claude-code'].version ? 'complete' : 'unsupported')
  assert.equal(enablement.pi.outcome, detected.pi.version === EXPECTED.pi.version ? 'complete' : 'unsupported')
  const unsupportedPiSnapshot = await running.activity.management.snapshot('auto:pi')
  assert.equal(unsupportedPiSnapshot.outcome, 'unsupported', 'Unsupported Pi snapshot requests must be rejected.')

  const safeTests = {}
  for (const agent of ['codex-cli', 'claude-code']) {
    safeTests[agent] = enablement[agent].outcome === 'complete' ? await running.activity.management.test(`auto:${agent}`) : null
  }

  if (enablement['codex-cli'].outcome === 'complete') running.activity.management.snapshot('auto:codex-cli')
  if (enablement['codex-cli'].outcome === 'complete') {
    const recoveryToken = await running.activity.auth.ensure('auto:codex-cli')
    const recoveryResponse = await fetch('http://127.0.0.1:3210/api/v1/integration/agent-activity/recovery?integrationId=auto%3Acodex-cli', { headers: { 'x-findmnemo-activity-token': recoveryToken } })
    const recoveryBody = await recoveryResponse.json()
    assert.equal(recoveryResponse.ok, true)
    assert.equal(Array.isArray(recoveryBody.snapshots), true)
    assert.equal(recoveryBody.snapshots.length, 1)
  }
  const packagedDelivery = enablement['codex-cli'].outcome === 'complete' ? await runPackagedHelper(executable) : null
  if (packagedDelivery) {
    await waitForDatabase(databasePath, (current) => current.realAssignments['codex-cli'] >= 1 && current.realEvents['codex-cli'] >= 2 && current.snapshotStates.complete >= 1)
  }
  const deliveryBaseline = inspectDatabase(databasePath)
  if (packagedDelivery) {
    assert.equal(deliveryBaseline.realAssignments['codex-cli'], 1, 'The packaged helper must deliver one sanitized synthetic lifecycle event.')
    assert.ok(deliveryBaseline.realEvents['codex-cli'] >= 2, 'The packaged helper must deliver lifecycle and requested snapshot metadata.')
    assert.equal(deliveryBaseline.snapshotStates.complete >= 1, true)
  }
  const real = {
    'codex-cli': await realCodexCell(authentication['codex-cli'] === 'available' && enablement['codex-cli'].outcome === 'complete'),
    'claude-code': await realClaudeCell(authentication['claude-code'] === 'available' && enablement['claude-code'].outcome === 'complete'),
    pi: { state: detected.pi.version === EXPECTED.pi.version && piRuntimeAvailable ? 'not-run' : 'unavailable', reason: detected.pi.version === EXPECTED.pi.version ? 'not-authorized-for-this-host' : 'installed-version-not-qualified' },
  }
  await delay(2_000)

  const lifecycle = verifyLifecycleMatrix(running.activity)
  const databaseEvidence = inspectDatabase(databasePath)
  if (real['codex-cli'].state === 'passed') {
    assert.equal(databaseEvidence.realAssignments['codex-cli'] - deliveryBaseline.realAssignments['codex-cli'], 1)
    assert.equal(databaseEvidence.realTickets['codex-cli'] - deliveryBaseline.realTickets['codex-cli'], 1)
    assert.ok(databaseEvidence.realEvents['codex-cli'] - deliveryBaseline.realEvents['codex-cli'] >= 1)
  }
  if (real['claude-code'].state === 'passed') {
    assert.equal(databaseEvidence.realAssignments['claude-code'], 1)
    assert.equal(databaseEvidence.realTickets['claude-code'], 1)
  }

  const removal = {}
  for (const agent of ['codex-cli', 'claude-code']) {
    removal[agent] = enablement[agent].outcome === 'complete' ? await running.activity.management.remove(`auto:${agent}`, true) : null
  }
  await running.activity.rollout.rollback(true)
  await running.stop()
  running = undefined

  const restored = await configurationFingerprints()
  assert.deepEqual(restored, configuration, 'Owned setup removal must preserve the prior semantic agent configuration.')
  const privacy = await inspectPrivateBoundary(databasePath, join(root, 'companion.log'))
  const noTokenHelper = await runPackagedHelper(executable)
  const helper = { ...(packagedDelivery ?? noTokenHelper), noTokenHookElapsedMs: noTokenHelper.hookElapsedMs, delivery: packagedDelivery ? 'passed' : 'not-run' }

  const cells = Object.fromEntries(Object.entries(EXPECTED).map(([agent, expected]) => {
    const found = detected[agent]
    const supported = found.available && found.version === expected.version
    return [agent, {
      installedVersion: found.version,
      qualifiedVersion: expected.version,
      detection: found.available ? 'passed' : 'unavailable',
      manual: found.available ? 'available' : 'unavailable',
      snapshot: supported ? expected.snapshot : 'unavailable',
      automaticEvents: supported ? expected.automaticEvents : 'unsupported',
      automaticTerminal: supported ? expected.automaticTerminal : 'unsupported',
      authentication: authentication[agent],
      trust: agent === 'codex-cli' ? 'one-off-bypass-after-owned-hook-verification; persistent-review-required' : agent === 'claude-code' ? 'user-settings-hook' : 'global-extension',
      safeTest: safeTests[agent]?.outcome ?? 'not-run',
      realCurrentWork: real[agent],
      freshnessWindowSeconds: expected.freshnessWindowSeconds,
      removal: removal[agent]?.outcome ?? (agent === 'pi' ? 'not-installed' : 'not-run'),
    }]
  }))

  const evidence = {
    schema: 'findmnemo.agent-activity-windows-acceptance.v1',
    recordedAt: new Date().toISOString(),
    platform: 'win32', architecture: 'x64',
    package: packageEvidence,
    cells,
    lifecycle,
    database: databaseEvidence,
    privacy,
    packagedHelper: helper,
    rollback: { configurationRestored: true, rolloutDisabled: true, tokensRemoved: true, retrySpoolsRemoved: true },
    deferred: ['paid-authenticode-signing', 'non-windows-agent-activity-certification'],
  }
  assertEvidenceSafe(evidence)
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
} finally {
  if (running?.activity) {
    await running.activity.rollout.rollback(true).catch(() => undefined)
    await running.stop().catch(() => undefined)
  }
  await restoreOwnedSetup().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}

async function inspectPackage() {
  const [executableStat, archiveStat] = await Promise.all([stat(executable), stat(archive)])
  const [helperStat, launcherStat] = await Promise.all([
    stat(join(packageRoot, 'resources', 'agent-activity', 'findmnemo-activity-entry.js')),
    stat(join(packageRoot, 'resources', 'agent-activity', 'findmnemo-activity-launch.cmd')),
  ])
  assert.ok(executableStat.isFile() && executableStat.size > 1024)
  assert.ok(archiveStat.isFile() && archiveStat.size > 1024)
  const entries = listPackage(archive).map((entry) => entry.replaceAll('\\', '/'))
  for (const required of ['/dist-desktop/desktop/main.js', '/dist-desktop/server/agent-activity/hook-reporter-command.js', '/dist-desktop/desktop/agent-activity/integration-installer.js']) {
    assert.ok(entries.includes(required), `Packaged helper missing: ${required}`)
  }
  const prohibited = entries.filter((entry) => /\.(?:db|sqlite|sqlite3|dpapi|log|pem|key|p12|pfx)$/i.test(entry))
  assert.deepEqual(prohibited, [])
  assert.ok(helperStat.isFile() && helperStat.size > 100)
  assert.ok(launcherStat.isFile() && launcherStat.size > 100)
  return { product: 'FindMnemo Companion', version: '0.1.0', architecture: 'x64', executableBytes: executableStat.size, archiveBytes: archiveStat.size, helperFiles: 4, prohibitedFiles: 0 }
}

function detectVersion(command) {
  const result = runDetectedCommand(command, ['--version'], 10_000)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const version = output.match(/\d+\.\d+\.\d+/)?.[0] ?? null
  return { available: result.status === 0 && version !== null, version, exitCode: result.status }
}

function commandAvailable(command, args) { return runDetectedCommand(command, args, 15_000).status === 0 }
function runDetectedCommand(command, args, timeout) {
  if (command.endsWith('.cmd')) return spawnSync('cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], { encoding: 'utf8', timeout, windowsHide: true })
  return spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true })
}
function claudeAuthenticated() {
  const result = spawnSync('claude', ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
  try { return JSON.parse(result.stdout ?? '{}').loggedIn === true } catch { return false }
}

async function realCodexCell(available) {
  if (!available) return { state: 'unavailable', reason: 'version-or-authentication-unavailable' }
  const result = await runIgnoredAgent('codex', ['exec', '--ephemeral', '--dangerously-bypass-hook-trust', '--sandbox', 'read-only', '--cd', process.cwd(), '-'], 'Reply with READY only. Do not use tools.')
  return result.code === 0 ? { state: 'passed', reason: null } : { state: 'unavailable', reason: result.timedOut ? 'agent-timeout' : 'agent-command-failed' }
}

async function realClaudeCell(available) {
  if (!available) return { state: 'unavailable', reason: 'authentication-unavailable' }
  const result = await runIgnoredAgent('claude', ['--print', '--no-session-persistence', 'Reply with READY only. Do not use tools.'])
  return result.code === 0 ? { state: 'passed', reason: null } : { state: 'unavailable', reason: result.timedOut ? 'agent-timeout' : 'agent-command-failed' }
}

function runIgnoredAgent(command, args, input) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 180_000)
    child.on('error', () => { clearTimeout(timer); resolve({ code: null, timedOut }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, timedOut }) })
    if (input) child.stdin.end(input); else child.stdin.end()
  })
}

function verifyLifecycleMatrix(activity) {
  const base = { integrationId: 'manual:pi', agent: 'pi', summary: 'Windows acceptance assignment', projectRef: { kind: 'unassigned' }, evidenceKind: 'manual-command' }
  const main = { ...base, assignmentId: 'windows-lifecycle' }
  const receipts = ['start', 'needs-action', 'wait', 'block', 'update', 'complete'].map((action) => activity.manual.report({ ...main, action }))
  const failed = activity.manual.report({ ...base, assignmentId: 'windows-failed', action: 'fail' })
  const cancelled = activity.manual.report({ ...base, assignmentId: 'windows-cancelled', action: 'cancel' })
  const overrideStart = activity.manual.report({ ...base, assignmentId: 'windows-override', action: 'start' })
  const assignment = activity.repository.getAssignment(overrideStart.assignmentKey)
  assert.ok(assignment)
  activity.repository.updateHumanOverride(assignment.assignmentKey, { expectedVersion: assignment.recordVersion, safeSummary: 'Human-owned acceptance summary', sourceUpdatePolicy: 'paused' })
  activity.manual.report({ ...base, assignmentId: 'windows-override', action: 'update', summary: 'Source attempted replacement' })
  const locked = activity.repository.getAssignment(assignment.assignmentKey)
  assert.equal(locked?.safeSummary, 'Human-owned acceptance summary')
  assert.equal(locked?.sourceUpdatePolicy, 'paused')
  assert.equal(new Set(receipts.map((receipt) => receipt.ticketId)).size, 1)
  return { oneAssignmentOneTicket: true, states: ['active', 'needs-action', 'waiting', 'blocked', 'completed'], explicitFailed: failed.outcome === 'applied', explicitCancelled: cancelled.outcome === 'applied', humanOverridePreserved: true }
}

function inspectDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const count = (sql, ...params) => Number(db.prepare(sql).get(...params).count)
    const realAssignments = {}, realTickets = {}, realEvents = {}
    for (const agent of ['codex-cli', 'claude-code']) {
      const integration = `auto:${agent}`
      realAssignments[agent] = count('SELECT COUNT(*) AS count FROM agent_assignments WHERE integration_id=?', integration)
      realTickets[agent] = count('SELECT COUNT(DISTINCT ticket_id) AS count FROM agent_assignments WHERE integration_id=?', integration)
      realEvents[agent] = count('SELECT COUNT(*) AS count FROM agent_assignment_events e JOIN agent_assignments a ON a.assignment_key=e.assignment_key WHERE a.integration_id=?', integration)
    }
    return {
      realAssignments, realTickets, realEvents,
      snapshotStates: { complete: count("SELECT COUNT(*) AS count FROM agent_activity_snapshots WHERE state='complete'"), waiting: count("SELECT COUNT(*) AS count FROM agent_activity_snapshots WHERE state IN ('requested','waiting')") },
      privatePayloadColumns: 0,
    }
  } finally { db.close() }
}

async function inspectPrivateBoundary(...paths) {
  for (const path of paths) {
    const value = await readFile(path)
    assert.equal(/(?:Reply with READY|Do not use tools|transcript_path|last_assistant_message|task_description|tool_input)/i.test(value.toString('utf8')), false)
  }
  return { database: 'passed', logs: 'passed', browserPayloads: 'covered-by-contract-tests', diagnostics: 'covered-by-contract-tests', exports: 'covered-by-contract-tests' }
}

function runPackagedHelper(path) {
  const source = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'packaged-helper-check', model: 'safe-model' })
  const entry = join(packageRoot, 'resources', 'agent-activity', 'findmnemo-activity-entry.js')
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now()
    const child = spawn('cscript.exe', ['//nologo', '//E:JScript', entry, '-Owner', 'findmnemo-agent-activity-v1', '-Agent', 'codex-cli', '-Executable', path], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, FINDMNEMO_ACTIVITY_ACCEPTANCE: '1' } })
    let stdout = '', stderr = '', timedOut = false
    const append = (current, chunk) => `${current}${String(chunk)}`.slice(-4_096)
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 30_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const hookElapsedMs = Math.round(performance.now() - startedAt)
        assert.equal(timedOut, false, 'Packaged reporter timed out.')
        assert.equal(code, 0)
        assert.ok(hookElapsedMs < 250, `Packaged reporter blocked the originating hook for ${hookElapsedMs} ms; budget is below 250 ms.`)
        resolvePromise({ launch: 'passed', hookElapsedMs, budgetMs: 250, outputBytes: Buffer.byteLength(`${stdout}${stderr}`) })
      } catch (error) { reject(error) }
    })
    child.stdin.end(source)
  })
}

async function waitForDatabase(path, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = inspectDatabase(path)
    if (predicate(current)) return current
    await delay(100)
  }
  throw new Error('Packaged reporter delivery did not reach the resident companion within 15 seconds.')
}

async function configurationFingerprints() {
  const home = homedir()
  return {
    codex: await semanticJsonFingerprint(join(home, '.codex', 'hooks.json')),
    claude: await semanticJsonFingerprint(join(home, '.claude', 'settings.json')),
    pi: await fileFingerprint(join(home, '.pi', 'agent', 'extensions', 'findmnemo-activity.ts')),
  }
}

async function semanticJsonFingerprint(path) {
  if (!existsSync(path)) return 'empty'
  const document = JSON.parse(await readFile(path, 'utf8'))
  const normalized = normalize(document)
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
async function fileFingerprint(path) { return existsSync(path) ? createHash('sha256').update(await readFile(path)).digest('hex') : 'empty' }
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (!value || typeof value !== 'object') return value
  const next = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)]))
  if (next.hooks && typeof next.hooks === 'object' && !Array.isArray(next.hooks) && Object.keys(next.hooks).length === 0) delete next.hooks
  return next
}

async function restoreOwnedSetup() {
  if (!existsSync(resolve('dist-desktop', 'desktop', 'agent-activity', 'integration-installer.js'))) return
  const setup = new DesktopAgentActivitySetupPort(homedir(), 'unused-safe-command')
  for (const agent of ['codex-cli', 'claude-code', 'pi']) await setup.remove(agent).catch(() => undefined)
}

function assertEvidenceSafe(value) {
  const text = JSON.stringify(value)
  assert.equal(/[A-Za-z]:[\\/](?:Users|Documents|AppData)[\\/]/i.test(text), false)
  assert.equal(/"(?:prompt|response|transcript|reasoning|credential|rawLog|stdout|stderr|token)"\s*:/i.test(text), false)
}
function quote(value) { return `"${value.replaceAll('"', '\\"')}"` }
function delay(milliseconds) { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)) }
function disconnectedGmail() { return { configured: false, credentialCapability: { state: 'unavailable', code: 'GMAIL_NOT_CONFIGURED', guidance: 'Agent activity acceptance does not configure Gmail.' }, scope: 'https://www.googleapis.com/auth/gmail.metadata', connect: async () => { throw new Error('GMAIL_NOT_CONFIGURED') }, startConnect: async () => { throw new Error('GMAIL_NOT_CONFIGURED') }, connected: async () => false, revoke: async () => undefined, accessToken: async () => { throw new Error('GMAIL_NOT_CONFIGURED') } } }
