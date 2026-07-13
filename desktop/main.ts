import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell, Tray, type IpcMainInvokeEvent } from 'electron'
import electronUpdater from 'electron-updater'
import { COMPANION_PROTOCOL_VERSION } from '../shared/companion-contract.js'
import { DATABASE_SCHEMA_VERSION } from '../server/db/database.js'
import { LIFECYCLE_IPC, isTrustedTarget, type LifecycleState, type TrustedTarget, type UninstallChoice } from '../shared/lifecycle-contract.js'
import { WindowsDpapiSecretStore } from '../server/auth/windows-dpapi-store.js'
import { PackagedCompanionHost } from './lifecycle/companion-host.js'
import { LifecycleController } from './lifecycle/controller.js'
import { LifecycleDiagnosticsService } from './lifecycle/diagnostics-service.js'
import { ElectronUpdateProvider } from './lifecycle/electron-update-provider.js'
import { ExistingStateAdoptionService, LoopbackCompanionInspector } from './lifecycle/migration-service.js'
import { assertBundledRendererSender } from './lifecycle/ipc-security.js'
import { LifecycleStateStore, PersistedLifecyclePreferences } from './lifecycle/state-store.js'
import { SupportBundleService } from './lifecycle/support-bundle.js'
import { UpdateCoordinator } from './lifecycle/update-service.js'
import { UpdateRecoveryStore } from './lifecycle/update-recovery.js'
import { UninstallService } from './lifecycle/uninstall.js'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))
const { autoUpdater } = electronUpdater
const appRoot = app.getAppPath()
const rendererRoot = join(appRoot, 'dist-desktop-renderer')
const allowedRendererUrl = 'findmnemo://app/desktop.html'
const trustedTargets: Record<TrustedTarget, string> = {
  'hosted-app': 'https://mnemosync.vercel.app/app',
  'local-app': 'http://127.0.0.1:3210/app',
  'support-docs': 'https://mnemosync.vercel.app/',
}
const updateFeedUrl = 'https://mnemosync.vercel.app/releases/windows/x64/'

let window: BrowserWindow | undefined
let tray: Tray | undefined
let controller: LifecycleController | undefined
let diagnostics: LifecycleDiagnosticsService | undefined
let supportBundles: SupportBundleService | undefined
let updates: UpdateCoordinator | undefined
let adoption: ExistingStateAdoptionService | undefined
let uninstall: UninstallService | undefined
let dataRoot: string | undefined
let updateTimer: NodeJS.Timeout | undefined
let updateRecovery: UpdateRecoveryStore | undefined
const supportDestinations = new Map<string, { path: string; expiresAt: number }>()
let quitting = false

protocol.registerSchemesAsPrivileged([{ scheme: 'findmnemo', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false, corsEnabled: false } }])

if (process.argv.includes('--apply-uninstall-plan')) void app.whenReady().then(applyUninstallPlan)
else if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => showWindow())
  void app.whenReady().then(boot)
}

async function boot(): Promise<void> {
  registerLocalRendererProtocol()
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) throw new Error('LOCALAPPDATA is unavailable; the per-user companion cannot start safely.')
  dataRoot = join(localAppData, 'FindMnemo')
  adoption = new ExistingStateAdoptionService(dataRoot, new LoopbackCompanionInspector())
  updateRecovery = new UpdateRecoveryStore(join(dataRoot, 'updates', 'recovery.json'))
  uninstall = createUninstallService(localAppData)
  const adoptionAtBoot = await adoption.inspect()
  const store = new LifecycleStateStore(join(dataRoot, 'lifecycle.json'))
  diagnostics = new LifecycleDiagnosticsService({ localAppData })
  supportBundles = new SupportBundleService()
  const settings = await store.load()
  const smokeTest = process.argv.includes('--smoke-test')
  const preferences = new PersistedLifecyclePreferences(store, settings, async (enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] })
    return app.getLoginItemSettings({ args: ['--background'] }).openAtLogin
  })
  const host = new PackagedCompanionHost({
    appVersion: app.getVersion(),
    instanceId: settings.instanceId,
    distPath: join(appRoot, 'dist'),
  })
  controller = new LifecycleController(host, {
    appVersion: app.getVersion(),
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    instanceId: settings.instanceId,
    startupEnabled: settings.startupEnabled,
    disclosureVersion: settings.disclosureVersion ?? '1.0.0',
    disclosureAcceptedAt: smokeTest ? 'smoke-test' : settings.disclosureAcceptedAt,
    preferences,
  })
  if (app.isPackaged) {
    updates = new UpdateCoordinator(new ElectronUpdateProvider(autoUpdater, { feedUrl: updateFeedUrl }), {
      currentVersion: app.getVersion(), protocolVersion: COMPANION_PROTOCOL_VERSION,
    })
    updates.subscribe((snapshot) => controller?.applyUpdateSnapshot(snapshot))
  }
  controller.subscribe((state) => {
    window?.webContents.send(LIFECYCLE_IPC.changed, state)
    rebuildTray(state)
  })
  registerIpc()
  if (smokeTest) {
    const result = await controller.start()
    await controller.stop()
    app.exit(result.ok ? 0 : 1)
    return
  }
  createWindow()
  rebuildTray(controller.snapshot())
  if (controller.snapshot().disclosure.acceptedAt && !['ready', 'requires-stop', 'blocked'].includes(adoptionAtBoot.state)) {
    const result = await controller.start()
    if (result.ok) { await updateRecovery.reconcileAfterHealth(app.getVersion()); scheduleUpdateChecks() }
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 520,
    minHeight: 460,
    show: false,
    backgroundColor: '#071014',
    title: 'FindMnemo Companion',
    webPreferences: {
      preload: join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.on('will-navigate', (event, url) => { if (url !== allowedRendererUrl) event.preventDefault() })
  window.on('close', (event) => {
    if (!quitting) { event.preventDefault(); window?.hide() }
  })
  window.on('ready-to-show', () => window?.show())
  void window.loadURL(allowedRendererUrl)
}

function registerLocalRendererProtocol(): void {
  protocol.handle('findmnemo', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = resolve(rendererRoot, relative || 'desktop.html')
    const root = resolve(rendererRoot)
    if (file !== root && !file.startsWith(`${root}${sep}`)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).href)
  })
}

function rebuildTray(state: LifecycleState): void {
  if (!tray) {
    const pixel = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==')
    tray = new Tray(pixel.resize({ width: 16, height: 16 }))
    tray.setToolTip('FindMnemo Companion')
    tray.on('double-click', showWindow)
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Status: ${state.phase}`, enabled: false },
    { label: 'Open FindMnemo', click: () => void openTarget('hosted-app') },
    { label: 'Open local workspace', click: () => void openTarget('local-app') },
    { type: 'separator' },
    { label: 'Start companion', enabled: state.phase === 'stopped' || state.phase === 'failed', click: () => void controller?.start() },
    { label: 'Stop companion', enabled: state.companion.state === 'healthy', click: () => void controller?.stop() },
    { label: 'Restart companion', enabled: state.companion.state === 'healthy', click: () => void controller?.restart() },
    { label: 'Check for updates', enabled: Boolean(updates), click: () => void checkForUpdates() },
    { type: 'separator' },
    { label: 'Show controls', click: showWindow },
    { label: 'Quit', click: () => void quitApplication() },
  ]))
}

function registerIpc(): void {
  ipcMain.handle(LIFECYCLE_IPC.snapshot, (event) => { assertTrustedSender(event); return requiredController().snapshot() })
  ipcMain.handle(LIFECYCLE_IPC.start, async (event) => { assertTrustedSender(event); const result = await requiredController().start(); if (result.ok) scheduleUpdateChecks(); return result })
  ipcMain.handle(LIFECYCLE_IPC.stop, (event) => { assertTrustedSender(event); return requiredController().stop() })
  ipcMain.handle(LIFECYCLE_IPC.restart, (event) => { assertTrustedSender(event); return requiredController().restart() })
  ipcMain.handle(LIFECYCLE_IPC.acceptDisclosure, async (event, startAtLogin: unknown) => {
    assertTrustedSender(event)
    if (typeof startAtLogin !== 'boolean') throw new Error('Startup preference must be boolean.')
    const result = await requiredController().acceptDisclosure(startAtLogin)
    if (!result.ok) return result
    const adopted = await requiredAdoption().adopt()
    if (adopted.state === 'blocked' || adopted.state === 'requires-stop') return { ok: false, state: requiredController().snapshot(), errorCode: adopted.errorCode }
    const started = await requiredController().start()
    if (started.ok) scheduleUpdateChecks()
    return started
  })
  ipcMain.handle(LIFECYCLE_IPC.setStartAtLogin, (event, enabled: unknown) => {
    assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new Error('Startup preference must be boolean.')
    return requiredController().setStartAtLogin(enabled)
  })
  ipcMain.handle(LIFECYCLE_IPC.runDiagnostics, async (event) => { assertTrustedSender(event); return requiredDiagnostics().run() })
  ipcMain.handle(LIFECYCLE_IPC.previewSupportBundle, async (event) => {
    assertTrustedSender(event)
    return requiredSupportBundles().preview(await requiredDiagnostics().run())
  })
  ipcMain.handle(LIFECYCLE_IPC.chooseSupportDestination, async (event) => {
    assertTrustedSender(event)
    const options = { title: 'Save privacy-minimized FindMnemo support bundle', defaultPath: `findmnemo-support-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] }
    const selected = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (selected.canceled || !selected.filePath) return undefined
    const token = randomUUID()
    supportDestinations.set(token, { path: selected.filePath, expiresAt: Date.now() + 10 * 60_000 })
    return token
  })
  ipcMain.handle(LIFECYCLE_IPC.saveSupportBundle, async (event, previewId: unknown, destinationToken: unknown) => {
    assertTrustedSender(event)
    if (typeof previewId !== 'string' || typeof destinationToken !== 'string') throw new Error('Support save request is invalid.')
    const destination = supportDestinations.get(destinationToken)
    supportDestinations.delete(destinationToken)
    if (!destination || destination.expiresAt < Date.now()) return { ok: false, errorCode: 'SUPPORT_DESTINATION_EXPIRED' }
    return requiredSupportBundles().save(previewId, destination.path)
  })
  ipcMain.handle(LIFECYCLE_IPC.checkForUpdates, async (event) => { assertTrustedSender(event); await checkForUpdates(); return requiredController().snapshot() })
  ipcMain.handle(LIFECYCLE_IPC.downloadUpdate, async (event) => { assertTrustedSender(event); await requiredUpdates().download(); return requiredController().snapshot() })
  ipcMain.handle(LIFECYCLE_IPC.cancelUpdateDownload, (event) => { assertTrustedSender(event); requiredUpdates().cancelDownload(); return requiredController().snapshot() })
  ipcMain.handle(LIFECYCLE_IPC.activateUpdate, async (event) => {
    assertTrustedSender(event)
    const targetVersion = requiredUpdates().snapshot().targetVersion
    await requiredUpdates().activate(async () => { await requiredController().stop() }, async () => {
      await backupBeforeUpdate()
      if (targetVersion) await requiredUpdateRecovery().prepare({ previousVersion: app.getVersion(), targetVersion, databaseSchemaVersion: DATABASE_SCHEMA_VERSION, previousRuntimeMaxSchemaVersion: DATABASE_SCHEMA_VERSION })
    })
    return requiredController().snapshot()
  })
  ipcMain.handle(LIFECYCLE_IPC.inspectExistingState, (event) => { assertTrustedSender(event); return requiredAdoption().inspect(requiredController().snapshot().companion.state === 'healthy') })
  ipcMain.handle(LIFECYCLE_IPC.adoptExistingState, async (event) => {
    assertTrustedSender(event)
    const result = await requiredAdoption().adopt()
    if (result.state === 'adopted' || result.state === 'already-adopted') {
      const started = await requiredController().start()
      if (started.ok) scheduleUpdateChecks()
    }
    return result
  })
  ipcMain.handle(LIFECYCLE_IPC.prepareUninstall, (event, choice: unknown, secondConfirmed: unknown) => {
    assertTrustedSender(event)
    if (!isUninstallChoice(choice) || typeof secondConfirmed !== 'boolean') throw new Error('Uninstall choice is invalid.')
    return requiredUninstall().prepare(choice, secondConfirmed)
  })
  ipcMain.handle(LIFECYCLE_IPC.launchUninstaller, async (event) => {
    assertTrustedSender(event)
    const error = await shell.openPath(join(dirname(process.execPath), 'Uninstall FindMnemo Companion.exe'))
    if (error) return { ok: false, errorCode: 'UNINSTALLER_UNAVAILABLE' }
    setTimeout(() => void quitApplication(), 250).unref()
    return { ok: true }
  })
  ipcMain.handle(LIFECYCLE_IPC.openTrustedTarget, async (event, target: unknown) => {
    assertTrustedSender(event)
    if (!isTrustedTarget(target)) throw new Error('Trusted target is invalid.')
    await openTarget(target)
  })
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  assertBundledRendererSender(event.senderFrame?.url, allowedRendererUrl)
}

function requiredController(): LifecycleController {
  if (!controller) throw new Error('Lifecycle controller is unavailable.')
  return controller
}

function requiredDiagnostics(): LifecycleDiagnosticsService {
  if (!diagnostics) throw new Error('Diagnostics are unavailable.')
  return diagnostics
}

function requiredSupportBundles(): SupportBundleService {
  if (!supportBundles) throw new Error('Support export is unavailable.')
  return supportBundles
}

function requiredUpdates(): UpdateCoordinator {
  if (!updates) throw new Error('Updates are available only in the packaged Windows companion.')
  return updates
}

function requiredAdoption(): ExistingStateAdoptionService {
  if (!adoption) throw new Error('Existing-state adoption is unavailable.')
  return adoption
}

function requiredUninstall(): UninstallService {
  if (!uninstall) throw new Error('Uninstall planning is unavailable.')
  return uninstall
}

function requiredUpdateRecovery(): UpdateRecoveryStore {
  if (!updateRecovery) throw new Error('Update recovery state is unavailable.')
  return updateRecovery
}

function createUninstallService(localAppData: string): UninstallService {
  const credentialPath = join(localAppData, 'FindMnemo', 'secrets', 'gmail-refresh-token.dpapi')
  const store = new WindowsDpapiSecretStore(join(localAppData, 'FindMnemo', 'secrets'))
  return new UninstallService(localAppData, {
    hasCredential: async () => { try { await stat(credentialPath); return true } catch (cause) { if (isMissingFile(cause)) return false; throw cause } },
    deleteCredential: () => store.delete('gmail-refresh-token'),
  })
}

async function applyUninstallPlan(): Promise<void> {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) { app.exit(1); return }
  const service = createUninstallService(localAppData)
  const result = await service.execute(undefined, {
    stopCompanion: async () => undefined,
    removeLifecycleIntegrations: async () => { app.setLoginItemSettings({ openAtLogin: false, args: ['--background'] }) },
  }, true)
  await writeFile(join(process.env.TEMP ?? localAppData, 'findmnemo-uninstall-result.json'), `${JSON.stringify(result)}\n`, { mode: 0o600 })
  app.exit(result.completed ? 0 : 1)
}

async function checkForUpdates(): Promise<void> {
  if (!updates || ['checking', 'downloading', 'activating'].includes(updates.snapshot().state)) return
  await updates.check()
}

function scheduleUpdateChecks(): void {
  if (!updates || updateTimer) return
  const firstDelay = 3_000 + Math.floor(Math.random() * 2_000)
  updateTimer = setTimeout(() => {
    void checkForUpdates()
    const sixHours = 6 * 60 * 60_000
    updateTimer = setInterval(() => void checkForUpdates(), sixHours + Math.floor(Math.random() * 15 * 60_000))
    updateTimer.unref()
  }, firstDelay)
  updateTimer.unref()
}

async function backupBeforeUpdate(): Promise<void> {
  if (!dataRoot) throw new Error('Local data root is unavailable.')
  const destination = join(dataRoot, 'updates', 'pre-activation-backup')
  await mkdir(destination, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const name of ['findmnemo.db', 'lifecycle.json']) {
    try { await copyFile(join(dataRoot, name), join(destination, `${name}.${stamp}.bak`)) }
    catch (cause) { if (!isMissingFile(cause)) throw cause }
  }
}

function isMissingFile(cause: unknown): boolean { return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT' }
function isUninstallChoice(value: unknown): value is UninstallChoice { return value === 'preserve-data' || value === 'remove-credentials' || value === 'delete-all-data' }

async function openTarget(target: TrustedTarget): Promise<void> {
  await shell.openExternal(trustedTargets[target])
}

function showWindow(): void {
  if (!window) createWindow()
  window?.show()
  window?.focus()
}

async function quitApplication(): Promise<void> {
  if (quitting) return
  quitting = true
  try { await controller?.stop() } finally { app.quit() }
}

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { /* Tray process remains authoritative. */ })
