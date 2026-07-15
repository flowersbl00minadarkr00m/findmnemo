import { spawn } from 'node:child_process'
import type { AgentActivityAgentAuthState } from '../../shared/companion-contract.js'
import type { AgentKind } from '../../shared/agent-activity-contract.js'
import { safeSpawnCommand } from '../routing/safe-command.js'

type StatusRunner = (command: string, args: readonly string[], signal: AbortSignal) => Promise<{ code: number | null; output: string }>

export interface AgentActivityRuntimeStatus {
  installedVersion: string | null
  agentAuthState: AgentActivityAgentAuthState
  checkedAt: string
}

export type AgentActivityRuntimeStatuses = Record<AgentKind, AgentActivityRuntimeStatus>

const COMMANDS: Record<AgentKind, readonly string[]> = {
  'codex-cli': ['codex.exe', 'codex.cmd'],
  'claude-code': ['claude.exe', 'claude.cmd'],
  pi: ['pi.cmd', 'pi.exe'],
}

export async function detectWindowsAgentActivityStatus(
  runner: StatusRunner = runCommand,
  clock: () => Date = () => new Date(),
): Promise<AgentActivityRuntimeStatuses> {
  const entries = await Promise.all((Object.keys(COMMANDS) as AgentKind[]).map(async (agent) => [agent, await detect(agent, runner, clock)] as const))
  return Object.fromEntries(entries) as AgentActivityRuntimeStatuses
}

export async function detectWindowsAgentActivityVersions(runner: StatusRunner = runCommand): Promise<Record<AgentKind, string | null>> {
  const statuses = await detectWindowsAgentActivityStatus(runner)
  return Object.fromEntries((Object.keys(statuses) as AgentKind[]).map((agent) => [agent, statuses[agent].installedVersion])) as Record<AgentKind, string | null>
}

async function detect(agent: AgentKind, runner: StatusRunner, clock: () => Date): Promise<AgentActivityRuntimeStatus> {
  for (const command of COMMANDS[agent]) {
    try {
      const result = await runner(command, ['--version'], AbortSignal.timeout(10_000))
      const version = result.output.match(/\d+\.\d+\.\d+/)?.[0] ?? null
      if (result.code !== 0 || !version) continue
      return {
        installedVersion: version,
        agentAuthState: await authentication(agent, command, runner),
        checkedAt: clock().toISOString(),
      }
    } catch { /* Try the next exact executable form. */ }
  }
  return { installedVersion: null, agentAuthState: 'not-applicable', checkedAt: clock().toISOString() }
}

async function authentication(agent: AgentKind, command: string, runner: StatusRunner): Promise<AgentActivityAgentAuthState> {
  if (agent === 'pi') return 'not-applicable'
  try {
    const args = agent === 'claude-code' ? ['auth', 'status', '--json'] : ['login', 'status']
    const result = await runner(command, args, AbortSignal.timeout(5_000))
    if (result.code !== 0) return 'signed-out'
    if (agent === 'codex-cli') return 'authenticated'
    const value = parseJsonLine(result.output)
    if (value?.loggedIn === true) return 'authenticated'
    if (value?.loggedIn === false) return 'signed-out'
    return 'unavailable'
  } catch { return 'unavailable' }
}

function parseJsonLine(output: string): Record<string, unknown> | undefined {
  const trimmed = output.trim()
  const candidates = [trimmed]
  const start = trimmed.indexOf('{'); const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch { /* Try bounded line candidates before returning unavailable. */ }
  }
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch { /* Account/status output is intentionally discarded. */ }
  }
  return undefined
}

function runCommand(command: string, args: readonly string[], signal: AbortSignal): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const safe = safeSpawnCommand(command, args)
    const child = spawn(safe.executable, safe.args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], signal })
    const chunks: Buffer[] = []
    let bytes = 0
    const collect = (chunk: Buffer) => { if (bytes >= 16_384) return; const kept = chunk.subarray(0, 16_384 - bytes); chunks.push(kept); bytes += kept.byteLength }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, output: Buffer.concat(chunks).toString('utf8') }))
  })
}
