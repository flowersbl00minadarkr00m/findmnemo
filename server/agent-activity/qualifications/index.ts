import { qualificationModule as claudeDesktopCode } from './claude-desktop-code.js'
import { qualificationModule as claudeDesktopHome } from './claude-desktop-home.js'
import { qualificationModule as claudeCodeCli } from './claude-code-cli.js'
import { qualificationModule as codexDesktop } from './codex-desktop.js'
import { qualificationModule as codexCli } from './codex-cli.js'
import { qualificationModule as piCli } from './pi-cli.js'
import { PRECISE_ACTIVITY_CELLS, type PreciseActivityIntegrationId, type SurfaceQualificationModule } from './types.js'

const STATIC_QUALIFICATION_SLOTS = [
  claudeDesktopCode,
  claudeDesktopHome,
  claudeCodeCli,
  codexDesktop,
  codexCli,
  piCli,
] as const

export class SurfaceQualificationRegistry {
  private readonly modules: readonly SurfaceQualificationModule[]

  constructor(modules: readonly SurfaceQualificationModule[] = STATIC_QUALIFICATION_SLOTS) {
    this.modules = loadSurfaceQualifications(modules)
  }

  list(): readonly SurfaceQualificationModule[] {
    return this.modules
  }

  get(integrationId: string): SurfaceQualificationModule {
    const module = this.modules.find((candidate) => candidate.integrationId === integrationId)
    if (!module) throw new Error('ACTIVITY_INTEGRATION_NOT_FOUND')
    return module
  }
}

export function loadSurfaceQualifications(modules: readonly SurfaceQualificationModule[]): readonly SurfaceQualificationModule[] {
  if (modules.length !== PRECISE_ACTIVITY_CELLS.length) throw new Error('ACTIVITY_QUALIFICATION_SLOT_MISSING')
  const byId = new Map<PreciseActivityIntegrationId, SurfaceQualificationModule>()
  for (const module of modules) {
    if (byId.has(module.integrationId)) throw new Error('ACTIVITY_QUALIFICATION_SLOT_DUPLICATE')
    byId.set(module.integrationId, module)
  }
  return PRECISE_ACTIVITY_CELLS.map((cell) => {
    const module = byId.get(cell.integrationId)
    if (!module) throw new Error('ACTIVITY_QUALIFICATION_SLOT_MISSING')
    if (
      module.agentFamily !== cell.agentFamily ||
      module.executionSurface !== cell.executionSurface ||
      module.surfaceLabel !== cell.surfaceLabel ||
      module.platform !== 'win32'
    ) throw new Error('ACTIVITY_QUALIFICATION_SLOT_MISMATCH')
    validateModule(module)
    return module
  })
}

function validateModule(module: SurfaceQualificationModule): void {
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(module.adapterVersion)) throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(module.setup.mechanism)) throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  if (module.detection.detectedVersion !== null && !/^[A-Za-z0-9._-]{1,32}$/.test(module.detection.detectedVersion)) throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  if (module.detection.state !== 'detected' && module.detection.detectedVersion !== null) throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  if (module.setup.bindingVerified && module.setup.state !== 'verified') throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  if (module.qualification.qualifiedVersions.length > 16 || module.qualification.qualifiedVersions.some((version) => !/^[A-Za-z0-9._-]{1,32}$/.test(version))) throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  if (module.health.failureCode !== null && !/^[A-Z0-9_-]{1,64}$/.test(module.health.failureCode)) throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  for (const timestamp of [
    module.detection.checkedAt,
    module.reachability.checkedAt,
    module.qualification.lastQualifiedAt,
    module.health.checkedAt,
    module.health.lastSuccessAt,
  ]) if (timestamp !== null && !Number.isFinite(Date.parse(timestamp))) throw new Error('ACTIVITY_QUALIFICATION_INVALID')
  if (module.qualification.lastQualifiedAt === null && (
    module.qualification.manual ||
    module.qualification.snapshot !== 'none' ||
    module.qualification.automaticEvents !== 'none' ||
    module.qualification.explicitTerminal !== 'none'
  )) throw new Error('ACTIVITY_QUALIFICATION_UNVERIFIED')
}

export * from './types.js'
