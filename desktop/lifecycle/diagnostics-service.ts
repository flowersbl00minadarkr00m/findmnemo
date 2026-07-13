import { runCompanionDoctor, type DoctorCheck } from '../../server/diagnostics/doctor.js'
import type { LifecycleDiagnosticCheck, LifecycleDiagnosticReport } from '../../shared/lifecycle-contract.js'

const BOUNDARIES: Record<string, LifecycleDiagnosticCheck['boundary']> = {
  listener: 'listener', database: 'database', 'gmail-client': 'credential', 'gmail-credential': 'credential', 'browser-envelope': 'protocol',
}

export class LifecycleDiagnosticsService {
  constructor(readonly options: { localAppData: string; clock?: () => Date; timeoutMs?: number }) {}

  async run(): Promise<LifecycleDiagnosticReport> {
    const timeoutMs = this.options.timeoutMs ?? 30_000
    const checks = await Promise.race([
      runCompanionDoctor({ localAppData: this.options.localAppData }),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('Diagnostics timed out.'), { code: 'DIAGNOSTICS_TIMEOUT' })), timeoutMs)),
    ])
    return { generatedAt: (this.options.clock ?? (() => new Date()))().toISOString(), checks: checks.map(normalize) }
  }
}

function normalize(check: DoctorCheck): LifecycleDiagnosticCheck {
  return {
    id: check.id,
    state: check.state,
    code: check.code,
    boundary: BOUNDARIES[check.id] ?? 'installation',
    message: check.guidance,
    retryable: check.state !== 'pass',
    recoveryAction: recovery(check.code),
  }
}

function recovery(code: string): LifecycleDiagnosticCheck['recoveryAction'] {
  if (code === 'COMPANION_STOPPED') return 'restart'
  if (code.includes('DATABASE') || code === 'IDENTITY_MISMATCH' || code === 'PORT_IN_USE') return 'repair'
  if (code.includes('PROTOCOL')) return 'update'
  return code.includes('GMAIL') ? undefined : 'retry'
}
