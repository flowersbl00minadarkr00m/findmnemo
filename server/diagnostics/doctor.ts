import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { COMPANION_PROTOCOL_VERSION } from '../../shared/companion-contract.js'
import { resolvePlatformPaths, type ResolvePlatformPathsInput } from '../platform/platform-paths.js'
import { createPlatformSecretStore, type CredentialCapability } from '../auth/platform-secret-store.js'

export interface DoctorCheck { id: string; state: 'pass' | 'attention' | 'fail'; code: string; guidance: string }

export async function runCompanionDoctor(options: { port?: number; localAppData?: string; platformPaths?: ResolvePlatformPathsInput; credentialCapability?: CredentialCapability } = {}): Promise<DoctorCheck[]> {
  const port = options.port ?? 3210
  const paths = options.localAppData
    ? resolvePlatformPaths({ platform: 'win32', env: { LOCALAPPDATA: options.localAppData } })
    : resolvePlatformPaths(options.platformPaths)
  const listener = await listenerCheck(port)
  const credentialCapability = options.credentialCapability ?? (await createPlatformSecretStore({ platform: paths.platform, env: options.platformPaths?.env ?? process.env, homeDir: options.platformPaths?.homeDir })).capability
  return [
    listener,
    databaseCheck(paths.databasePath),
    { id: 'gmail-client', state: process.env.FINDMNEMO_GOOGLE_CLIENT_ID ? 'pass' : 'attention', code: process.env.FINDMNEMO_GOOGLE_CLIENT_ID ? 'GMAIL_CLIENT_CONFIGURED' : 'GMAIL_NOT_CONFIGURED', guidance: process.env.FINDMNEMO_GOOGLE_CLIENT_ID ? 'Desktop OAuth client configuration is present.' : 'Set FINDMNEMO_GOOGLE_CLIENT_ID locally before connecting Gmail.' },
    credentialCheck(credentialCapability),
    { id: 'browser-envelope', state: 'pass', code: 'BROWSER_GUIDANCE_AVAILABLE', guidance: 'Supported hosted envelope: current Microsoft Edge and Google Chrome on Windows; use the local fallback when local-network access is unavailable.' },
  ]
}

function credentialCheck(capability: CredentialCapability): DoctorCheck {
  if (capability.state === 'available') return { id: 'gmail-credential', state: 'pass', code: capability.code, guidance: capability.guidance }
  return { id: 'gmail-credential', state: capability.state === 'unsupported' ? 'fail' : 'attention', code: capability.code, guidance: capability.guidance }
}

async function listenerCheck(port: number): Promise<DoctorCheck> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/identity`, { signal: AbortSignal.timeout(1_000), headers: { origin: `http://127.0.0.1:${port}`, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION } })
    const payload = await response.json() as { data?: { protocolVersion?: string } }
    if (response.ok && payload.data?.protocolVersion === COMPANION_PROTOCOL_VERSION) return { id: 'listener', state: 'pass', code: 'IDENTITY_VERIFIED', guidance: `FindMnemo companion identity is verified on loopback port ${port}.` }
    return { id: 'listener', state: 'fail', code: 'IDENTITY_MISMATCH', guidance: `Port ${port} answered without a compatible FindMnemo identity. Stop the conflicting process before retrying.` }
  } catch {
    return await canBind(port)
      ? { id: 'listener', state: 'attention', code: 'COMPANION_STOPPED', guidance: `Port ${port} is available. Start the companion, then rerun doctor.` }
      : { id: 'listener', state: 'fail', code: 'PORT_IN_USE', guidance: `Port ${port} is occupied but no compatible FindMnemo identity was verified.` }
  }
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

function databaseCheck(path: string): DoctorCheck {
  if (!existsSync(path)) return { id: 'database', state: 'attention', code: 'DATABASE_NOT_CREATED', guidance: 'The local database will be created on first companion start.' }
  try {
    const database = new DatabaseSync(path, { readOnly: true })
    const integrity = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
    database.close()
    return Object.values(integrity).includes('ok')
      ? { id: 'database', state: 'pass', code: 'DATABASE_INTEGRITY_OK', guidance: 'SQLite integrity check passed; pre-migration backup availability is reported in diagnostics.' }
      : { id: 'database', state: 'fail', code: 'DATABASE_INTEGRITY_FAILED', guidance: 'Stop the companion and restore from a verified pre-migration backup.' }
  } catch { return { id: 'database', state: 'fail', code: 'DATABASE_UNAVAILABLE', guidance: 'Stop the companion and inspect the database/backup with local diagnostics.' } }
}

async function cli(): Promise<void> {
  const checks = await runCompanionDoctor()
  for (const check of checks) console.log(`${check.state.toUpperCase()} ${check.id} ${check.code} - ${check.guidance}`)
  if (checks.some((check) => check.state === 'fail')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await cli()
