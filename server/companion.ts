import { createServer, type Server } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequestHandler } from './api/routes.js'
import { createCompanionIdentity } from './diagnostics/identity.js'
import { COMPANION_PROTOCOL_VERSION, type CompanionErrorCode, type SourceRunCapabilityReport } from '../shared/companion-contract.js'
import { PairingService } from './auth/pairing-service.js'
import type { RequestSecurityOptions } from './api/request-security.js'
import { openFindMnemoDatabase } from './db/database.js'
import { OperationalRepository } from './db/operational-repository.js'
import { createGmailServices, type GmailServices } from './gmail/gmail-services.js'
import { GmailMetadataClient } from './gmail/gmail-client.js'
import { GmailCheckService } from './gmail/gmail-source.js'
import { ReconciliationEngine } from './reconciliation/engine.js'
import { FindMnemoTicketsAdapter } from './reconciliation/adapters/findmnemo-tickets.js'
import { GmailFollowupsAdapter } from './reconciliation/adapters/gmail-followups.js'
import { ProjectSddAdapter } from './reconciliation/adapters/project-sdd.js'
import { AgentLedgerAdapter } from './reconciliation/adapters/agent-ledger.js'
import { SafeLogger } from './observability/logger.js'
import { resolvePlatformPaths } from './platform/platform-paths.js'
import { createSourceRunCapabilityReport } from './platform/platform-capabilities.js'

export const COMPANION_HOST = '127.0.0.1' as const
export const COMPANION_PORT = 3210
export const COMPANION_VERSION = '0.1.0'

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
}

export interface RunningCompanion {
  host: typeof COMPANION_HOST
  port: number
  server: Server
  stop: () => Promise<void>
  pairingCode: string
  localBootstrapNonce: string
  databasePath: string
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
  const logger = new SafeLogger(join(defaultPaths?.logsRoot ?? dirname(database.path), 'companion.log'))
  await logger.write({ level: 'info', code: 'COMPANION_START', status: 200 })
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
    new ProjectSddAdapter(operationalRepository),
    new AgentLedgerAdapter(operationalRepository),
  ], clock)
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
      gmailServices: resolvedGmailServices,
      gmailCheckService,
      reconciliationEngine,
      logger,
      capabilityReport: resolvedCapabilityReport,
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
      server.close((error) => {
        void logger.drain().then(() => {
          database.close()
          if (error) rejectStop(error)
          else resolveStop()
        }, (logError) => {
          database.close()
          rejectStop(logError)
        })
      })
    })
    return stopPromise
  }

  return {
    host,
    port: address.port,
    server,
    pairingCode,
    localBootstrapNonce,
    databasePath: database.path,
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
