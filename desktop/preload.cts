import { contextBridge, ipcRenderer } from 'electron'
import type { FindMnemoLifecycleBridge, LifecycleState, TrustedTarget, UninstallChoice } from '../shared/lifecycle-contract.js'

// Sandboxed preload scripts cannot resolve application-local modules at runtime.
// Keep this closed mirror aligned through check:desktop-boundary.
const LIFECYCLE_IPC = Object.freeze({
  snapshot: 'findmnemo:lifecycle:snapshot', start: 'findmnemo:lifecycle:start', stop: 'findmnemo:lifecycle:stop',
  restart: 'findmnemo:lifecycle:restart', acceptDisclosure: 'findmnemo:lifecycle:accept-disclosure',
  setStartAtLogin: 'findmnemo:lifecycle:set-start-at-login', openTrustedTarget: 'findmnemo:lifecycle:open-trusted-target',
  changed: 'findmnemo:lifecycle:changed', runDiagnostics: 'findmnemo:lifecycle:run-diagnostics',
  previewSupportBundle: 'findmnemo:lifecycle:preview-support-bundle', chooseSupportDestination: 'findmnemo:lifecycle:choose-support-destination',
  saveSupportBundle: 'findmnemo:lifecycle:save-support-bundle',
  checkForUpdates: 'findmnemo:lifecycle:check-for-updates', downloadUpdate: 'findmnemo:lifecycle:download-update',
  cancelUpdateDownload: 'findmnemo:lifecycle:cancel-update-download', activateUpdate: 'findmnemo:lifecycle:activate-update',
  inspectExistingState: 'findmnemo:lifecycle:inspect-existing-state', adoptExistingState: 'findmnemo:lifecycle:adopt-existing-state',
  prepareUninstall: 'findmnemo:lifecycle:prepare-uninstall',
  launchUninstaller: 'findmnemo:lifecycle:launch-uninstaller',
})

const bridge: FindMnemoLifecycleBridge = Object.freeze({
  snapshot: () => ipcRenderer.invoke(LIFECYCLE_IPC.snapshot),
  startCompanion: () => ipcRenderer.invoke(LIFECYCLE_IPC.start),
  stopCompanion: () => ipcRenderer.invoke(LIFECYCLE_IPC.stop),
  restartCompanion: () => ipcRenderer.invoke(LIFECYCLE_IPC.restart),
  acceptDisclosure: (startAtLogin: boolean) => ipcRenderer.invoke(LIFECYCLE_IPC.acceptDisclosure, startAtLogin),
  setStartAtLogin: (enabled: boolean) => ipcRenderer.invoke(LIFECYCLE_IPC.setStartAtLogin, enabled),
  runDiagnostics: () => ipcRenderer.invoke(LIFECYCLE_IPC.runDiagnostics),
  previewSupportBundle: () => ipcRenderer.invoke(LIFECYCLE_IPC.previewSupportBundle),
  chooseSupportDestination: () => ipcRenderer.invoke(LIFECYCLE_IPC.chooseSupportDestination),
  saveSupportBundle: (previewId: string, destinationToken: string) => ipcRenderer.invoke(LIFECYCLE_IPC.saveSupportBundle, previewId, destinationToken),
  checkForUpdates: () => ipcRenderer.invoke(LIFECYCLE_IPC.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(LIFECYCLE_IPC.downloadUpdate),
  cancelUpdateDownload: () => ipcRenderer.invoke(LIFECYCLE_IPC.cancelUpdateDownload),
  activateUpdate: () => ipcRenderer.invoke(LIFECYCLE_IPC.activateUpdate),
  inspectExistingState: () => ipcRenderer.invoke(LIFECYCLE_IPC.inspectExistingState),
  adoptExistingState: () => ipcRenderer.invoke(LIFECYCLE_IPC.adoptExistingState),
  prepareUninstall: (choice: UninstallChoice, secondConfirmed: boolean) => ipcRenderer.invoke(LIFECYCLE_IPC.prepareUninstall, choice, secondConfirmed),
  launchUninstaller: () => ipcRenderer.invoke(LIFECYCLE_IPC.launchUninstaller),
  openTrustedTarget: (target: TrustedTarget) => ipcRenderer.invoke(LIFECYCLE_IPC.openTrustedTarget, target),
  subscribe: (listener: (state: LifecycleState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LifecycleState) => listener(state)
    ipcRenderer.on(LIFECYCLE_IPC.changed, handler)
    return () => ipcRenderer.removeListener(LIFECYCLE_IPC.changed, handler)
  },
})

contextBridge.exposeInMainWorld('findMnemoLifecycle', bridge)
