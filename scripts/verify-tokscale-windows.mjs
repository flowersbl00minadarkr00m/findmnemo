import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { startCompanion } from '../dist-companion/server/companion.js'
import { MemorySecretStore } from '../dist-companion/server/auth/secret-store.js'
import { NodeBoundedProcessRunner } from '../dist-companion/server/process/bounded-process-runner.js'
import { TokscaleCommandRunner } from '../dist-companion/server/usage/tokscale-command-runner.js'
import { COMPANION_PROTOCOL_VERSION } from '../dist-companion/shared/companion-contract.js'

if (process.platform !== 'win32') throw new Error('TOKSCALE_WINDOWS_ACCEPTANCE_REQUIRES_WINDOWS')

const root = await mkdtemp(join(tmpdir(), 'findmnemo-tokscale-acceptance-'))
const originalPath = process.env.PATH
const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
if (!systemRoot) throw new Error('TOKSCALE_ACCEPTANCE_SYSTEM_ROOT_MISSING')
process.env.PATH = join(systemRoot, 'System32')
const packagedResourcesPath = process.env.FINDMNEMO_ACCEPTANCE_RESOURCES_PATH
const beforeTemp = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('findmnemo-tokscale-')))
const databasePath = join(root, 'findmnemo.db')
const gmailServices = {
  configured: false,
  credentialCapability: { state: 'unavailable', code: 'GMAIL_NOT_CONFIGURED', guidance: 'Usage acceptance does not configure Gmail.' },
  scope: 'https://www.googleapis.com/auth/gmail.metadata',
  connect: async () => { throw new Error('GMAIL_NOT_CONFIGURED') },
  startConnect: async () => { throw new Error('GMAIL_NOT_CONFIGURED') },
  connected: async () => false,
  revoke: async () => undefined,
  accessToken: async () => { throw new Error('GMAIL_NOT_CONFIGURED') },
}

let running
try {
  const tokscaleCommandRunner = packagedResourcesPath
    ? new TokscaleCommandRunner(new NodeBoundedProcessRunner(), () => new Date(), homedir(), { resourcesPath: packagedResourcesPath, sourceRoots: [] })
    : undefined
  running = await startCompanion({
    port: 0,
    distPath: resolve('dist'),
    databasePath,
    gmailServices,
    routingSecretStore: new MemorySecretStore(),
    tokscaleCommandRunner,
  })
  const base = `http://127.0.0.1:${running.port}`
  const browserNonce = randomUUID()
  const app = await fetch(`${base}/app`, { signal: AbortSignal.timeout(5_000) })
  const html = await app.text()
  const bootstrapNonce = /name="findmnemo-local-bootstrap" content="([^"]+)"/.exec(html)?.[1]
  if (!app.ok || !bootstrapNonce) throw new Error('TOKSCALE_ACCEPTANCE_BOOTSTRAP_MISSING')
  const publicHeaders = { origin: base, 'content-type': 'application/json', 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION }
  const sessionEnvelope = await jsonRequest(`${base}/api/v1/local-session`, { method: 'POST', headers: publicHeaders, body: JSON.stringify({ bootstrapNonce, browserNonce }) })
  const session = sessionEnvelope.data
  if (!session?.token) throw new Error('TOKSCALE_ACCEPTANCE_SESSION_FAILED')
  const headers = { ...publicHeaders, authorization: `Bearer ${session.token}`, 'x-findmnemo-browser-nonce': browserNonce }

  const capability = (await jsonRequest(`${base}/api/v1/usage/capability`, { headers })).data
  if (capability.state !== 'installed-supported' || capability.collectorSource !== 'embedded') throw new Error(`TOKSCALE_ACCEPTANCE_${capability.reasonCode ?? capability.state}`)
  const policyBefore = (await jsonRequest(`${base}/api/v1/routing/policy`, { headers })).data
  const end = new Date().toISOString().slice(0, 10)
  const startDate = new Date(`${end}T00:00:00.000Z`)
  startDate.setUTCDate(startDate.getUTCDate() - 6)
  const start = startDate.toISOString().slice(0, 10)

  let cancelled = (await jsonRequest(`${base}/api/v1/usage/refreshes`, { method: 'POST', headers, body: JSON.stringify({ since: start, until: end }) })).data
  cancelled = (await jsonRequest(`${base}/api/v1/usage/refreshes/${encodeURIComponent(cancelled.id)}/cancel`, { method: 'POST', headers, body: '{}' })).data
  const cancelDeadline = Date.now() + 30_000
  while (!['complete', 'partial', 'failed', 'cancelled'].includes(cancelled.state)) {
    if (Date.now() > cancelDeadline) throw new Error('TOKSCALE_ACCEPTANCE_CANCEL_TIMEOUT')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
    cancelled = (await jsonRequest(`${base}/api/v1/usage/refreshes/${encodeURIComponent(cancelled.id)}`, { headers })).data
  }
  if (cancelled.state !== 'cancelled') throw new Error(`TOKSCALE_ACCEPTANCE_CANCEL_${cancelled.state}`)

  let run = (await jsonRequest(`${base}/api/v1/usage/refreshes`, { method: 'POST', headers, body: JSON.stringify({ since: start, until: end }) })).data
  const deadline = Date.now() + 12 * 60_000
  while (!['complete', 'partial', 'failed', 'cancelled'].includes(run.state)) {
    if (Date.now() > deadline) throw new Error('TOKSCALE_ACCEPTANCE_POLL_TIMEOUT')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    run = (await jsonRequest(`${base}/api/v1/usage/refreshes/${encodeURIComponent(run.id)}`, { headers })).data
  }
  if (!['complete', 'partial'].includes(run.state)) throw new Error(`TOKSCALE_ACCEPTANCE_REFRESH_${run.errorCode ?? run.state}`)

  const query = new URLSearchParams({ start, end })
  const summary = (await jsonRequest(`${base}/api/v1/usage/summary?${query}`, { headers })).data
  const records = (await jsonRequest(`${base}/api/v1/usage/records?${query}&limit=100`, { headers })).data
  const exportResponse = await fetch(`${base}/api/v1/usage/export?${query}&format=json&includeAttribution=true`, { headers, signal: AbortSignal.timeout(15_000) })
  const exported = await exportResponse.text()
  if (!exportResponse.ok) throw new Error('TOKSCALE_ACCEPTANCE_EXPORT_FAILED')
  assertPrivateBoundary(JSON.stringify(records))
  assertPrivateBoundary(exported)
  const policyAfter = (await jsonRequest(`${base}/api/v1/routing/policy`, { headers })).data
  if (JSON.stringify(policyBefore) !== JSON.stringify(policyAfter)) throw new Error('TOKSCALE_ACCEPTANCE_ROUTING_MUTATED')

  await running.stop()
  running = undefined
  const log = await readFile(join(root, 'companion.log'), 'utf8')
  assertPrivateBoundary(log)
  const afterTemp = (await readdir(tmpdir())).filter((name) => name.startsWith('findmnemo-tokscale-') && !beforeTemp.has(name) && name !== root.split(/[\\/]/).at(-1))
  if (afterTemp.length > 0) throw new Error('TOKSCALE_ACCEPTANCE_TEMP_LEAK')

  const evidence = {
    platform: 'Windows',
    collectorSource: capability.collectorSource,
    collectorMode: packagedResourcesPath ? 'packaged' : 'source-dependency',
    globalTokscalePathExcluded: true,
    tokscaleVersion: capability.installedVersion,
    adapterId: capability.adapterId,
    supportedRange: capability.supportedRange,
    refreshState: run.state,
    coverageComplete: summary.coverage.complete,
    canonicalRecordCount: run.canonicalCount,
    attributionRecordCount: run.attributionCount,
    returnedRecordCount: records.records.length,
    commands: run.commands.map(({ recipeId, state, durationMs, outputBytes, recordCount, errorCode }) => ({ recipeId, state, durationMs, outputBytes, recordCount, errorCode })),
    warningCodes: run.warningCodes,
    exportBytes: Buffer.byteLength(exported),
    routingPolicyUnchanged: true,
    privateBoundaryScan: 'passed',
    exclusiveTempCleanup: 'passed',
    cancellationTreeKill: cancelled.state,
  }
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  if (running) await running.stop().catch(() => undefined)
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  await rm(root, { recursive: true, force: true })
}

async function jsonRequest(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  const body = await response.json()
  if (!response.ok || body?.error) throw new Error(`TOKSCALE_ACCEPTANCE_HTTP_${response.status}_${body?.error?.code ?? 'UNKNOWN'}`)
  return body
}

function assertPrivateBoundary(value) {
  if (/[A-Za-z]:[\\/](?:Users|Documents|AppData)[\\/]/i.test(value)) throw new Error('TOKSCALE_ACCEPTANCE_PRIVATE_PATH')
  if (/\b[^\s"']+@[^\s"']+\.[A-Za-z]{2,}\b/.test(value)) throw new Error('TOKSCALE_ACCEPTANCE_ACCOUNT_IDENTIFIER')
  if (/"(?:prompt|response|transcript|credential|cookie|rawLog|stdout|stderr)"\s*:/i.test(value)) throw new Error('TOKSCALE_ACCEPTANCE_PROHIBITED_FIELD')
}
