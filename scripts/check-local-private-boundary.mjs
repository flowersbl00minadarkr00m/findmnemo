#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RULES = [
  ['google-client-secret', /GOCSPX-[A-Za-z0-9_-]{8,}/g],
  ['google-access-token', /ya29\.[A-Za-z0-9_-]{8,}/g],
  ['private-key', new RegExp(`-----BEGIN ${'PRIVATE'} KEY-----`, 'g')],
  ['mime-body-marker', /MIME_FIXTURE_BODY/g],
  ['literal-bearer', /Bearer\s+[A-Za-z0-9_-]{24,}/g],
  ['legacy-private-account', new RegExp(`hflowers45@${'gmail\\.com'}`, 'gi')],
  ['refresh-token-json', /"refresh_token"\s*:\s*"[^"]+"/g],
  ['service-role-secret', /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']{8,}["']/g],
  ['raw-ledger-marker', new RegExp(`${'RAW'}_LEDGER_${'PRIVATE_MARKER'}`, 'g')],
  ['pairing-session-json', /"(?:sessionToken|pairingCode)"\s*:\s*"[A-Za-z0-9_-]{16,}"/g],
]

export function scanText(text) {
  return RULES.flatMap(([rule, pattern]) => [...text.matchAll(pattern)].map((match) => ({ rule, match: match[0].slice(0, 24) })))
}

async function filesUnder(root) {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(full))
    else if (/\.(?:js|cjs|mjs|ts|tsx|html|json|log|db)$/i.test(entry.name) && !/\.test\.[^.]+$/i.test(entry.name)) files.push(full)
  }
  return files
}

async function main() {
  const forbiddenFixtures = [
    `GOCSPX-${'x'.repeat(12)}`, `ya29.${'x'.repeat(12)}`, `-----BEGIN PRIVATE ${'KEY'}-----`,
    `MIME_${'FIXTURE_BODY'}`, `Bearer ${'x'.repeat(32)}`, `hflowers45@${'gmail.com'}`,
    `{"refresh_${'token'}":"private"}`, `SUPABASE_SERVICE_ROLE_KEY="${'x'.repeat(16)}"`,
    `${'RAW'}_LEDGER_${'PRIVATE_MARKER'}`, `{"sessionToken":"${'x'.repeat(24)}"}`,
  ]
  for (const fixture of forbiddenFixtures) if (scanText(fixture).length !== 1) throw new Error('Privacy scanner self-test failed to reject a forbidden fixture.')
  if (scanText('{"runId":"run-1","count":2,"sourceId":"gmail-followups","result":"partial"}').length) throw new Error('Privacy scanner rejected an approved minimized record.')

  const roots = ['src', 'server', 'shared', 'dist', 'dist-companion'].map((entry) => path.join(ROOT, entry))
  const defaultRuntimeRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'FindMnemo') : undefined
  const defaultDatabase = defaultRuntimeRoot ? path.join(defaultRuntimeRoot, 'findmnemo.db') : undefined
  const defaultLog = defaultRuntimeRoot ? path.join(defaultRuntimeRoot, 'companion.log') : undefined
  const runtime = [
    process.env.FINDMNEMO_DATABASE_PATH ?? defaultDatabase,
    process.env.FINDMNEMO_LOG_PATH ?? defaultLog,
    ...(defaultDatabase ? [`${defaultDatabase}-wal`, `${defaultDatabase}-shm`] : []),
    ...(defaultLog ? [`${defaultLog}.1`, `${defaultLog}.2`, `${defaultLog}.3`] : []),
  ].filter((file) => file && existsSync(file))
  const findings = []
  const findingKeys = new Set()
  for (const file of [...(await Promise.all(roots.map(filesUnder))).flat(), ...runtime]) {
    if (!file || file.endsWith('check-local-private-boundary.mjs')) continue
    const text = await readFile(file, 'utf8').catch(() => '')
    for (const finding of scanText(text)) {
      const relativeFile = path.relative(ROOT, file)
      const key = `${relativeFile}\0${finding.rule}`
      if (!findingKeys.has(key)) findings.push({ file: relativeFile, rule: finding.rule })
      findingKeys.add(key)
    }
  }
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`PRIVATE_BOUNDARY_FAIL ${finding.rule} ${finding.file}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`Local-private boundary checks passed (fixtures, source, builds, ${runtime.length} runtime database/log files).\n`)
}

await main()
