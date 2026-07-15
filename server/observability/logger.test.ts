import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDiagnosticExport } from '../diagnostics/export.js'
import { redactRoute, SafeLogger } from './logger.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('privacy-safe companion logging', () => {
  it('templates dynamic routes and drops non-allowlisted fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-log-'))
    cleanup.push(directory)
    const logger = new SafeLogger(join(directory, 'companion.log'))

    await logger.write({
      level: 'warn', code: 'HTTP_REQUEST', route: '/api/v1/email/candidates/private-thread-id/decision?token=private', status: 409,
      accountEmail: 'private@example.com', body: 'private body', localPath: 'C:\\private',
    } as never)
    const preview = await logger.preview()

    expect(preview).toEqual([expect.objectContaining({ route: '/api/v1/email/candidates/:threadId/decision', status: 409 })])
    expect(JSON.stringify(preview)).not.toMatch(/private-thread-id|private@example|private body|C:\\private|token=/)
    expect(redactRoute('/api/v1/tickets/private-ticket')).toBe('/api/v1/tickets/:ticketId')
    expect(redactRoute('/api/v1/agent-activity/assignments/private-assignment')).toBe('/api/v1/agent-activity/assignments/:assignmentKey')
    expect(redactRoute('/api/v1/agent-activity/integrations/private-integration/remove')).toBe('/api/v1/agent-activity/integrations/:integrationId/:action')
    expect(redactRoute('/api/v1/unknown/private')).toBe('/api/v1/:unrecognized')
  })

  it('rotates bounded files and exports only reviewable diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-diagnostic-'))
    cleanup.push(directory)
    const logPath = join(directory, 'companion.log')
    const databasePath = join(directory, 'findmnemo.db')
    const logger = new SafeLogger(logPath, { maxBytes: 256 })
    for (let index = 0; index < 8; index += 1) {
      await logger.write({ level: 'info', code: 'HTTP_REQUEST', route: `/api/v1/tickets/private-${index}`, status: 200, durationMs: index })
    }
    await writeFile(`${databasePath}.pre-migration.bak`, 'fixture')

    const exported = await createDiagnosticExport({ logger, databasePath, companionVersion: 'test-version' })

    expect(existsSync(`${logPath}.1`)).toBe(true)
    expect(exported).toMatchObject({ companionVersion: 'test-version', database: { backupAvailable: true }, privacy: { paths: 'redacted', bodies: 'not-collected', credentials: 'not-collected' } })
    expect(JSON.stringify(exported)).not.toContain(directory)
    expect(JSON.stringify(exported.logs)).not.toContain('private-')
  })

  it('serializes concurrent writes so rotation does not lose or reject events', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-concurrent-log-'))
    cleanup.push(directory)
    const logger = new SafeLogger(join(directory, 'companion.log'), { maxBytes: 16 * 1024 })

    await Promise.all(Array.from({ length: 40 }, (_, index) => logger.write({
      level: 'info', code: 'HTTP_REQUEST', route: '/api/v1/status', status: 200, durationMs: index,
    })))

    expect(await logger.preview(100)).toHaveLength(40)
  })

  it('keeps activity metrics allowlisted and drops summaries, identifiers, paths, tokens, and retry contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'findmnemo-activity-log-')); cleanup.push(directory)
    const logger = new SafeLogger(join(directory, 'companion.log'))
    await logger.write({
      level: 'info', code: 'ACTIVITY_INGRESS_ACCEPTED', sourceId: 'agent-activity', status: 200, durationMs: 7,
      agentKind: 'codex-cli', adapterVersion: '1.0.0', activityOutcome: 'applied', reasonCode: 'SEQUENCE_GAP',
      summary: ['AGENT', 'ACTIVITY', 'PROMPT', 'PRIVATE', 'CANARY'].join('_'), assignmentKey: 'private-assignment', retry: ['AGENT', 'ACTIVITY', 'RETRY', 'PRIVATE', 'CANARY'].join('_'), localPath: 'C:\\private', token: 'private',
    } as never)
    const preview = await logger.preview()
    expect(preview).toEqual([expect.objectContaining({ agentKind: 'codex-cli', adapterVersion: '1.0.0', activityOutcome: 'applied', reasonCode: 'SEQUENCE_GAP', durationMs: 7 })])
    expect(JSON.stringify(preview)).not.toMatch(/PRIVATE_CANARY|private-assignment|C:\\private|token/i)
  })
})
