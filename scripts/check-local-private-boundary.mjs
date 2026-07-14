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
  ['routing-prompt-canary', /ROUTING_PROMPT_PRIVATE_CANARY/g],
  ['routing-result-canary', /ROUTING_RESULT_PRIVATE_CANARY/g],
  ['routing-credential-canary', /ROUTING_CREDENTIAL_PRIVATE_CANARY/g],
  ['usage-prompt-canary', /USAGE_PROMPT_PRIVATE_CANARY/g],
  ['usage-response-canary', /USAGE_RESPONSE_PRIVATE_CANARY/g],
  ['usage-account-canary', /USAGE_ACCOUNT_PRIVATE_CANARY/g],
  ['usage-raw-output-canary', /USAGE_RAW_OUTPUT_PRIVATE_CANARY/g],
  ['usage-private-path-canary', /USAGE_PRIVATE_PATH_CANARY/g],
  ['usage-session-canary', /USAGE_SESSION_PRIVATE_CANARY/g],
  ['usage-workspace-canary', /USAGE_WORKSPACE_PRIVATE_CANARY/g],
  ['usage-export-canary', /USAGE_EXPORT_PRIVATE_CANARY/g],
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
    'ROUTING_PROMPT_PRIVATE_CANARY', 'ROUTING_RESULT_PRIVATE_CANARY', 'ROUTING_CREDENTIAL_PRIVATE_CANARY',
    'USAGE_PROMPT_PRIVATE_CANARY', 'USAGE_RESPONSE_PRIVATE_CANARY', 'USAGE_ACCOUNT_PRIVATE_CANARY',
    'USAGE_RAW_OUTPUT_PRIVATE_CANARY', 'USAGE_PRIVATE_PATH_CANARY',
    'USAGE_SESSION_PRIVATE_CANARY', 'USAGE_WORKSPACE_PRIVATE_CANARY',
    'USAGE_EXPORT_PRIVATE_CANARY',
  ]
  for (const fixture of forbiddenFixtures) if (scanText(fixture).length !== 1) throw new Error('Privacy scanner self-test failed to reject a forbidden fixture.')
  if (scanText('{"runId":"run-1","count":2,"sourceId":"gmail-followups","result":"partial"}').length) throw new Error('Privacy scanner rejected an approved minimized record.')

  const usageCommandRunner = await readFile(path.join(ROOT, 'server', 'usage', 'tokscale-command-runner.ts'), 'utf8')
  const declaredRecipes = [...usageCommandRunner.matchAll(/^\s*'([^']+)',?$/gm)].map((match) => match[1])
  const allowedRecipes = ['version', 'clients', 'canonical-graph', 'session-attribution', 'workspace-attribution']
  if (!allowedRecipes.every((recipe) => declaredRecipes.includes(recipe))) throw new Error('Tokscale closed recipe manifest is incomplete.')
  if (/\b(?:login|submit|autosubmit|leaderboard|social|quota|account-switch|profile|sync)\b/i.test(usageCommandRunner)) throw new Error('Forbidden Tokscale command entered the production invocation path.')
  if (/shell\s*:\s*true/.test(usageCommandRunner)) throw new Error('Tokscale command execution must never use a shell.')
  if (!usageCommandRunner.includes('minimizedTokscaleEnvironment()')) throw new Error('Tokscale recipes must use the minimized child environment.')
  const usageRefreshService = await readFile(path.join(ROOT, 'server', 'usage', 'usage-refresh-service.ts'), 'utf8')
  if (/\b(?:setInterval|cron|scheduler|startupRefresh|backgroundRefresh)\b/.test(usageRefreshService)) throw new Error('Scheduled Tokscale refresh entered the manual-only MVP path.')
  const usageExport = await readFile(path.join(ROOT, 'server', 'usage', 'usage-export.ts'), 'utf8')
  if (!usageExport.includes('assertUsageBoundarySafe') || !usageExport.includes('csvCell')) throw new Error('Usage export must retain boundary validation and spreadsheet neutralization.')

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
