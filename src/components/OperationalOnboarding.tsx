import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanionConnectionState, CompanionIdentityDto } from '../../shared/companion-contract'
import {
  bootstrapLocalCompanion,
  deriveCompanionConnectionState,
  getCompanionIdentity,
  getCompanionStatus,
  hasLocalBootstrapEvidence,
  pairCompanion,
  rotateCompanionSession,
  revokeCompanionSession,
  sessionRotationDelay,
  type CompanionSession,
} from '../lib/companion-client'
import { ConnectionStatus } from './ConnectionStatus'
import { PairingDialog } from './PairingDialog'
import { createCompanionRepository } from '../lib/companion-repository'

const OperationalWorkspace = lazy(() => import('../App'))

const WINDOWS_PREVIEW_GUIDE = 'https://github.com/flowersbl00minadarkr00m/findmnemo/blob/main/docs/unsigned-windows-preview.md'

function classifyConnectionFailure(cause: unknown): { state: CompanionConnectionState; code: string } {
  const message = cause instanceof Error ? cause.message : 'CONNECTION_ERROR'
  const name = cause instanceof Error ? cause.name : ''
  if (cause instanceof TypeError || name === 'AbortError' || /failed to fetch|networkerror|load failed|aborted|timeout/i.test(message)) {
    return { state: 'not-installed', code: 'COMPANION_UNREACHABLE' }
  }
  if (message === 'COMPANION_STOPPED') return { state: 'stopped', code: message }
  if (message.startsWith('PAIRING_')) return { state: 'pairing-required', code: message }
  if (message === 'ORIGIN_NOT_ALLOWED') return { state: 'permission-denied', code: message }
  return { state: 'error', code: message }
}

export function OperationalOnboarding() {
  const [identity, setIdentity] = useState<CompanionIdentityDto>()
  const [session, setSession] = useState<CompanionSession>()
  const [connectionState, setConnectionState] = useState<CompanionConnectionState>('permission-required')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const identityRef = useRef<CompanionIdentityDto | undefined>(undefined)
  const localConnectAttemptedRef = useRef(false)
  const operationalRepository = useMemo(
    () => session ? createCompanionRepository(session) : undefined,
    [session],
  )
  const localFallback = useMemo(() => hasLocalBootstrapEvidence(), [])

  const verifyStatus = useCallback(async (nextSession: CompanionSession, nextIdentity?: CompanionIdentityDto) => {
    const nextStatus = await getCompanionStatus(nextSession)
    setSession(nextSession)
    setConnectionState(deriveCompanionConnectionState({ identity: nextIdentity ?? identityRef.current, session: nextSession, status: nextStatus }))
  }, [])

  useEffect(() => {
    if (!session || connectionState !== 'connected') return
    const timer = window.setTimeout(() => {
      void rotateCompanionSession(session)
        .then((rotated) => verifyStatus(rotated))
        .catch((cause: unknown) => {
          setSession(undefined)
          setError(cause instanceof Error ? cause.message : 'SESSION_INVALID')
          setConnectionState('pairing-required')
        })
    }, sessionRotationDelay(session))
    return () => window.clearTimeout(timer)
  }, [connectionState, session, verifyStatus])

  const connect = useCallback(async () => {
    setPending(true)
    setError(undefined)
    try {
      const nextIdentity = await getCompanionIdentity()
      identityRef.current = nextIdentity
      setIdentity(nextIdentity)
      const localSession = await bootstrapLocalCompanion()
      if (localSession) {
        await verifyStatus(localSession, nextIdentity)
      } else {
        setConnectionState('pairing-required')
      }
    } catch (cause) {
      const failure = classifyConnectionFailure(cause)
      setError(failure.code)
      setConnectionState(failure.state)
    } finally {
      setPending(false)
    }
  }, [verifyStatus])

  useEffect(() => {
    if (localFallback && !localConnectAttemptedRef.current) {
      localConnectAttemptedRef.current = true
      void connect()
    }
  }, [connect, localFallback])

  async function pair(code: string) {
    setPending(true)
    setError(undefined)
    try {
      await verifyStatus(await pairCompanion(code))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Pairing failed.')
    } finally {
      setPending(false)
    }
  }

  async function disconnect() {
    if (session) await revokeCompanionSession(session)
    setSession(undefined)
    setConnectionState(identity ? 'pairing-required' : 'permission-required')
  }

  if (connectionState === 'connected' && operationalRepository) {
    return (
      <Suspense fallback={<OperationalWorkspaceLoading />}>
        <div className="relative">
          <div className="fixed right-3 bottom-3 z-50 flex items-center gap-2 rounded-sm border border-memory/40 bg-chrome-raised px-3 py-2 text-xs text-memory shadow-xl">
            <span>Companion verified</span>
            <button type="button" onClick={disconnect} className="underline">Disconnect</button>
          </div>
          <OperationalWorkspace operationalRepository={operationalRepository} />
        </div>
      </Suspense>
    )
  }

  const companionRecoveryNeeded = connectionState === 'not-installed' || connectionState === 'stopped' || connectionState === 'error' || connectionState === 'unsupported'

  return (
    <main className="min-h-screen bg-mist text-ink grid place-items-center px-5 py-10">
      <section className="panel w-full max-w-3xl rounded-sm p-7 sm:p-10">
        <p className="hud-label">Operational workspace · {connectionState}</p>
        <h1 className="mt-3 text-3xl font-semibold">Connect this computer</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-mut">
          FindMnemo connects this page to the app running on this computer. Email access, local AI activity, project files, and credentials stay on this device.
        </p>
        <div className="mt-6"><ConnectionStatus state={connectionState} /></div>
        {companionRecoveryNeeded && (
          <section className="mt-4 rounded-sm border border-amber-400/35 bg-amber-400/[0.07] p-4" aria-labelledby="local-companion-required">
            <h2 id="local-companion-required" className="text-sm font-semibold text-amber-100">The local companion must be installed and running</h2>
            <p className="mt-2 text-xs leading-5 text-mut">The Vercel interface cannot install or start software on this computer. FindMnemo keeps operational data private by connecting to the companion at <span className="font-mono text-ink">127.0.0.1:3210</span>.</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-5 text-mut"><li>Install the Windows preview or build FindMnemo from source.</li><li>Open FindMnemo and start the companion.</li><li>Return here and choose Retry connection.</li></ol>
            <a href={WINDOWS_PREVIEW_GUIDE} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-medium text-sync underline underline-offset-2">Open Windows install and source-run guidance</a>
          </section>
        )}
        {connectionState === 'pairing-required' && (
          <div className="mt-6"><PairingDialog pending={pending} error={error} onPair={pair} /></div>
        )}
        {error && <p className="mt-3 text-xs text-rose-300" role="alert">{connectionState === 'pairing-required' ? 'The automatic local handoff expired or was already used. Enter the current one-time code shown in the installed FindMnemo window.' : `Diagnostic code: ${error}`}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {connectionState !== 'connected' && connectionState !== 'pairing-required' && (
            <button type="button" disabled={pending} onClick={connect} className="rounded-sm bg-sync px-4 py-2 text-sm font-semibold text-chrome disabled:opacity-55">
              {pending ? 'Connecting...' : companionRecoveryNeeded ? 'Retry connection' : 'Connect this computer'}
            </button>
          )}
          <a href="http://127.0.0.1:3210/app" className="rounded-sm border border-line px-4 py-2 text-sm text-ink hover:border-sync/60">Open local app (requires companion running)</a>
          <a href="/demo" className="rounded-sm border border-line px-4 py-2 text-sm text-ink hover:border-sync/60">Explore fictional sample</a>
          <a href={localFallback ? 'https://findmnemo.vercel.app/app' : '/'} className="px-4 py-2 text-sm text-mut hover:text-ink">{localFallback ? 'Return to hosted setup' : 'Back'}</a>
        </div>
      </section>
    </main>
  )
}

function OperationalWorkspaceLoading() {
  return (
    <main className="min-h-screen bg-mist text-ink grid place-items-center px-5 py-10">
      <p className="text-sm text-mut" role="status">Loading the verified operational workspace...</p>
    </main>
  )
}
