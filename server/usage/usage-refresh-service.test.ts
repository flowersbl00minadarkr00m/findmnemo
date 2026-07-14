import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageCapabilityDto, UsageRefreshRunDto } from '../../shared/companion-contract.js'
import { openFindMnemoDatabase } from '../db/database.js'
import type { TokscaleCommandOutcome, TokscaleRecipeInput } from './tokscale-command-runner.js'
import { UsageRefreshService, type UsageCommandExecutor } from './usage-refresh-service.js'
import { UsageRepository } from './usage-repository.js'

const cleanup: string[] = []
const fixtureRoot = join(process.cwd(), 'server', 'usage', 'fixtures', 'v4.5.2')

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

function supportedCapability(): UsageCapabilityDto {
  return {
    schema: 'findmnemo.usage-capability.v1', state: 'installed-supported', executableLabel: 'tokscale', collectorSource: 'embedded', installedVersion: '4.5.2', supportedRange: '>=4.4.1 <4.6.0', adapterId: 'tokscale-v4.4-v4.5', checkedAt: '2026-07-13T12:00:00.000Z', lastSuccessfulRefreshAt: null, sources: [], reasonCode: null,
    guidance: { summary: 'Installed.', installationUrl: 'https://github.com/junhoyeo/tokscale', automaticInstall: false },
  }
}

class FakeExecutor implements UsageCommandExecutor {
  failures = new Map<string, TokscaleCommandOutcome>()
  blocking = false

  async capability(): Promise<UsageCapabilityDto> { return supportedCapability() }
  async run(input: TokscaleRecipeInput, signal: AbortSignal): Promise<TokscaleCommandOutcome> {
    if (this.blocking) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      return { ok: false, recipeId: input.recipeId, code: 'TOKSCALE_TIMEOUT', durationMs: 1 }
    }
    const failure = this.failures.get(input.recipeId)
    if (failure) return failure
    const filename = input.recipeId === 'canonical-graph' ? 'graph.json' : input.recipeId === 'clients' ? 'clients.json' : input.recipeId === 'session-attribution' ? 'models-session.json' : 'models-workspace.json'
    return { ok: true, recipeId: input.recipeId, json: await readFile(join(fixtureRoot, filename), 'utf8'), durationMs: 2 }
  }
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'findmnemo-usage-refresh-'))
  cleanup.push(directory)
  const database = await openFindMnemoDatabase({ path: join(directory, 'findmnemo.db') })
  const repository = new UsageRepository(database.db)
  const executor = new FakeExecutor()
  const service = new UsageRefreshService(executor, repository, () => new Date('2026-07-13T12:00:00.000Z'))
  return { database, repository, executor, service }
}

async function terminalRun(service: UsageRefreshService, runId: string): Promise<UsageRefreshRunDto> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = service.get(runId)
    if (run && ['complete', 'partial', 'failed', 'cancelled'].includes(run.state)) return run
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('Refresh did not reach a terminal state.')
}

describe('manual usage refresh', () => {
  it('commits canonical evidence as partial when independent sidecars fail', async () => {
    const { database, repository, executor, service } = await harness()
    executor.failures.set('clients', { ok: false, recipeId: 'clients', code: 'TOKSCALE_PROCESS_FAILED', durationMs: 2 })
    executor.failures.set('session-attribution', { ok: false, recipeId: 'session-attribution', code: 'TOKSCALE_TIMEOUT', durationMs: 2 })
    const started = service.start({ since: '2026-07-01', until: '2026-07-13' })
    expect(service.start({ since: '2026-07-01', until: '2026-07-13' }).id).toBe(started.id)
    const final = await terminalRun(service, started.id)
    expect(final).toMatchObject({ state: 'partial', canonicalCount: 1, attributionCount: 1, errorCode: null })
    expect(final.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipeId: 'canonical-graph', state: 'complete', recordCount: 1 }),
      expect.objectContaining({ recipeId: 'clients', state: 'failed', errorCode: 'TOKSCALE_PROCESS_FAILED' }),
    ]))
    expect(repository.listCanonicalRecords()).toHaveLength(1)
    expect(repository.latestCoverage()).toMatchObject({ complete: false })
    database.close()
  })

  it('retains the prior success when canonical evidence fails schema validation', async () => {
    const { database, repository, executor, service } = await harness()
    const first = service.start({ since: '2026-07-01', until: '2026-07-13' })
    expect((await terminalRun(service, first.id)).state).toBe('partial')
    const priorIds = repository.listCanonicalRecords().map((record) => record.id)
    executor.failures.set('canonical-graph', { ok: true, recipeId: 'canonical-graph', json: '{"changed":true}', durationMs: 2 })
    const second = service.start({ since: '2026-07-01', until: '2026-07-13' })
    const failed = await terminalRun(service, second.id)
    expect(failed).toMatchObject({ state: 'failed', errorCode: 'TOKSCALE_SCHEMA_CHANGED', retainedPreviousSuccess: true })
    expect(repository.listCanonicalRecords().map((record) => record.id)).toEqual(priorIds)
    expect(repository.bounds().lastSuccessRunId).toBe(first.id)
    database.close()
  })

  it('cancels a running scan and persists a stable terminal state', async () => {
    const { database, executor, service } = await harness()
    executor.blocking = true
    const started = service.start({ since: '2026-07-01', until: '2026-07-13' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    service.cancel(started.id)
    const final = await terminalRun(service, started.id)
    expect(final).toMatchObject({ state: 'cancelled', errorCode: 'USAGE_REFRESH_CANCELLED' })
    expect(service.get(started.id)?.state).toBe('cancelled')
    database.close()
  })
})
