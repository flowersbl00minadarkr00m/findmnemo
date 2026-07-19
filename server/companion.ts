import { createServer, type Server } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequestHandler } from './api/routes.js'
import { createCompanionIdentity } from './diagnostics/identity.js'
import { COMPANION_PROTOCOL_VERSION, type CompanionErrorCode, type SourceRunCapabilityReport } from '../shared/companion-contract.js'
import { PairingService, type PairingCodeSnapshot } from './auth/pairing-service.js'
import type { RequestSecurityOptions } from './api/request-security.js'
import { openFindMnemoDatabase } from './db/database.js'
import { OperationalRepository } from './db/operational-repository.js'
import { createGmailServices, type GmailServices } from './gmail/gmail-services.js'
import { GmailMetadataClient } from './gmail/gmail-client.js'
import { GmailCheckService } from './gmail/gmail-source.js'
import { ReconciliationEngine } from './reconciliation/engine.js'
import { FindMnemoTicketsAdapter } from './reconciliation/adapters/findmnemo-tickets.js'
import { GmailFollowupsAdapter } from './reconciliation/adapters/gmail-followups.js'
import { ProjectFoldersAdapter } from './reconciliation/adapters/project-folders.js'
import { ProjectFolderDetector } from './onboarding/project-folder-detector.js'
import { ProjectFolderRepository } from './onboarding/project-folder-repository.js'
import { ProjectFolderService } from './onboarding/project-folder-service.js'
import { OnboardingService } from './onboarding/onboarding-service.js'
import { AgentLedgerAdapter } from './reconciliation/adapters/agent-ledger.js'
import { SafeLogger } from './observability/logger.js'
import { resolvePlatformPaths } from './platform/platform-paths.js'
import { createSourceRunCapabilityReport } from './platform/platform-capabilities.js'
import { RoutingRepository } from './routing/routing-repository.js'
import { RoutingConnectionRepository } from './routing/connection-repository.js'
import { RoutingConnectionService } from './routing/connection-service.js'
import { NodeRoutingProcessRunner } from './routing/process-runner.js'
import { PiRoutingAdapter } from './routing/adapters/pi-rpc-adapter.js'
import { CodexCliAdapter } from './routing/adapters/codex-cli-adapter.js'
import { ClaudeCodeCliAdapter } from './routing/adapters/claude-code-cli-adapter.js'
import { OllamaLocalAdapter } from './routing/adapters/ollama-local-adapter.js'
import { OpenRouterAdapter } from './routing/adapters/openrouter-adapter.js'
import { OpenRouterOAuthService } from './routing/openrouter-oauth-service.js'
import { createDetectionOnlyAdapters } from './routing/adapters/detection-candidates.js'
import { DiscoveryService } from './routing/discovery-service.js'
import { DispatchService } from './routing/dispatch-service.js'
import { RoutingIntegrationAuthService } from './routing/integration-auth.js'
import { RoutingIntegrationApi } from './routing/integration-api.js'
import { ProjectContextResolver } from './routing/project-context-resolver.js'
import { createPlatformSecretStore } from './auth/platform-secret-store.js'
import type { SecretStore } from './auth/secret-store.js'
import { TokscaleCommandRunner } from './usage/tokscale-command-runner.js'
import { UsageRepository } from './usage/usage-repository.js'
import { UsageRefreshService, type UsageCommandExecutor } from './usage/usage-refresh-service.js'
import { DataPortabilityService } from './portability/data-portability-service.js'
import { TicketLifecycleService } from './tickets/ticket-lifecycle-service.js'
import { CompletedWorkQueryService } from './tickets/completed-work-query-service.js'
import { CompletedWorkExporter } from './tickets/completed-work-exporter.js'
import { AgentActivityRepository } from './agent-activity/agent-activity-repository.js'
import { AgentActivityService } from './agent-activity/agent-activity-service.js'
import { ActivityCapabilityRegistry, manualActivityRegistration } from './agent-activity/capability-manifests.js'
import { IntegrationAuthService } from './agent-activity/integration-auth-service.js'
import { ProjectAssociationService } from './agent-activity/project-association-service.js'
import { ActivityIngress } from './agent-activity/activity-ingress.js'
import { ManualReportingService } from './agent-activity/manual-reporting-service.js'
import { SnapshotService } from './agent-activity/snapshot-service.js'
import { AgentActivityManagementService, type AgentActivitySetupPort } from './agent-activity/management-service.js'
import { AgentActivityCoverageService } from './agent-activity/coverage-service.js'
import { AgentActivityRetentionService } from './agent-activity/retention-service.js'
import { AgentActivityRolloutService } from './agent-activity/rollout-service.js'
import { AgentActivityDiagnosticsService } from './agent-activity/diagnostics-service.js'
import { detectWindowsAgentActivityStatus } from './agent-activity/windows-agent-detector.js'

export const COMPANION_HOST = '127.0.0.1' as const
export const COMPANION_PORT = 3210
export const COMPANION_VERSION = '0.1.0'
const COMPANION_SHUTDOWN_DRAIN_MS = 1_000

export class CompanionStartError extends Error {
  readonly code: CompanionErrorCode

  constructor(code: CompanionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CompanionStartError'
    this.code = code
  }
}

export interface CompanionDependencies {
  host?: typeof COMPANION_HOST
  port?: number
  distPath?: string
  clock?: () => Date
  companionVersion?: string
  instanceId?: string
  security?: RequestSecurityOptions
  databasePath?: string
  gmailServices?: GmailServices
  capabilityReport?: SourceRunCapabilityReport
  discoveryService?: DiscoveryService
  piRoutingAdapter?: PiRoutingAdapter
  dispatchService?: DispatchService
  routingSecretStore?: SecretStore
  activitySecretStore?: SecretStore
  activitySetup?: AgentActivitySetupPort
  tokscaleCommandRunner?: TokscaleCommandRunner
  usageRefreshService?: UsageRefreshService
  usageCommandExecutor?: UsageCommandExecutor
}

export interface RunningCompanion {
  host: typeof COMPANION_HOST
  port: number
  server: Server
  stop: () => Promise<void>
  pairingCode: string
  localBootstrapNonce: string
  pairingSnapshot: () => PairingCodeSnapshot | undefined
  refreshPairingCode: () => PairingCodeSnapshot
  projectFolderService: ProjectFolderService
  databasePath: string
  activity?: {
    auth: IntegrationAuthService
    repository: AgentActivityRepository
    capabilities: ActivityCapabilityRegistry
    manual: ManualReportingService
    snapshots: SnapshotService
    management: AgentActivityManagementService
    rollout: AgentActivityRolloutService
  }
}

export async function startCompanion({
  host = COMPANION_HOST,
  port = COMPANION_PORT,
  distPath = resolve('dist'),
  clock = () => new Date(),
  companionVersion = COMPANION_VERSION,
  instanceId,
  security,
  databasePath,
  gmailServices,
  capabilityReport,
  discoveryService,
  piRoutingAdapter,
  dispatchService,
  routingSecretStore,
  activitySecretStore,
  activitySetup,
  tokscaleCommandRunner,
  usageRefreshService,
  usageCommandExecutor,
}: CompanionDependencies = {}): Promise<RunningCompanion> {
  if (host !== COMPANION_HOST) {
    throw new CompanionStartError('IDENTITY_MISMATCH', 'Companion host must be literal 127.0.0.1.')
  }
  if (port !== 0) await assertListenerAvailable(port)

  const identity = createCompanionIdentity({ companionVersion, instanceId })
  const pairingService = new PairingService(clock)
  const pairingCode = pairingService.issueCode()
  const localBootstrapNonce = pairingService.issueLocalBootstrap()
  const defaultPaths = databasePath ? undefined : resolvePlatformPaths()
  const database = await openFindMnemoDatabase({ path: databasePath ?? defaultPaths?.databasePath })
  const operationalRepository = new OperationalRepository(database.db)
  const ticketLifecycleService = new TicketLifecycleService(operationalRepository, clock)
  const completedWorkQueryService = new CompletedWorkQueryService(operationalRepository, clock)
  const completedWorkExporter = new CompletedWorkExporter(completedWorkQueryService)
  const projectFolderRepository = new ProjectFolderRepository(database.db)
  const projectFolderDetector = new ProjectFolderDetector(clock)
  const projectFolderService = new ProjectFolderService(projectFolderRepository, projectFolderDetector, operationalRepository, clock)
  const legacyProjectSource = operationalRepository.getConfiguredSource('project-sdd')
  const migratedProjectFolders = await projectFolderRepository.migrateLegacy(legacyProjectSource?.config.projects, (path) => projectFolderDetector.inspect(path))
  if (migratedProjectFolders.length) {
    operationalRepository.saveConfiguredSource({ id: 'project-folders', label: 'Project folders', adapterVersion: '1.0.0', enabled: true, policy: legacyProjectSource?.descriptor.policy ?? 'auto-create', locationLabel: `${migratedProjectFolders.length} project folder${migratedProjectFolders.length === 1 ? '' : 's'}` }, { migratedFrom: 'project-sdd' })
    if (legacyProjectSource?.descriptor.enabled) operationalRepository.saveConfiguredSource({ ...legacyProjectSource.descriptor, enabled: false }, legacyProjectSource.config)
  }
  const routingRepository = new RoutingRepository(database.db)
  const processRunner = new NodeRoutingProcessRunner()
  const resolvedTokscaleCommandRunner = tokscaleCommandRunner ?? new TokscaleCommandRunner()
  const usageRepository = new UsageRepository(database.db)
  const resolvedUsageRefreshService = usageRefreshService ?? new UsageRefreshService(usageCommandExecutor ?? resolvedTokscaleCommandRunner, usageRepository, clock)
  const dataPortabilityService = new DataPortabilityService(operationalRepository, routingRepository, usageRepository, companionVersion, clock)
  const resolvedPiRoutingAdapter = piRoutingAdapter ?? new PiRoutingAdapter(processRunner, undefined, clock)
  const codexCliAdapter = new CodexCliAdapter(processRunner, clock)
  const claudeCodeCliAdapter = new ClaudeCodeCliAdapter(processRunner, clock)
  const ollamaLocalAdapter = new OllamaLocalAdapter(fetch, clock)
  const fallbackSecretStore = routingSecretStore ?? activitySecretStore ?? (await createPlatformSecretStore()).store
  const resolvedRoutingSecretStore = routingSecretStore ?? fallbackSecretStore
  const resolvedActivitySecretStore = activitySecretStore ?? fallbackSecretStore
  const openRouterAdapter = resolvedRoutingSecretStore ? new OpenRouterAdapter(resolvedRoutingSecretStore, fetch, clock) : undefined
  const openRouterOAuthService = resolvedRoutingSecretStore ? new OpenRouterOAuthService(resolvedRoutingSecretStore, fetch, clock) : undefined
  const routingAdapters = [resolvedPiRoutingAdapter, codexCliAdapter, claudeCodeCliAdapter, ollamaLocalAdapter, ...(openRouterAdapter ? [openRouterAdapter] : []), ...createDetectionOnlyAdapters(processRunner, clock)]
  const routingConnectionRepository = new RoutingConnectionRepository(database.db)
  const projectContextResolver = new ProjectContextResolver(projectFolderRepository, join(defaultPaths?.dataRoot ?? dirname(database.path), 'routing-scratch'))
  const resolvedDispatchService = dispatchService ?? new DispatchService(routingRepository, routingAdapters, clock, { connections: routingConnectionRepository, projectContexts: projectContextResolver })
  const routingIntegrationAuth = resolvedRoutingSecretStore ? new RoutingIntegrationAuthService(resolvedRoutingSecretStore) : undefined
  if (routingIntegrationAuth) await routingIntegrationAuth.ensure()
  const routingIntegrationApi = routingIntegrationAuth ? new RoutingIntegrationApi(routingIntegrationAuth, resolvedDispatchService, routingRepository) : undefined
  const resolvedDiscoveryService = discoveryService ?? new DiscoveryService([
    resolvedPiRoutingAdapter,
    codexCliAdapter,
    claudeCodeCliAdapter,
    ollamaLocalAdapter,
    ...(openRouterAdapter ? [openRouterAdapter] : []),
    ...createDetectionOnlyAdapters(processRunner, clock),
  ], clock)
  const routingConnectionService = new RoutingConnectionService(routingAdapters, routingConnectionRepository, routingRepository, clock)
  const logger = new SafeLogger(join(defaultPaths?.logsRoot ?? dirname(database.path), 'companion.log'))
  await logger.write({ level: 'info', code: 'COMPANION_START', status: 200 })
  let activity: RunningCompanion['activity']
  let activityIngress: ActivityIngress | undefined
  let activityManagement: AgentActivityManagementService | undefined
  let activityDiagnostics: AgentActivityDiagnosticsService | undefined
  if (resolvedActivitySecretStore) {
    const auth = new IntegrationAuthService(database.db, resolvedActivitySecretStore)
    const rollout = new AgentActivityRolloutService({ database, auth, store: resolvedActivitySecretStore, setup: activitySetup, clock })
    const capabilities = new ActivityCapabilityRegistry(database.db)
    const repository = new AgentActivityRepository(database.db, operationalRepository, ticketLifecycleService, await auth.identityKey(), clock)
    const associations = new ProjectAssociationService(database.db, projectFolderRepository, operationalRepository, clock)
    const activities = new AgentActivityService(repository, clock, associations)
    const snapshots = new SnapshotService(database.db, clock)
    const manual = new ManualReportingService({ repository, activities, capabilities, snapshots, clock })
    const retention = new AgentActivityRetentionService(database, { clock })
    activityDiagnostics = new AgentActivityDiagnosticsService(database.db, clock)
    try {
      const result = retention.prune()
      await logger.write({ level: 'info', code: 'ACTIVITY_RETENTION_COMPLETE', sourceId: 'agent-activity', count: result.retainedTotal })
    } catch { await logger.write({ level: 'error', code: 'ACTIVITY_RETENTION_FAILED', sourceId: 'agent-activity' }) }
    for (const agent of ['codex-cli', 'claude-code', 'pi'] as const) {
      const integrationId = `manual:${agent}`
      if (!repository.hasIntegration(integrationId)) repository.registerIntegration(manualActivityRegistration(integrationId, agent))
      try { await auth.ensure(integrationId) }
      catch (cause) { if (!(cause instanceof Error) || cause.message !== 'ACTIVITY_INTEGRATION_NOT_ENABLED') throw cause }
    }
    activityIngress = new ActivityIngress({ auth, capabilities, activities, associations, repository, snapshots, logger, retention, featureEnabled: () => rollout.isEnabled(), clock })
    activityManagement = new AgentActivityManagementService({
      db: database.db, auth, capabilities, snapshots, store: resolvedActivitySecretStore, setup: activitySetup, clock,
      coverage: new AgentActivityCoverageService(repository, clock),
      rollout,
      detectStatus: process.platform === 'win32' ? detectWindowsAgentActivityStatus : async () => ({
        'codex-cli': { installedVersion: null, agentAuthState: 'not-applicable', checkedAt: clock().toISOString() },
        'claude-code': { installedVersion: null, agentAuthState: 'not-applicable', checkedAt: clock().toISOString() },
        pi: { installedVersion: null, agentAuthState: 'not-applicable', checkedAt: clock().toISOString() },
      }),
    })
    activityManagement.initialize({ 'codex-cli': null, 'claude-code': null, pi: null })
    activity = { auth, repository, capabilities, manual, snapshots, management: activityManagement, rollout }
  }
  const resolvedGmailServices = gmailServices ?? await createGmailServices()
  const resolvedCapabilityReport = capabilityReport ?? createSourceRunCapabilityReport({
    filesystem: { dataRootWritable: true, code: 'DATA_ROOT_WRITABLE' },
    listener: { port, state: 'available', code: 'IDENTITY_VERIFIED' },
    database: { state: 'ready', code: 'DATABASE_INTEGRITY_OK' },
    gmailConfigured: resolvedGmailServices.configured,
    credentialCapability: resolvedGmailServices.credentialCapability,
  })
  const gmailCheckService = new GmailCheckService(
    new GmailMetadataClient(() => resolvedGmailServices.accessToken()),
    operationalRepository,
    clock,
  )
  const reconciliationEngine = new ReconciliationEngine(operationalRepository, [
    new FindMnemoTicketsAdapter(operationalRepository),
    new GmailFollowupsAdapter(operationalRepository),
    new ProjectFoldersAdapter(projectFolderRepository, projectFolderDetector),
    new AgentLedgerAdapter(operationalRepository),
  ], clock, ticketLifecycleService)
  const onboardingService = new OnboardingService(reconciliationEngine, projectFolderService, resolvedGmailServices, activityManagement)
  const server = createServer((request, response) => {
    void createRequestHandler({
      distPath,
      identity,
      clock,
      pairingService,
      security,
      localBootstrapNonce,
      databasePath: database.path,
      operationalRepository,
      routingRepository,
      discoveryService: resolvedDiscoveryService,
      routingConnectionService,
      openRouterOAuthService,
      piRoutingAdapter: resolvedPiRoutingAdapter,
      dispatchService: resolvedDispatchService,
      routingIntegrationApi,
      tokscaleCommandRunner: resolvedTokscaleCommandRunner,
      usageRefreshService: resolvedUsageRefreshService,
      usageRepository,
      dataPortabilityService,
      gmailServices: resolvedGmailServices,
      gmailCheckService,
      reconciliationEngine,
      onboardingService,
      ticketLifecycleService,
      completedWorkQueryService,
      completedWorkExporter,
      projectFolderService,
      logger,
      capabilityReport: resolvedCapabilityReport,
      activityIngress,
      activityManagement,
      activityDiagnostics,
    })(request, response).catch((cause: unknown) => {
      response.destroy(cause instanceof Error ? cause : new Error('Unhandled companion request error.'))
    })
  })

  try {
    await listen(server, host, port)
  } catch (cause) {
    database.close()
    throw cause
  }
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    database.close()
    throw new CompanionStartError('INTERNAL_ERROR', 'Companion did not expose a TCP listener address.')
  }

  let stopPromise: Promise<void> | undefined
  const stop = () => {
    stopPromise ??= new Promise((resolveStop, rejectStop) => {
      const forceCloseTimer = setTimeout(() => {
        server.closeAllConnections()
      }, COMPANION_SHUTDOWN_DRAIN_MS)
      forceCloseTimer.unref()
      server.close((error) => {
        clearTimeout(forceCloseTimer)
        void logger.drain().then(() => {
          database.close()
          if (error) rejectStop(error)
          else resolveStop()
        }, (logError) => {
          database.close()
          rejectStop(logError)
        })
      })
      // Node may retain fetch keep-alive sockets long enough to block a Windows
      // restart and keep SQLite's WAL file locked. Once close() stops accepting
      // new work, explicitly release idle sockets while active requests drain.
      // Force-close any client that never finishes within the bounded grace
      // period so shutdown can release SQLite's WAL/SHM handles deterministically.
      server.closeIdleConnections()
    })
    return stopPromise
  }

  return {
    host,
    port: address.port,
    server,
    pairingCode,
    localBootstrapNonce,
    pairingSnapshot: () => pairingService.pairingSnapshot(),
    refreshPairingCode: () => pairingService.refreshPairingCode(),
    projectFolderService,
    databasePath: database.path,
    activity,
    stop,
  }
}

async function assertListenerAvailable(port: number): Promise<void> {
  try {
    const response = await fetch(`http://${COMPANION_HOST}:${port}/api/v1/identity`, {
      signal: AbortSignal.timeout(700),
      headers: { origin: `http://${COMPANION_HOST}:${port}`, 'x-findmnemo-protocol-version': COMPANION_PROTOCOL_VERSION },
    })
    const body = await response.json() as { data?: { protocolVersion?: string } }
    if (response.ok && body.data?.protocolVersion === COMPANION_PROTOCOL_VERSION) {
      throw new CompanionStartError('COMPANION_ALREADY_RUNNING', `A compatible FindMnemo companion already owns port ${port}.`)
    }
    throw new CompanionStartError('PORT_IN_USE', `Port ${port} is owned by an unknown or incompatible process.`)
  } catch (cause) {
    if (cause instanceof CompanionStartError) throw cause
    if (!await canBindPort(port)) throw new CompanionStartError('PORT_IN_USE', `Port ${port} is occupied by an unknown process.`, { cause })
  }
}

function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolveAvailable) => {
    const probe = createTcpServer()
    probe.once('error', () => resolveAvailable(false))
    probe.listen(port, COMPANION_HOST, () => probe.close(() => resolveAvailable(true)))
  })
}

function listen(server: Server, host: typeof COMPANION_HOST, port: number): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (cause: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      if (cause.code === 'EADDRINUSE') {
        rejectListen(new CompanionStartError('PORT_IN_USE', `Companion port ${port} is already in use.`, { cause }))
      } else {
        rejectListen(new CompanionStartError('COMPANION_STOPPED', 'Companion could not start its loopback listener.', { cause }))
      }
    }
    const onListening = () => {
      server.off('error', onError)
      resolveListen()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

interface SignalTarget {
  once(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  exitCode?: string | number | null
}

export function installCompanionSignalHandlers(running: Pick<RunningCompanion, 'stop'>, target: SignalTarget = process) {
  let shutdown: Promise<void> | undefined
  const handle = () => {
    shutdown ??= running.stop().then(() => { target.exitCode = 0 }, () => { target.exitCode = 1 })
    return shutdown
  }
  const onSignal = () => { void handle() }
  target.once('SIGINT', onSignal)
  target.once('SIGTERM', onSignal)
  return {
    shutdown: handle,
    dispose: () => { target.off('SIGINT', onSignal); target.off('SIGTERM', onSignal) },
  }
}

async function runCli(): Promise<void> {
  try {
    const running = await startCompanion({ databasePath: process.env.FINDMNEMO_DATABASE_PATH })
    console.log(`FindMnemo companion listening at http://${running.host}:${running.port}/app`)
    console.log(`Pairing code: ${running.pairingCode.slice(0, 4)} ${running.pairingCode.slice(4)}`)
    installCompanionSignalHandlers(running)
  } catch (cause) {
    const error = cause instanceof CompanionStartError
      ? cause
      : new CompanionStartError('INTERNAL_ERROR', 'Companion failed to start.', { cause })
    console.error(`${error.code}: ${error.message}`)
    process.exitCode = error.code === 'COMPANION_ALREADY_RUNNING' ? 0 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
