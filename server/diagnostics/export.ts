import { existsSync } from 'node:fs'
import type { SafeLogger } from '../observability/logger.js'

export async function createDiagnosticExport(input: { logger: SafeLogger; databasePath: string; companionVersion: string }) {
  return {
    generatedAt: new Date().toISOString(), companionVersion: input.companionVersion,
    database: { backupAvailable: existsSync(`${input.databasePath}.pre-migration.bak`) },
    logs: await input.logger.preview(),
    privacy: { paths: 'redacted', bodies: 'not-collected', credentials: 'not-collected' },
  }
}
