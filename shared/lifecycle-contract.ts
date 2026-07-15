export const LIFECYCLE_PHASES = [
  'first-run',
  'starting',
  'healthy',
  'stopping',
  'stopped',
  'degraded',
  'failed',
  'update-available',
  'update-downloading',
  'update-ready',
  'updating',
  'repair-required',
  'unsupported',
] as const

export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number]

export const LIFECYCLE_IPC = {
  snapshot: 'findmnemo:lifecycle:snapshot',
  start: 'findmnemo:lifecycle:start',
  stop: 'findmnemo:lifecycle:stop',
  restart: 'findmnemo:lifecycle:restart',
  acceptDisclosure: 'findmnemo:lifecycle:accept-disclosure',
  setStartAtLogin: 'findmnemo:lifecycle:set-start-at-login',
  openTrustedTarget: 'findmnemo:lifecycle:open-trusted-target',
  changed: 'findmnemo:lifecycle:changed',
  runDiagnostics: 'findmnemo:lifecycle:run-diagnostics',
  previewSupportBundle: 'findmnemo:lifecycle:preview-support-bundle',
  chooseSupportDestination: 'findmnemo:lifecycle:choose-support-destination',
  saveSupportBundle: 'findmnemo:lifecycle:save-support-bundle',
  checkForUpdates: 'findmnemo:lifecycle:check-for-updates',
  downloadUpdate: 'findmnemo:lifecycle:download-update',
  cancelUpdateDownload: 'findmnemo:lifecycle:cancel-update-download',
  activateUpdate: 'findmnemo:lifecycle:activate-update',
  inspectExistingState: 'findmnemo:lifecycle:inspect-existing-state',
  adoptExistingState: 'findmnemo:lifecycle:adopt-existing-state',
  prepareUninstall: 'findmnemo:lifecycle:prepare-uninstall',
  launchUninstaller: 'findmnemo:lifecycle:launch-uninstaller',
  pairingSnapshot: 'findmnemo:lifecycle:pairing-snapshot',
  refreshPairingCode: 'findmnemo:lifecycle:refresh-pairing-code',
  chooseProjectFolders: 'findmnemo:lifecycle:choose-project-folders',
  commitProjectFolders: 'findmnemo:lifecycle:commit-project-folders',
} as const

export const TRUSTED_TARGETS = ['hosted-app', 'local-app', 'support-docs'] as const
export type TrustedTarget = (typeof TRUSTED_TARGETS)[number]

export interface CompanionLifecycleEvidence {
  state: 'starting' | 'healthy' | 'stopping' | 'stopped' | 'failed' | 'unsupported'
  version?: string
  host?: '127.0.0.1'
  port?: number
  errorCode?: string
}

export interface LifecycleState {
  phase: LifecyclePhase
  appVersion: string
  protocolVersion: string
  instanceId: string
  companion: CompanionLifecycleEvidence
  startup: { enabled: boolean; consentedAt?: string }
  disclosure: { version: string; acceptedAt?: string }
  update: { state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'activating' | 'failed'; targetVersion?: string; progress?: number; errorCode?: string; permissionChanges?: readonly string[]; releaseNotes?: string }
  lastHealthCheckAt?: string
  lastHealthyAt?: string
  recoveryActions: readonly ('retry' | 'restart' | 'open-local' | 'quit')[]
}

export interface LifecycleCommandResult {
  ok: boolean
  state: LifecycleState
  errorCode?: string
}

export type DiagnosticState = 'pass' | 'attention' | 'fail'
export interface LifecycleDiagnosticCheck {
  id: string
  state: DiagnosticState
  code: string
  boundary: 'installation' | 'process' | 'listener' | 'database' | 'credential' | 'protocol' | 'update' | 'startup'
  message: string
  retryable: boolean
  recoveryAction?: 'retry' | 'restart' | 'repair' | 'update' | 'open-local'
}
export interface LifecycleDiagnosticReport { generatedAt: string; checks: readonly LifecycleDiagnosticCheck[] }
export interface SupportBundlePreview { previewId: string; generatedAt: string; fields: readonly string[]; report: LifecycleDiagnosticReport }
export interface SupportSaveResult { ok: boolean; fileName?: string; errorCode?: string }
export interface AdoptionSnapshot {
  state: 'fresh' | 'ready' | 'already-adopted' | 'requires-stop' | 'blocked' | 'adopted'
  databasePresent: boolean
  schemaVersion?: number
  credentialPresent: boolean
  lifecycleSettingsPresent: boolean
  listener: 'none' | 'compatible' | 'unknown'
  backupRequired: boolean
  errorCode?: string
  retainedLocation: '%LOCALAPPDATA%\\FindMnemo'
}
export type UninstallChoice = 'preserve-data' | 'remove-credentials' | 'delete-all-data'
export interface UninstallPreview { planId: string; choice: UninstallChoice; expiresAt: string; removes: readonly string[]; retains: readonly string[]; secondConfirmationRequired: boolean }
export interface CompanionPairingSnapshot {
  state: 'ready' | 'unavailable'
  code?: string
  expiresAt?: string
  guidance: string
}

export interface ProjectFolderSelectionItem {
  label: string
  detectedKind: 'sdd' | 'git' | 'generic' | 'unavailable'
  relationship: 'new' | 'duplicate' | 'nested' | 'contains-existing'
  warning: string | null
  sddEnrichmentAvailable: boolean
}
export interface ProjectFolderSelectionPreview {
  state: 'ready' | 'cancelled' | 'unavailable'
  previewId?: string
  expiresAt?: string
  items: ProjectFolderSelectionItem[]
  confirmationRequired: boolean
  errorCode?: string
}

export interface FindMnemoLifecycleBridge {
  snapshot(): Promise<LifecycleState>
  startCompanion(): Promise<LifecycleCommandResult>
  stopCompanion(): Promise<LifecycleCommandResult>
  restartCompanion(): Promise<LifecycleCommandResult>
  acceptDisclosure(startAtLogin: boolean): Promise<LifecycleCommandResult>
  setStartAtLogin(enabled: boolean): Promise<LifecycleCommandResult>
  runDiagnostics(): Promise<LifecycleDiagnosticReport>
  previewSupportBundle(): Promise<SupportBundlePreview>
  chooseSupportDestination(): Promise<string | undefined>
  saveSupportBundle(previewId: string, destinationToken: string): Promise<SupportSaveResult>
  checkForUpdates(): Promise<LifecycleState>
  downloadUpdate(): Promise<LifecycleState>
  cancelUpdateDownload(): Promise<LifecycleState>
  activateUpdate(): Promise<LifecycleState>
  inspectExistingState(): Promise<AdoptionSnapshot>
  adoptExistingState(): Promise<AdoptionSnapshot>
  prepareUninstall(choice: UninstallChoice, secondConfirmed: boolean): Promise<UninstallPreview>
  launchUninstaller(): Promise<{ ok: boolean; errorCode?: string }>
  pairingSnapshot(): Promise<CompanionPairingSnapshot>
  refreshPairingCode(): Promise<CompanionPairingSnapshot>
  chooseProjectFolders(): Promise<ProjectFolderSelectionPreview>
  commitProjectFolders(previewId: string, warningsConfirmed: boolean): Promise<{ committed: boolean; folderIds: string[]; errorCode?: string }>
  openTrustedTarget(target: TrustedTarget): Promise<void>
  subscribe(listener: (state: LifecycleState) => void): () => void
}

export function isTrustedTarget(value: unknown): value is TrustedTarget {
  return typeof value === 'string' && (TRUSTED_TARGETS as readonly string[]).includes(value)
}
