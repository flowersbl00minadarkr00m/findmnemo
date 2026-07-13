import type { AdoptionSnapshot } from '../../shared/lifecycle-contract.js'
import type { ExistingStateAdoptionService } from './migration-service.js'

export interface RepairPort { repairApplicationFiles(): Promise<void>; repairLifecycleRegistration(): Promise<void> }

export class InstallEventCoordinator {
  constructor(readonly adoption: ExistingStateAdoptionService, readonly repair: RepairPort) {}

  async repairPreservingData(): Promise<AdoptionSnapshot> {
    const before = await this.adoption.inspect(true)
    if (before.state === 'blocked') return before
    await this.repair.repairApplicationFiles()
    await this.repair.repairLifecycleRegistration()
    return this.adoption.inspect(true)
  }
}
