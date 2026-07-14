import { randomUUID } from 'node:crypto'
import type { UsageAttributionRecordDto, UsageCapabilityDto, UsageCoverageDto, UsageRefreshCommandDto, UsageRefreshRunDto } from '../../shared/companion-contract.js'
import { adaptClientsV4 } from './adapters/clients-v4.js'
import { adaptGraphV4 } from './adapters/graph-v4.js'
import { adaptModelsV4 } from './adapters/models-v4.js'
import type { TokscaleCommandOutcome, TokscaleRecipeInput } from './tokscale-command-runner.js'
import type { UsageRepository } from './usage-repository.js'
import { deduplicateCanonicalUsageRecords } from './usage-deduplication.js'

export interface UsageCommandExecutor {
  capability(signal: AbortSignal): Promise<UsageCapabilityDto>
  run(input: TokscaleRecipeInput, signal: AbortSignal): Promise<TokscaleCommandOutcome>
}

const RECIPE_IDS: UsageRefreshCommandDto['recipeId'][] = ['version', 'clients', 'canonical-graph', 'session-attribution', 'workspace-attribution']
const terminal = (state: UsageRefreshRunDto['state']) => ['complete', 'partial', 'failed', 'cancelled'].includes(state)

export class UsageRefreshService {
  private readonly runs = new Map<string, UsageRefreshRunDto>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly commandExecutor: UsageCommandExecutor
  private readonly repository: UsageRepository
  private readonly clock: () => Date

  constructor(commandExecutor: UsageCommandExecutor, repository: UsageRepository, clock: () => Date = () => new Date()) {
    this.commandExecutor = commandExecutor
    this.repository = repository
    this.clock = clock
  }

  async capability(signal: AbortSignal): Promise<UsageCapabilityDto> {
    const capability = await this.commandExecutor.capability(signal)
    return { ...capability, lastSuccessfulRefreshAt: this.repository.bounds().lastSuccessfulRefreshAt, sources: this.repository.latestCoverage()?.sources ?? [] }
  }

  start(input: { since: string; until: string }): UsageRefreshRunDto {
    validateDateRange(input)
    const active = [...this.runs.values()].find((run) => !terminal(run.state))
    if (active) return active
    const requestedAt = this.clock().toISOString()
    const run: UsageRefreshRunDto = {
      schema: 'findmnemo.usage-refresh.v1', id: randomUUID(), state: 'requested', stage: 'requested', requestedAt, finishedAt: null,
      coverageStart: input.since, coverageEnd: input.until, commands: RECIPE_IDS.map((recipeId) => ({ recipeId, state: 'pending', durationMs: null, outputBytes: null, recordCount: null, errorCode: null })),
      canonicalCount: 0, attributionCount: 0, warningCodes: [], errorCode: null, lastSuccessfulRefreshAt: this.repository.bounds().lastSuccessfulRefreshAt, retainedPreviousSuccess: false,
    }
    const controller = new AbortController()
    this.runs.set(run.id, run)
    this.controllers.set(run.id, controller)
    this.repository.recordStart(run)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12 * 60_000)])
    void this.execute(run.id, signal).catch(() => this.fail(run.id, 'USAGE_REFRESH_FAILED'))
    return run
  }

  get(runId: string): UsageRefreshRunDto | null {
    return this.runs.get(runId) ?? this.repository.getRefreshRun(runId)
  }

  cancel(runId: string): UsageRefreshRunDto | null {
    const run = this.runs.get(runId)
    if (!run) return this.repository.getRefreshRun(runId)
    if (!terminal(run.state)) this.controllers.get(runId)?.abort()
    return run
  }

  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    this.transition(runId, 'detecting', 'capability-check')
    const capability = await this.commandExecutor.capability(signal)
    this.setCommand(runId, 'version', capability.state === 'installed-supported' ? 'complete' : 'failed', null, capability.reasonCode)
    if (signal.aborted) return this.abort(runId, signal)
    if (capability.state !== 'installed-supported' || !capability.installedVersion || !capability.adapterId) return this.fail(runId, capability.reasonCode ?? 'TOKSCALE_UNAVAILABLE')
    const run = this.requireRun(runId)
    const context = { adapterId: capability.adapterId, tokscaleVersion: capability.installedVersion, refreshRunId: runId, refreshedAt: this.clock().toISOString(), opaqueIdentity: (raw: string) => this.repository.opaqueIdentity(raw) }
    this.transition(runId, 'collecting', 'source-coverage')
    const clients = await this.runRecipe(runId, { recipeId: 'clients' }, signal)
    if (signal.aborted) return this.abort(runId, signal)
    let coverage: UsageCoverageDto
    try {
      coverage = clients.ok ? adaptClientsV4(parseJson(clients.json), context) : unavailableCoverage(context, clients.code)
      this.setCommand(runId, 'clients', clients.ok ? 'complete' : 'failed', coverage.sources.length, clients.ok ? null : clients.code)
    } catch {
      coverage = unavailableCoverage(context, 'TOKSCALE_SCHEMA_CHANGED')
      this.setCommand(runId, 'clients', 'failed', null, 'TOKSCALE_SCHEMA_CHANGED')
    }

    this.transition(runId, 'collecting', 'canonical-usage')
    const graph = await this.runRecipe(runId, { recipeId: 'canonical-graph', since: run.coverageStart, until: run.coverageEnd }, signal)
    if (signal.aborted) return this.abort(runId, signal)
    if (!graph.ok) { this.setCommand(runId, 'canonical-graph', 'failed', null, graph.code); return this.fail(runId, graph.code) }
    let canonical
    try {
      canonical = adaptGraphV4(parseJson(graph.json), context)
      this.setCommand(runId, 'canonical-graph', 'complete', canonical.records.length, null)
    } catch {
      this.setCommand(runId, 'canonical-graph', 'failed', null, 'TOKSCALE_SCHEMA_CHANGED')
      return this.fail(runId, 'TOKSCALE_SCHEMA_CHANGED')
    }

    this.transition(runId, 'collecting', 'attribution')
    const attribution: UsageAttributionRecordDto[] = []
    for (const role of ['session-attribution', 'workspace-attribution'] as const) {
      const result = await this.runRecipe(runId, { recipeId: role, since: run.coverageStart, until: run.coverageEnd }, signal)
      if (signal.aborted) return this.abort(runId, signal)
      if (!result.ok) { this.setCommand(runId, role, 'failed', null, result.code); continue }
      try {
        const adapted = adaptModelsV4(parseJson(result.json), context, role)
        attribution.push(...adapted.records)
        this.setCommand(runId, role, 'complete', adapted.records.length, null)
        run.warningCodes.push(...adapted.warnings)
      } catch {
        this.setCommand(runId, role, 'failed', null, 'TOKSCALE_SCHEMA_CHANGED')
      }
    }

    this.transition(runId, 'normalizing', 'normalization')
    const deduplicated = deduplicateCanonicalUsageRecords(canonical.records)
    run.warningCodes.push(...canonical.warnings, ...coverage.warnings, ...deduplicated.warnings)
    const partial = !coverage.complete || run.commands.some((command) => command.state === 'failed' && command.recipeId !== 'version')
    this.transition(runId, 'committing', 'commit')
    this.repository.commitSnapshot({
      runId, requestedAt: run.requestedAt, finishedAt: this.clock().toISOString(), state: partial ? 'partial' : 'complete', coverageStart: run.coverageStart, coverageEnd: run.coverageEnd,
      tokscaleVersion: capability.installedVersion, adapterId: capability.adapterId, records: deduplicated.records, attribution, coverage: { ...coverage, complete: !partial, warnings: [...new Set(run.warningCodes)] },
      commands: run.commands.filter((command) => command.state !== 'pending').map((command) => ({ recipeId: command.recipeId, state: command.state === 'complete' ? 'complete' : command.state === 'skipped' ? 'skipped' : 'failed', durationMs: command.durationMs ?? 0, recordCount: command.recordCount, errorCode: command.errorCode })), conflictIds: deduplicated.conflictIds,
    })
    run.state = partial ? 'partial' : 'complete'; run.stage = 'finished'; run.finishedAt = this.clock().toISOString(); run.canonicalCount = deduplicated.records.length; run.attributionCount = attribution.length; run.lastSuccessfulRefreshAt = run.finishedAt
    this.controllers.delete(runId)
  }

  private async runRecipe(runId: string, input: TokscaleRecipeInput, signal: AbortSignal): Promise<TokscaleCommandOutcome> {
    const outcome = await this.commandExecutor.run(input, signal)
    const command = this.requireRun(runId).commands.find((candidate) => candidate.recipeId === input.recipeId)
    if (command) { command.durationMs = outcome.durationMs; command.outputBytes = outcome.ok ? outcome.outputBytes ?? Buffer.byteLength(outcome.json) : null }
    return outcome
  }

  private transition(runId: string, state: Extract<UsageRefreshRunDto['state'], 'detecting' | 'collecting' | 'normalizing' | 'committing'>, stage: UsageRefreshRunDto['stage']): void {
    const run = this.requireRun(runId); run.state = state; run.stage = stage; this.repository.updateRunStage(runId, state)
  }

  private setCommand(runId: string, recipeId: UsageRefreshCommandDto['recipeId'], state: UsageRefreshCommandDto['state'], recordCount: number | null, errorCode: string | null): void {
    const command = this.requireRun(runId).commands.find((candidate) => candidate.recipeId === recipeId)
    if (command) { command.state = state; command.recordCount = recordCount; command.errorCode = errorCode }
  }

  private fail(runId: string, errorCode: string, cancelled = false): void {
    const run = this.runs.get(runId)
    if (!run || terminal(run.state)) return
    run.state = cancelled ? 'cancelled' : 'failed'; run.stage = 'finished'; run.finishedAt = this.clock().toISOString(); run.errorCode = errorCode; run.retainedPreviousSuccess = run.lastSuccessfulRefreshAt !== null
    const commands = run.commands.filter((command) => command.state !== 'pending').map((command) => ({ recipeId: command.recipeId, state: command.state === 'complete' ? 'complete' as const : command.state === 'skipped' ? 'skipped' as const : 'failed' as const, durationMs: command.durationMs ?? 0, recordCount: command.recordCount, errorCode: command.errorCode }))
    this.repository.recordFailure({ runId, requestedAt: run.requestedAt, finishedAt: run.finishedAt, coverageStart: run.coverageStart, coverageEnd: run.coverageEnd, errorCode, state: cancelled ? 'cancelled' : 'failed', commands, warningCodes: run.warningCodes })
    this.controllers.delete(runId)
  }

  private abort(runId: string, signal: AbortSignal): void {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
    this.fail(runId, timedOut ? 'USAGE_REFRESH_TIMEOUT' : 'USAGE_REFRESH_CANCELLED', !timedOut)
  }

  private requireRun(runId: string): UsageRefreshRunDto {
    const run = this.runs.get(runId)
    if (!run) throw new Error('USAGE_REFRESH_NOT_FOUND')
    return run
  }
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { throw new Error('TOKSCALE_SCHEMA_CHANGED') }
}

function unavailableCoverage(context: { tokscaleVersion: string; adapterId: string; refreshedAt: string }, code: string): UsageCoverageDto {
  return { schema: 'findmnemo.usage-coverage.v1', tokscaleVersion: context.tokscaleVersion, adapterId: context.adapterId, refreshedAt: context.refreshedAt, sources: [], complete: false, warnings: [code] }
}

function validateDateRange(input: { since: string; until: string }): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.since) || !/^\d{4}-\d{2}-\d{2}$/.test(input.until) || input.since > input.until) throw new Error('USAGE_DATE_RANGE_INVALID')
}
