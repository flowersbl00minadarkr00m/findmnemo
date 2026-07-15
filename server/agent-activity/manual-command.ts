import type { AgentKind } from '../../shared/agent-activity-contract.js'
import { createPlatformSecretStore } from '../auth/platform-secret-store.js'
import { HttpManualActivityTransport } from '../mcp/activity-transport.js'
import { activityTokenReference } from './integration-auth-service.js'
import type { ManualReportAction } from './manual-reporting-service.js'

async function main(): Promise<void> {
  const args = argumentsFrom(process.argv.slice(2))
  const secret = await createPlatformSecretStore()
  if (!secret.store) throw new Error('CREDENTIAL_STORE_UNAVAILABLE')
  const integrationId = `manual:${args.agent}`
  const token = await secret.store.get(activityTokenReference(integrationId))
  if (!token) throw new Error('ACTIVITY_REPORTING_NOT_CONFIGURED')
  const transport = new HttpManualActivityTransport(token, { integrationId, agent: args.agent, store: secret.store })
  const result = await transport.report({
    integrationId, agent: args.agent, action: args.action, assignmentId: args.assignmentId, generation: args.generation,
    summary: args.summary, projectRef: args.projectId ? { kind: 'approved-project', id: args.projectId } : { kind: 'unassigned' }, evidenceKind: 'manual-command',
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function argumentsFrom(values: string[]): { agent: AgentKind; action: ManualReportAction; assignmentId: string; generation: number; summary: string; projectId?: string } {
  const args = Object.fromEntries(values.filter((value) => value.startsWith('--') && value.includes('=')).map((value) => { const index = value.indexOf('='); return [value.slice(2, index), value.slice(index + 1)] }))
  const agent = args.agent as AgentKind
  const action = args.action as ManualReportAction
  const allowedAgents = ['codex-cli', 'claude-code', 'pi']
  const allowedActions = ['start', 'update', 'wait', 'block', 'needs-action', 'complete', 'fail', 'cancel', 'snapshot']
  if (!allowedAgents.includes(agent) || !allowedActions.includes(action) || !args.assignment || !args.summary) throw new Error('Usage: npm run report:activity -- --agent=codex-cli --action=start --assignment=work-1 --summary="Safe summary" [--project=opaque-id] [--generation=1]')
  const generation = args.generation === undefined ? 1 : Number(args.generation)
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('generation must be a positive integer')
  return { agent, action, assignmentId: args.assignment, generation, summary: args.summary, ...(args.project ? { projectId: args.project } : {}) }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) void main().catch((cause) => { process.stderr.write(`${cause instanceof Error ? cause.message : 'Activity report failed'}\n`); process.exitCode = 1 })
