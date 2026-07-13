import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'

export type UninstallChoice = 'preserve-data' | 'remove-credentials' | 'delete-all-data'
export interface UninstallPreview {
  planId: string
  choice: UninstallChoice
  expiresAt: string
  removes: readonly string[]
  retains: readonly string[]
  secondConfirmationRequired: boolean
}
export interface UninstallResult { completed: boolean; planApplied: UninstallChoice | 'preserve-fallback'; credentialsRemoved: boolean; dataDeleted: boolean; errorCode?: string }
export interface CredentialDeletionPort { hasCredential(): Promise<boolean>; deleteCredential(): Promise<void> }
export interface LifecycleRemovalPort { stopCompanion(): Promise<void>; removeLifecycleIntegrations(): Promise<void> }

interface StoredPlan { schema: 'findmnemo.uninstall.v1'; planId: string; choice: UninstallChoice; expiresAt: string; secondConfirmed: boolean; signature: string }

export class UninstallService {
  readonly #planPath: string
  readonly #keyPath: string
  constructor(readonly localAppData: string, readonly credentials: CredentialDeletionPort, readonly clock: () => Date = () => new Date()) {
    this.#planPath = join(this.dataRoot, 'uninstall-plan.json')
    this.#keyPath = join(this.dataRoot, 'uninstall.key')
    assertSafeRoot(localAppData, this.dataRoot)
  }
  get dataRoot(): string { return join(this.localAppData, 'FindMnemo') }

  async prepare(choice: UninstallChoice, secondConfirmed = false): Promise<UninstallPreview> {
    if (choice === 'delete-all-data' && !secondConfirmed) return preview('', choice, '', true)
    const key = await this.#loadOrCreateKey()
    const unsigned = { schema: 'findmnemo.uninstall.v1' as const, planId: randomUUID(), choice, expiresAt: new Date(this.clock().getTime() + 10 * 60_000).toISOString(), secondConfirmed }
    const plan: StoredPlan = { ...unsigned, signature: sign(unsigned, key) }
    await mkdir(this.dataRoot, { recursive: true })
    const temporary = `${this.#planPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.#planPath)
    return preview(plan.planId, choice, plan.expiresAt, false)
  }

  async execute(planId: string | undefined, lifecycle: LifecycleRemovalPort, useStoredPlan = false): Promise<UninstallResult> {
    const resolvedPlanId = planId ?? (useStoredPlan ? await this.#readStoredPlanId() : undefined)
    const plan = resolvedPlanId ? await this.#consumeValidPlan(resolvedPlanId) : undefined
    const choice = plan?.choice ?? 'preserve-data'
    try {
      await lifecycle.stopCompanion()
      await lifecycle.removeLifecycleIntegrations()
      await rm(join(this.dataRoot, 'updates'), { recursive: true, force: true })
      let credentialsRemoved = false
      if (choice === 'remove-credentials' || choice === 'delete-all-data') {
        await this.credentials.deleteCredential()
        credentialsRemoved = !(await this.credentials.hasCredential())
        if (!credentialsRemoved) return { completed: false, planApplied: choice, credentialsRemoved: false, dataDeleted: false, errorCode: 'UNINSTALL_CREDENTIAL_DELETE_INCOMPLETE' }
      }
      if (choice === 'delete-all-data') {
        assertSafeRoot(this.localAppData, this.dataRoot)
        await rm(this.dataRoot, { recursive: true, force: true })
        return { completed: true, planApplied: choice, credentialsRemoved, dataDeleted: !(await exists(this.dataRoot)) }
      }
      return { completed: true, planApplied: plan ? choice : 'preserve-fallback', credentialsRemoved, dataDeleted: false }
    } catch { return { completed: false, planApplied: plan ? choice : 'preserve-fallback', credentialsRemoved: false, dataDeleted: false, errorCode: 'UNINSTALL_INCOMPLETE' } }
  }

  async #readStoredPlanId(): Promise<string | undefined> {
    try { const value = JSON.parse(await readFile(this.#planPath, 'utf8')) as { planId?: unknown }; return typeof value.planId === 'string' ? value.planId : undefined }
    catch { return undefined }
  }

  async #consumeValidPlan(planId: string): Promise<StoredPlan | undefined> {
    try {
      const plan = JSON.parse(await readFile(this.#planPath, 'utf8')) as StoredPlan
      const key = await readFile(this.#keyPath)
      const signature = sign({ schema: plan.schema, planId: plan.planId, choice: plan.choice, expiresAt: plan.expiresAt, secondConfirmed: plan.secondConfirmed }, key)
      if (plan.schema !== 'findmnemo.uninstall.v1' || plan.planId !== planId || !validChoice(plan.choice) || Date.parse(plan.expiresAt) < this.clock().getTime() || (plan.choice === 'delete-all-data' && !plan.secondConfirmed) || !safeEqual(signature, plan.signature)) return undefined
      await rename(this.#planPath, `${this.#planPath}.consumed`)
      return plan
    } catch { return undefined }
  }

  async #loadOrCreateKey(): Promise<Buffer> {
    try { return await readFile(this.#keyPath) }
    catch (cause) {
      if (!isMissing(cause)) throw cause
      await mkdir(this.dataRoot, { recursive: true })
      const key = randomBytes(32)
      await writeFile(this.#keyPath, key, { mode: 0o600, flag: 'wx' })
      return key
    }
  }
}

function preview(planId: string, choice: UninstallChoice, expiresAt: string, secondConfirmationRequired: boolean): UninstallPreview {
  const removes = choice === 'preserve-data' ? ['application', 'startup registration', 'update cache'] : choice === 'remove-credentials' ? ['application', 'startup registration', 'update cache', 'Gmail credential'] : ['application', 'startup registration', 'update cache', 'tickets and audit history', 'settings and logs', 'Gmail credential']
  const retains = choice === 'preserve-data' ? ['tickets and audit history', 'settings and logs', 'Gmail credential'] : choice === 'remove-credentials' ? ['tickets and audit history', 'settings and logs'] : []
  return { planId, choice, expiresAt, removes, retains, secondConfirmationRequired }
}
function assertSafeRoot(localAppData: string, dataRoot: string): void { if (resolve(normalize(dataRoot)).toLowerCase() !== resolve(localAppData, 'FindMnemo').toLowerCase()) throw Object.assign(new Error('Uninstall data root is unsafe.'), { code: 'UNINSTALL_PATH_UNSAFE' }) }
function sign(value: Omit<StoredPlan, 'signature'>, key: Buffer): string { return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex') }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }
function validChoice(value: unknown): value is UninstallChoice { return value === 'preserve-data' || value === 'remove-credentials' || value === 'delete-all-data' }
async function exists(path: string): Promise<boolean> { try { await stat(path); return true } catch (cause) { if (isMissing(cause)) return false; throw cause } }
function isMissing(cause: unknown): boolean { return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT' }
