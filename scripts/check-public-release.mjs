import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const negativePrefix = 'scripts/fixtures/public-release/negative/'
const rules = [
  ['google-client-secret', /GOCSPX-[A-Za-z0-9_-]{8,}/g],
  ['google-access-token', /ya29\.[A-Za-z0-9_-]{8,}/g],
  ['provider-secret', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['private-key', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g],
  ['service-role-value', /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"'\s]{8,}["']/g],
  ['bearer-value', /Bearer\s+[A-Za-z0-9._-]{24,}/g],
  ['known-private-account', /hflowers45@gmail\.com/gi],
  ['username-path', /C:\\Users\\(?!fixture(?:\\|$)|user(?:\\|$))[^\\\r\n]+/gi],
  ['raw-content-marker', /RAW_(?:PRIVATE|LEDGER|GMAIL|PROMPT|RESPONSE|LOG)_/g],
]
const prohibitedExtensions = new Set(['.db', '.sqlite', '.sqlite3', '.dpapi', '.pem', '.key', '.p12', '.pfx', '.log'])

const positive = read('scripts/fixtures/public-release/sanitized.json')
if (scanText(positive).length) throw new Error('PUBLIC_RELEASE_BOUNDARY_FAILED: sanitized positive fixture was rejected.')
for (const fixture of ['credential.txt', 'runtime.db', 'raw.log']) {
  const path = `${negativePrefix}${fixture}`
  if (scanFile(path).length === 0) throw new Error(`PUBLIC_RELEASE_BOUNDARY_FAILED: negative fixture ${fixture} was not rejected.`)
}

const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const findings = []
for (const path of listed) {
  if (path.startsWith(negativePrefix) || !existsSync(resolve(root, path))) continue
  findings.push(...scanFile(path))
}
if (findings.length) {
  for (const finding of findings) console.error(`PUBLIC_RELEASE_BOUNDARY_FAILED ${finding.rule} ${finding.path}`)
  process.exitCode = 1
} else {
  console.log(`Public release boundary passed (${listed.length} tracked/untracked candidate paths; negative fixtures rejected).`)
}

function scanFile(path) {
  const full = resolve(root, path)
  const findings = []
  if (prohibitedExtensions.has(extname(path).toLowerCase())) findings.push({ path, rule: 'prohibited-runtime-artifact' })
  if (statSync(full).size > 15 * 1024 * 1024 && !/\.(?:png|jpg|jpeg|webp)$/i.test(path)) findings.push({ path, rule: 'unexpected-large-artifact' })
  const text = readFileSync(full, 'utf8')
  for (const rule of scanText(text)) findings.push({ path, rule })
  return findings
}

function scanText(text) {
  return rules.flatMap(([name, pattern]) => { pattern.lastIndex = 0; return pattern.test(text) ? [name] : [] })
}

function read(path) { return readFileSync(resolve(root, path), 'utf8') }
