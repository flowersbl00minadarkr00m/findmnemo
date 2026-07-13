import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startCompanion } from '../dist-companion/server/companion.js'
import { COMPANION_PROTOCOL_VERSION } from '../dist-companion/shared/companion-contract.js'

const root = await mkdtemp(join(tmpdir(), 'findmnemo-source-verify-'))
const databasePath = join(root, 'findmnemo.db')
const gmailServices = {
  configured: false,
  credentialCapability: { state: 'unavailable', code: 'GMAIL_NOT_CONFIGURED', guidance: 'Verification fixture does not configure Gmail.' },
  scope: 'https://www.googleapis.com/auth/gmail.metadata',
  connect: async () => { throw new Error('GMAIL_NOT_CONFIGURED') },
  startConnect: async () => { throw new Error('GMAIL_NOT_CONFIGURED') },
  connected: async () => false,
  revoke: async () => undefined,
  accessToken: async () => { throw new Error('GMAIL_NOT_CONFIGURED') },
}
let running
try {
  running = await withTimeout(startCompanion({ port: 0, distPath: resolve('dist'), databasePath, gmailServices }), 5_000, 'SOURCE_VERIFY_START_TIMEOUT')
  await verify(running.port)
  await withTimeout(running.stop(), 5_000, 'SOURCE_VERIFY_STOP_TIMEOUT')
  running = undefined

  const database = new DatabaseSync(databasePath, { readOnly: true })
  const schema = database.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get()
  database.close()
  if (!schema) throw new Error('SOURCE_VERIFY_DATABASE_MISSING')

  running = await withTimeout(startCompanion({ port: 0, distPath: resolve('dist'), databasePath, gmailServices }), 5_000, 'SOURCE_VERIFY_RESTART_TIMEOUT')
  await verify(running.port)
  await withTimeout(running.stop(), 5_000, 'SOURCE_VERIFY_STOP_TIMEOUT')
  running = undefined
  await rm(root, { recursive: true, force: true })
  console.log('Source verification passed: loopback identity, UI, stable database restart, graceful stop, and cleanup.')
} catch (cause) {
  await (running ? withTimeout(running.stop(), 2_000, 'SOURCE_VERIFY_CLEANUP_TIMEOUT').catch(() => undefined) : undefined)
  await rm(root, { recursive: true, force: true })
  console.error(cause instanceof Error ? cause.message : 'SOURCE_VERIFY_FAILED')
  process.exitCode = 1
}

async function verify(port) {
  const identity = await fetch(`http://127.0.0.1:${port}/api/v1/identity`, { signal: AbortSignal.timeout(2_000), headers: { origin: `http://127.0.0.1:${port}`, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION } })
  const body = await identity.json()
  if (!identity.ok || body?.data?.protocolVersion !== COMPANION_PROTOCOL_VERSION) throw new Error('SOURCE_VERIFY_IDENTITY_FAILED')
  const ui = await fetch(`http://127.0.0.1:${port}/app`, { signal: AbortSignal.timeout(2_000) })
  if (!ui.ok || !(await ui.text()).includes('FindMnemo')) throw new Error('SOURCE_VERIFY_UI_FAILED')
}

function withTimeout(promise, milliseconds, code) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), milliseconds)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (cause) => { clearTimeout(timer); reject(cause) })
  })
}
