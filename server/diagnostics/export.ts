import { existsSync } from 'node:fs'
import type { SafeLogger } from '../observability/logger.js'
import type { AgentActivityDiagnosticsService } from '../agent-activity/diagnostics-service.js'

export async function createDiagnosticExport(input: { logger: SafeLogger; databasePath: string; companionVersion: string; agentActivity?: AgentActivityDiagnosticsService }) {
  return {
    generatedAt: new Date().toISOString(), companionVersion: input.companionVersion,
    database: { backupAvailable: existsSync(`${input.databasePath}.pre-migration.bak`) },
    logs: await input.logger.preview(),
    ...(input.agentActivity ? { agentActivity: input.agentActivity.snapshot() } : {}),
    privacy: { paths: 'redacted', bodies: 'not-collected', credentials: 'not-collected' },
  }
}
