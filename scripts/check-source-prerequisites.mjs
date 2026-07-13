import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import { createSourceRunCapabilityReport } from '../server/platform/platform-capabilities.ts'
import { resolvePlatformPaths } from '../server/platform/platform-paths.ts'
import { COMPANION_PROTOCOL_VERSION } from '../shared/companion-contract.ts'
import { createServer } from 'node:net'

const credentialCapability = await checkCredentialStore()
let paths
let filesystem
try {
  paths = resolvePlatformPaths({ homeDir: homedir() })
  filesystem = { dataRootWritable: canWriteNearest(paths.dataRoot), code: canWriteNearest(paths.dataRoot) ? 'DATA_ROOT_WRITABLE' : 'DATA_ROOT_UNAVAILABLE' }
} catch (cause) {
  filesystem = { dataRootWritable: false, code: cause?.code ?? 'DATA_ROOT_UNAVAILABLE' }
}
const lockCode = dependencyLockCode()
const listener = await checkListener(3210)
const report = createSourceRunCapabilityReport({
  filesystem,
  listener,
  database: { state: paths && existsSync(paths.databasePath) ? 'present' : 'not-created', code: paths && existsSync(paths.databasePath) ? 'DATABASE_PRESENT' : 'DATABASE_NOT_CREATED' },
  gmailConfigured: Boolean(process.env.FINDMNEMO_GOOGLE_CLIENT_ID),
  credentialCapability,
  linuxEnvironment: linuxEnvironment(),
})
const output = { ...report, dependencyLock: { supported: lockCode === 'DEPENDENCY_LOCK_OK', code: lockCode } }
console.log(JSON.stringify(output, null, 2))
if (!report.node.supported || !filesystem.dataRootWritable || credentialCapability.state !== 'available' || lockCode !== 'DEPENDENCY_LOCK_OK' || report.supportLevel === 'unsupported' || listener.code === 'PORT_IN_USE' || listener.code === 'IDENTITY_MISMATCH') process.exitCode = 1

function canWriteNearest(path) {
  let candidate = path
  while (!existsSync(candidate) && dirname(candidate) !== candidate) candidate = dirname(candidate)
  try { accessSync(candidate, constants.W_OK); return true } catch { return false }
}

function dependencyLockCode() {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
    return packageJson.dependencies?.['@napi-rs/keyring'] === '1.3.0' && lock.packages?.['']?.dependencies?.['@napi-rs/keyring'] === '1.3.0'
      ? 'DEPENDENCY_LOCK_OK' : 'DEPENDENCY_LOCK_MISMATCH'
  } catch { return 'DEPENDENCY_LOCK_MISMATCH' }
}

async function checkCredentialStore() {
  if (process.platform === 'win32') return { backend: 'windows-dpapi', state: 'available', code: 'CREDENTIAL_STORE_AVAILABLE', guidance: 'The Windows credential store is available.' }
  if (process.platform !== 'darwin' && process.platform !== 'linux') return { state: 'unsupported', code: 'UNSUPPORTED_PLATFORM', guidance: 'Use a supported host.' }
  const backend = process.platform === 'darwin' ? 'macos-keychain' : 'linux-secret-service'
  const key = `findmnemo-probe-${crypto.randomUUID()}`
  let entry
  try {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    entry = new AsyncEntry('FindMnemo', key)
    const value = crypto.randomUUID()
    await entry.setPassword(value)
    if (await entry.getPassword() !== value) throw new Error('mismatch')
    await entry.deleteCredential()
    return { backend, state: 'available', code: 'CREDENTIAL_STORE_AVAILABLE', guidance: 'The operating-system credential store is available.' }
  } catch {
    try { await entry?.deleteCredential() } catch {}
    return { backend, state: 'unavailable', code: 'CREDENTIAL_STORE_UNAVAILABLE', guidance: 'Configure and unlock the operating-system credential store, then retry.' }
  }
}

function linuxEnvironment() {
  if (process.platform !== 'linux') return undefined
  if (process.env.WSL_DISTRO_NAME) return 'wsl'
  if (!process.env.XDG_CURRENT_DESKTOP && !process.env.DESKTOP_SESSION) return 'headless'
  try {
    const release = readFileSync('/etc/os-release', 'utf8')
    if (/^ID=ubuntu$/m.test(release) && /^VERSION_ID="?24\.04"?$/m.test(release)) return 'ubuntu-24.04-desktop'
  } catch {}
  return 'glibc'
}

async function checkListener(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/identity`, { signal: AbortSignal.timeout(800), headers: { origin: `http://127.0.0.1:${port}`, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION } })
    const body = await response.json()
    if (response.ok && body?.data?.protocolVersion === COMPANION_PROTOCOL_VERSION) return { port, state: 'compatible-running', code: 'IDENTITY_VERIFIED' }
    return { port, state: 'occupied-unknown', code: 'IDENTITY_MISMATCH' }
  } catch {
    return await new Promise((resolve) => {
      const server = createServer()
      server.once('error', () => resolve({ port, state: 'occupied-unknown', code: 'PORT_IN_USE' }))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve({ port, state: 'available', code: 'COMPANION_STOPPED' })))
    })
  }
}
