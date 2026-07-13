import type { ReconciliationRunDto } from '../../shared/companion-contract'
import type { OperationalRepository } from './operational-repository'
import { appendTelemetry, loadTelemetry } from './telemetry'

export async function pollReconciliationRun(
  repository: OperationalRepository,
  initial: ReconciliationRunDto,
  onUpdate: (run: ReconciliationRunDto) => void,
): Promise<ReconciliationRunDto> {
  if (!repository.getReconciliationRun) throw new Error('Reconciliation status is unavailable.')
  const started = Date.now()
  let run = initial
  onUpdate(run)
  while (run.state === 'queued' || run.state === 'running') {
    await waitUntilVisible()
    await wait(Date.now() - started < 10_000 ? 500 : 1_500)
    run = await repository.getReconciliationRun(run.id)
    onUpdate(run)
  }
  return run
}

export function recordReconciliationTelemetry(run: ReconciliationRunDto): void {
  const timestamp = run.finishedAt ?? new Date().toISOString()
  const counts = run.sources.reduce((total, source) => ({
    checked: total.checked + source.checked,
    changed: total.changed + source.added + source.updated,
    unresolved: total.unresolved + source.unresolved + source.duplicate,
  }), { checked: 0, changed: 0, unresolved: 0 })
  appendTelemetry({
    eventId: `mnemo-reconcile-${run.id}`, caseId: run.id, traceId: `reconcile-${run.id}`, timestamp,
    sequence: loadTelemetry().filter((event) => event.caseId === run.id).length,
    intent: 'Reconcile configured sources',
    activity: { id: 'mnemosync-reconcile', label: 'MnemoSync reconciliation', type: 'reconcile', primitiveVersion: '1.0.0' },
    actor: { id: 'system-mnemosync', label: 'FindMnemo', type: 'system', role: 'local reconciliation engine', authorityLevel: 2 },
    objects: [{ id: run.id, type: 'reconciliation-run', role: 'subject', sourceRef: `mnemosync://reconciliation/${run.id}`, classification: 'private-work-data' }],
    result: { status: run.state === 'complete' ? 'success' : run.state === 'partial' ? 'exception' : 'failure', reasonCode: `RECONCILIATION_${run.state.toUpperCase()}`, message: `${counts.checked} checked; ${counts.changed} changed; ${counts.unresolved} unresolved.` },
    truthState: 'observed',
    provenance: { sourceType: 'mnemosync', sourceRef: `mnemosync://reconciliation/${run.id}`, ingestedAt: timestamp, transformation: 'Privacy-minimized reconciliation result' },
    tags: ['mnemosync', 'reconcile', run.state],
  })
}

function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }

function waitUntilVisible(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return Promise.resolve()
  return new Promise((resolve) => {
    const onVisible = () => {
      if (document.visibilityState === 'hidden') return
      document.removeEventListener('visibilitychange', onVisible)
      resolve()
    }
    document.addEventListener('visibilitychange', onVisible)
  })
}
