import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const SCHEMA = 'findmnemo.desktop-package-receipt.v1'
const START_FILE = '.t4a-package-start.json'
const RECEIPT_FILE = '.t4a-package-receipt.json'
const CONSUMING_FILE = '.t4a-package-receipt.consuming.json'
const MAX_RECEIPT_AGE_MS = 15 * 60 * 1000
const EXECUTABLE_RELATIVE_PATH = 'FindMnemo Companion.exe'
const ASAR_RELATIVE_PATH = join('resources', 'app.asar')

export async function beginDesktopPackageRun({ releaseRoot = resolve('release-desktop') } = {}) {
  const root = resolve(releaseRoot)
  const packageRoot = safePackageRoot(root)
  await mkdir(root, { recursive: true })
  await Promise.all([
    rm(packageRoot, { recursive: true, force: true }),
    rm(join(root, RECEIPT_FILE), { force: true }),
    rm(join(root, CONSUMING_FILE), { force: true }),
    rm(join(root, START_FILE), { force: true }),
  ])
  const started = {
    schema: SCHEMA,
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
  }
  await writeJson(join(root, START_FILE), started)
  return started
}

export async function completeDesktopPackageRun({ releaseRoot = resolve('release-desktop') } = {}) {
  const root = resolve(releaseRoot)
  const packageRoot = safePackageRoot(root)
  const started = await readJson(join(root, START_FILE), 'DESKTOP_PACKAGE_START_MISSING')
  requireExactKeys(started, ['schema', 'runId', 'startedAt', 'startedAtMs'], 'DESKTOP_PACKAGE_START_INVALID')
  if (started.schema !== SCHEMA || typeof started.runId !== 'string' || !Number.isFinite(started.startedAtMs)) {
    throw new Error('DESKTOP_PACKAGE_START_INVALID')
  }
  const executablePath = join(packageRoot, EXECUTABLE_RELATIVE_PATH)
  const asarPath = join(packageRoot, ASAR_RELATIVE_PATH)
  const artifacts = {
    executable: await artifactEvidence(executablePath, EXECUTABLE_RELATIVE_PATH, started.startedAtMs),
    asar: await artifactEvidence(asarPath, ASAR_RELATIVE_PATH, started.startedAtMs),
  }
  const completed = {
    schema: SCHEMA,
    runId: started.runId,
    startedAt: started.startedAt,
    startedAtMs: started.startedAtMs,
    completedAt: new Date().toISOString(),
    completedAtMs: Date.now(),
    artifacts,
  }
  await writeJsonAtomic(root, RECEIPT_FILE, completed)
  await rm(join(root, START_FILE), { force: true })
  return completed
}

export async function consumeDesktopPackageReceipt({ releaseRoot = resolve('release-desktop') } = {}) {
  const root = resolve(releaseRoot)
  const packageRoot = safePackageRoot(root)
  const receiptPath = join(root, RECEIPT_FILE)
  const consumedReceiptPath = join(root, CONSUMING_FILE)
  try {
    await rename(receiptPath, consumedReceiptPath)
  } catch (cause) {
    if (cause?.code === 'ENOENT') throw new Error('DESKTOP_PACKAGE_RECEIPT_MISSING')
    throw cause
  }
  try {
    const receipt = await readJson(consumedReceiptPath, 'DESKTOP_PACKAGE_RECEIPT_INVALID')
    requireExactKeys(
      receipt,
      ['schema', 'runId', 'startedAt', 'startedAtMs', 'completedAt', 'completedAtMs', 'artifacts'],
      'DESKTOP_PACKAGE_RECEIPT_INVALID',
    )
    if (
      receipt.schema !== SCHEMA ||
      typeof receipt.runId !== 'string' ||
      !Number.isFinite(receipt.startedAtMs) ||
      !Number.isFinite(receipt.completedAtMs) ||
      receipt.completedAtMs < receipt.startedAtMs ||
      Date.now() - receipt.completedAtMs > MAX_RECEIPT_AGE_MS ||
      receipt.completedAtMs > Date.now() + 5_000
    ) throw new Error('DESKTOP_PACKAGE_RECEIPT_STALE')
    await verifyArtifact(receipt.artifacts?.executable, join(packageRoot, EXECUTABLE_RELATIVE_PATH), EXECUTABLE_RELATIVE_PATH)
    await verifyArtifact(receipt.artifacts?.asar, join(packageRoot, ASAR_RELATIVE_PATH), ASAR_RELATIVE_PATH)
    return {
      evidence: receipt,
      consumedReceiptPath,
    }
  } catch (cause) {
    await rm(consumedReceiptPath, { force: true })
    throw cause
  }
}

export async function finalizeConsumedDesktopPackageReceipt(consumed) {
  await rm(consumed.consumedReceiptPath, { force: true })
}

async function artifactEvidence(path, relativePath, startedAtMs) {
  const fileStat = await stat(path)
  if (!fileStat.isFile() || fileStat.size <= 1024 || fileStat.mtimeMs < startedAtMs - 2_000) {
    throw new Error('DESKTOP_PACKAGE_ARTIFACT_NOT_FRESH')
  }
  return {
    path: relativePath.replaceAll('\\', '/'),
    bytes: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    sha256: await fileDigest(path),
  }
}

async function verifyArtifact(evidence, path, relativePath) {
  requireExactKeys(evidence, ['path', 'bytes', 'mtimeMs', 'sha256'], 'DESKTOP_PACKAGE_RECEIPT_INVALID')
  const expectedPath = relativePath.replaceAll('\\', '/')
  if (evidence.path !== expectedPath || !Number.isFinite(evidence.bytes) || !Number.isFinite(evidence.mtimeMs)) {
    throw new Error('DESKTOP_PACKAGE_RECEIPT_INVALID')
  }
  const fileStat = await stat(path)
  if (
    !fileStat.isFile() ||
    fileStat.size !== evidence.bytes ||
    Math.abs(fileStat.mtimeMs - evidence.mtimeMs) > 1 ||
    await fileDigest(path) !== evidence.sha256
  ) throw new Error('DESKTOP_PACKAGE_RECEIPT_ARTIFACT_MISMATCH')
}

function safePackageRoot(releaseRoot) {
  const packageRoot = resolve(releaseRoot, 'win-unpacked')
  if (relative(releaseRoot, packageRoot).replaceAll('\\', '/') !== 'win-unpacked') {
    throw new Error('DESKTOP_PACKAGE_ROOT_INVALID')
  }
  return packageRoot
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

async function writeJsonAtomic(root, name, value) {
  const temporaryPath = join(root, `${name}.${randomUUID()}.tmp`)
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, join(root, name))
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(code)
  }
}

function requireExactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(code)
}

async function fileDigest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
