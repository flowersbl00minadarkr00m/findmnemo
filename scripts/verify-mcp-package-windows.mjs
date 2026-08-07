#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { extractFile, listPackage } from '@electron/asar'
import {
  consumeDesktopPackageReceipt,
  finalizeConsumedDesktopPackageReceipt,
} from './desktop-package-receipt.mjs'
import { indexAsarEntries } from './asar-entry.mjs'
import { createJsonRpcLinesParser } from './json-rpc-lines.mjs'
import { createMcpPackageRuntimeEnvironment } from './mcp-package-runtime-environment.mjs'
import { assertPeIconMatchesIco } from './pe-icon.mjs'
import { verifyCheckedInWindowsIcon } from './windows-icon.mjs'

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('MCP_PACKAGE_ACCEPTANCE_REQUIRES_WINDOWS_X64')

const releaseRoot = resolve('release-desktop')
const packageRoot = resolve(releaseRoot, 'win-unpacked')
const executable = join(packageRoot, 'FindMnemo Companion.exe')
const archive = join(packageRoot, 'resources', 'app.asar')
const checkedInIcon = resolve('build', 'icon.ico')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'findmnemo-mcp-package-'))
const activeChildren = new Set()
const protocolCanary = `T4A_PROTOCOL_CANARY_${randomUUID()}`
const credentialName = 'routing-integration-token-v1.dpapi'
const phases = ['gui-first', 'mcp-first']
let consumedPackageReceipt

try {
  consumedPackageReceipt = await consumeDesktopPackageReceipt({ releaseRoot })
  const iconEvidence = await verifyCheckedInWindowsIcon()
  const packageEvidence = await inspectPackage(iconEvidence, consumedPackageReceipt.evidence)
  const existingIdentity = await readIdentity()
  const localAppData = existingIdentity
    ? requiredEnvironmentPath('LOCALAPPDATA')
    : join(temporaryRoot, 'LocalAppData')
  const dataRoot = join(localAppData, 'FindMnemo')
  const credentialPath = join(dataRoot, 'secrets', credentialName)
  const credentialBefore = await optionalDigest(credentialPath)

  if (!existingIdentity) {
    await mkdir(dataRoot, { recursive: true })
    await writeFile(join(dataRoot, 'lifecycle.json'), `${JSON.stringify({
      schema: 'findmnemo.lifecycle.v1',
      instanceId: 't4a-package-acceptance',
      startupEnabled: false,
      disclosureVersion: '1.0.0',
      disclosureAcceptedAt: '2026-07-23T00:00:00.000Z',
    }, null, 2)}\n`, { mode: 0o600 })
  }

  const runtimeEvidence = []
  for (const phase of phases) {
    runtimeEvidence.push(await runOrder(phase, {
      localAppData,
      expectedIdentity: existingIdentity?.instanceId ?? 't4a-package-acceptance',
      externalCompanion: Boolean(existingIdentity),
    }))
  }

  const credentialAfter = await optionalDigest(credentialPath)
  assert.ok(credentialAfter, 'The real Windows DPAPI routing credential must exist after packaged MCP startup.')
  if (credentialBefore) assert.equal(credentialAfter, credentialBefore, 'Packaged MCP verification must not rotate an existing healthy routing credential.')
  await assertCanaryAbsent(join(dataRoot, 'logs'), protocolCanary)
  const failureEvidence = await verifySafeStartupFailure(runtimeEnvironment({
    phase: 'safe-failure',
    localAppData,
  }))

  console.log(JSON.stringify({
    package: packageEvidence,
    runtime: {
      credentialBackend: 'windows-dpapi',
      credentialState: credentialBefore ? 'present-and-stable' : 'created-and-reused',
      companionMode: existingIdentity ? 'existing-compatible-loopback' : 'isolated-packaged-loopback',
      startOrders: runtimeEvidence,
      startupFailure: failureEvidence,
      protocolCanaryExcludedFromStdoutStderrAndLogs: true,
    },
    releaseBoundary: {
      artifact: 'local-unpacked-test-package',
      signing: 'not-claimed',
      publication: 'T11',
    },
  }, null, 2))
} finally {
  for (const child of activeChildren) await terminateTree(child).catch(() => undefined)
  if (consumedPackageReceipt) await finalizeConsumedDesktopPackageReceipt(consumedPackageReceipt)
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function inspectPackage(iconEvidence, receiptEvidence) {
  const [executableStat, archiveStat] = await Promise.all([stat(executable), stat(archive)])
  assert.ok(executableStat.isFile() && executableStat.size > 1024, 'Packaged companion executable is missing or invalid.')
  assert.ok(archiveStat.isFile() && archiveStat.size > 1024, 'Packaged ASAR is missing or invalid.')
  const [executableSha256, asarSha256, iconBuffer, executableBuffer] = await Promise.all([
    fileDigest(executable),
    fileDigest(archive),
    readFile(checkedInIcon),
    readFile(executable),
  ])
  assert.equal(receiptEvidence.artifacts.executable.sha256, executableSha256, 'Current-run executable receipt hash mismatch.')
  assert.equal(receiptEvidence.artifacts.asar.sha256, asarSha256, 'Current-run ASAR receipt hash mismatch.')
  const peIcon = assertPeIconMatchesIco(executableBuffer, iconBuffer)
  const archiveEntries = indexAsarEntries(listPackage(archive))
  const entries = archiveEntries.normalizedNames
  const requiredEntries = [
    '/dist-desktop/desktop/main.js',
    '/dist-desktop/desktop/process-mode.js',
    '/dist-desktop/desktop/agent-activity/mcp-command.js',
    '/dist-desktop/server/mcp/findmnemo-mcp.js',
    '/dist-desktop/server/mcp/companion-transport.js',
    '/dist-desktop/server/mcp/activity-transport.js',
    '/dist-desktop/server/auth/platform-secret-store.js',
    '/dist-desktop/server/auth/windows-dpapi-store.js',
    '/dist-desktop/server/routing/integration-auth.js',
    '/dist-desktop/shared/agent-activity-contract.js',
    '/node_modules/electron-updater/package.json',
  ]
  for (const entry of requiredEntries) assert.ok(entries.includes(entry), `MCP_PACKAGE_ASSET_MISSING:${entry}`)
  const prohibited = entries.filter((entry) => /\.(?:db|sqlite|sqlite3|dpapi|log|pem|key|p12|pfx)$/i.test(entry))
  assert.deepEqual(prohibited, [], 'The ASAR must not contain credentials, databases, logs, or private key material.')

  const inspectedSources = requiredEntries
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => {
      const archiveEntry = archiveEntries.byNormalizedName.get(entry)
      assert.ok(archiveEntry, `MCP_PACKAGE_ASSET_MISSING:${entry}`)
      return extractFile(archive, archiveEntry.extractionPath).toString('utf8')
    })
    .join('\n')
  for (const checkoutMarker of [
    'C:\\Users\\henry\\mnemosync',
    'C:/Users/henry/mnemosync',
    'dist-companion/server/mcp/findmnemo-mcp.js',
  ]) assert.equal(inspectedSources.includes(checkoutMarker), false, `MCP_PACKAGE_CHECKOUT_PATH_PRESENT:${checkoutMarker}`)
  assert.match(inspectedSources, /runMcpProcess/)
  assert.match(inspectedSources, /createPlatformSecretStore/)

  return {
    currentRunReceipt: {
      schema: receiptEvidence.schema,
      runId: receiptEvidence.runId,
      startedAt: receiptEvidence.startedAt,
      completedAt: receiptEvidence.completedAt,
      consumedExactlyOnce: true,
    },
    executableBytes: executableStat.size,
    executableSha256,
    asarBytes: archiveStat.size,
    asarSha256,
    requiredRuntimeEntries: requiredEntries.length,
    prohibitedPrivateEntries: prohibited.length,
    windowsIcon: {
      sourceSha256: iconEvidence.sourceSha256,
      outputSha256: iconEvidence.outputSha256,
      sizes: iconEvidence.sizes,
      tools: {
        ...iconEvidence.tools,
        ...peIcon.tool,
      },
      pe: peIcon,
    },
    launch: {
      executable: 'FindMnemo Companion.exe',
      args: ['--mcp-server', '--origin=codex-mcp', '--surface=codex-cli'],
      checkoutOrGlobalNodeRequired: false,
    },
  }
}

async function runOrder(phase, options) {
  const env = runtimeEnvironment({ phase, localAppData: options.localAppData })
  let gui
  let mcp
  try {
    if (phase === 'gui-first') {
      gui = spawnTracked(executable, [], env)
      await waitForGui(gui, options)
      mcp = spawnMcp(env)
      await exerciseProtocol(mcp)
    } else {
      mcp = spawnMcp(env)
      await initializeAndList(mcp)
      gui = spawnTracked(executable, [], env)
      await waitForGui(gui, options)
      await exerciseMeaningfulCallAndEof(mcp)
    }

    assert.equal(gui.exitCode, null, `${phase}: GUI must remain the singleton owner after MCP EOF.`)
    const identityAfterMcp = await waitForIdentity(options.expectedIdentity)
    assert.equal(identityAfterMcp.instanceId, options.expectedIdentity, `${phase}: MCP must not replace or stop the companion identity.`)
    assert.equal(mcp.stderr, '', `${phase}: successful MCP stderr must remain empty.`)
    assert.equal(gui.stdoutCapture.includes(protocolCanary) || gui.stderrCapture.includes(protocolCanary), false, `${phase}: GUI output must not contain protocol canaries.`)
    return {
      order: phase,
      initialize: 'passed',
      toolsList: 'passed',
      meaningfulToolCall: 'recommend_route explicit-self preflight passed',
      notificationOutput: 'silent',
      stdout: 'json-rpc-only',
      stderr: 'empty',
      eofExitCode: mcp.exitCode,
      guiRemainedOwner: true,
      companionIdentityPreserved: true,
    }
  } finally {
    if (mcp?.exitCode === null) {
      mcp.child.stdin.end()
      await waitForExit(mcp.child, 5_000).catch(() => terminateTree(mcp.child))
    }
    if (gui) await terminateTree(gui)
    if (!options.externalCompanion) await waitForIdentityUnavailable()
  }
}

function spawnMcp(env) {
  const child = spawnTracked(executable, [
    '--mcp-server',
    '--origin=codex-mcp',
    '--surface=codex-cli',
  ], env, ['pipe', 'pipe', 'pipe'])
  const state = {
    child,
    stdoutDiagnostic: '',
    stderr: '',
    lines: [],
    responses: new Map(),
    protocolError: null,
    exitCode: null,
  }
  const parser = createJsonRpcLinesParser({
    onMessage(message, line) {
      state.lines.push(line)
      state.responses.set(message.id, message)
    },
  })
  state.parser = parser
  child.stdout.on('data', (chunk) => {
    state.stdoutDiagnostic = bounded(state.stdoutDiagnostic, chunk)
    try {
      parser.push(chunk)
    } catch (cause) {
      state.protocolError = cause
      child.stdin.end()
    }
  })
  child.stderr.on('data', (chunk) => { state.stderr = bounded(state.stderr, chunk) })
  child.on('close', (code) => { state.exitCode = code })
  return state
}

async function exerciseProtocol(state) {
  await initializeAndList(state)
  await exerciseMeaningfulCallAndEof(state)
}

async function initializeAndList(state) {
  writeRpc(state, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  writeRpc(state, { jsonrpc: '2.0', method: 'notifications/initialized', params: { canary: protocolCanary } })
  writeRpc(state, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const initialized = await waitForResponse(state, 1)
  const listed = await waitForResponse(state, 2)
  assert.equal(initialized.result?.protocolVersion, '2025-06-18')
  const tools = listed.result?.tools
  assert.ok(Array.isArray(tools), 'Packaged tools/list response is missing.')
  assert.equal(tools[4]?.name, 'report_active_work', 'The consolidated lifecycle action must remain fifth in the final executable.')
  assert.equal(state.responses.has(null), false, 'JSON-RPC notifications must remain output-free.')
}

async function exerciseMeaningfulCallAndEof(state) {
  writeRpc(state, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'recommend_route',
      arguments: { capabilityIds: [protocolCanary], self: true },
    },
  })
  const response = await waitForResponse(state, 3, 20_000)
  assert.equal(response.error, undefined, 'The real packaged non-mutating route preflight must succeed.')
  assert.ok(['self-handled', 'decision-required'].includes(response.result?.structuredContent?.disposition), 'The explicit-self route preflight returned an unexpected disposition.')
  assert.equal(response.result?.structuredContent?.reasonCode, 'EXPLICIT_SELF_OVERRIDE')
  assert.equal(JSON.stringify(response).includes(protocolCanary), false, 'The packaged response must not echo protocol canaries.')
  state.child.stdin.end()
  const code = await waitForExit(state.child, 10_000)
  state.exitCode = code
  assert.equal(code, 0, 'Packaged MCP mode must exit successfully after stdin EOF.')
  if (state.protocolError) throw state.protocolError
  state.parser.finish()
  assert.deepEqual([...state.responses.keys()], [1, 2, 3])
  assert.equal(state.lines.every((line) => {
    try { return JSON.parse(line).jsonrpc === '2.0' } catch { return false }
  }), true, 'Packaged MCP stdout must contain only one-line JSON-RPC messages.')
  assert.equal(state.lines.join('\n').includes(protocolCanary), false)
}

async function verifySafeStartupFailure(env) {
  const child = spawnTracked(executable, ['--mcp-server'], env, ['ignore', 'pipe', 'pipe'])
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout = bounded(stdout, chunk) })
  child.stderr.on('data', (chunk) => { stderr = bounded(stderr, chunk) })
  const exitCode = await waitForExit(child, 10_000)
  assert.equal(exitCode, 1)
  assert.equal(stdout, '')
  assert.equal(stderr.trim(), 'MCP_LAUNCH_BINDING_REQUIRED')
  assert.equal(stderr.includes(protocolCanary), false)
  return { exitCode, stdoutBytes: 0, stderrCode: 'MCP_LAUNCH_BINDING_REQUIRED' }
}

function spawnTracked(command, args, env, stdio = ['ignore', 'pipe', 'pipe']) {
  const child = spawn(command, args, { env, stdio, windowsHide: true })
  activeChildren.add(child)
  child.once('close', () => activeChildren.delete(child))
  child.stdout?.on('data', () => undefined)
  child.stderr?.on('data', () => undefined)
  child.stdoutCapture = ''
  child.stderrCapture = ''
  if (child.stdout) child.stdout.on('data', (chunk) => { child.stdoutCapture = bounded(child.stdoutCapture, chunk) })
  if (child.stderr) child.stderr.on('data', (chunk) => { child.stderrCapture = bounded(child.stderrCapture, chunk) })
  return child
}

async function waitForGui(gui, options) {
  await delay(750)
  assert.equal(gui.exitCode, null, `GUI exited before acquiring its isolated singleton: ${gui.stderrCapture}`)
  if (!options.externalCompanion) {
    const identity = await waitForIdentity(options.expectedIdentity)
    assert.equal(identity.instanceId, options.expectedIdentity)
  } else {
    const identity = await readIdentity()
    assert.equal(identity?.instanceId, options.expectedIdentity)
  }
}

function runtimeEnvironment({ phase, localAppData }) {
  return createMcpPackageRuntimeEnvironment({
    parentEnvironment: process.env,
    temporaryRoot,
    phase,
    localAppData,
  })
}

async function readIdentity() {
  try {
    const response = await fetch('http://127.0.0.1:3210/api/v1/identity', {
      headers: {
        origin: 'http://127.0.0.1:3210',
        'x-findmnemo-protocol-version': '1.0.0',
      },
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) return undefined
    return (await response.json()).data
  } catch {
    return undefined
  }
}

async function waitForIdentity(expectedInstanceId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const identity = await readIdentity()
    if (identity?.instanceId === expectedInstanceId) return identity
    await delay(150)
  }
  throw new Error('MCP_PACKAGE_COMPANION_IDENTITY_TIMEOUT')
}

async function waitForIdentityUnavailable(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!await readIdentity()) return
    await delay(150)
  }
  throw new Error('MCP_PACKAGE_COMPANION_DID_NOT_STOP_WITH_OWNED_GUI')
}

async function terminateTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return
  const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 10_000,
  })
  if (result.status !== 0 && child.exitCode === null) child.kill()
  await waitForExit(child, 5_000).catch(() => undefined)
}

function writeRpc(state, message) {
  state.child.stdin.write(`${JSON.stringify(message)}\n`)
}

async function waitForResponse(state, id, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (state.protocolError) throw state.protocolError
    if (state.responses.has(id)) return state.responses.get(id)
    if (state.exitCode !== null) throw new Error(`MCP_PACKAGE_PROCESS_EXITED_${state.exitCode}:${state.stderr}`)
    await delay(25)
  }
  throw new Error(`MCP_PACKAGE_RESPONSE_TIMEOUT_${id}:${state.stderr}`)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP_PACKAGE_PROCESS_EXIT_TIMEOUT')), timeoutMs)
    child.once('close', (code) => {
      clearTimeout(timer)
      resolvePromise(code)
    })
  })
}

async function assertCanaryAbsent(root, canary) {
  if (!existsSync(root)) return
  const files = await listFiles(root, 64)
  for (const path of files) {
    const fileStat = await stat(path)
    if (!fileStat.isFile() || fileStat.size > 2 * 1024 * 1024) continue
    assert.equal((await readFile(path)).includes(Buffer.from(canary)), false, `MCP_PACKAGE_LOG_CANARY_PRESENT:${relative(root, path)}`)
  }
}

async function listFiles(root, limit) {
  const output = []
  const pending = [root]
  while (pending.length && output.length < limit) {
    const directory = pending.pop()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) output.push(path)
      if (output.length >= limit) break
    }
  }
  return output
}

async function optionalDigest(path) {
  try { return await fileDigest(path) } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined
    throw cause
  }
}

async function fileDigest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function requiredEnvironmentPath(name) {
  const value = process.env[name]
  if (!value) throw new Error(`MCP_PACKAGE_${name}_UNAVAILABLE`)
  return value
}

function bounded(current, chunk) {
  return `${current}${String(chunk)}`.slice(-64 * 1024)
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
