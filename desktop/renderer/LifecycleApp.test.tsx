import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FindMnemoLifecycleBridge, LifecycleState } from '../../shared/lifecycle-contract'
import { LifecycleApp } from './LifecycleApp'

const firstRun: LifecycleState = {
  phase: 'first-run', appVersion: '0.1.0', protocolVersion: '1.0.0', instanceId: 'test',
  companion: { state: 'stopped' }, startup: { enabled: false }, disclosure: { version: '1.0.0' }, update: { state: 'idle' }, recoveryActions: ['retry'],
}

describe('LifecycleApp first run', () => {
  it('does not opt into startup and starts only after explicit disclosure acceptance', async () => {
    const accepted = { ...firstRun, phase: 'healthy' as const, disclosure: { version: '1.0.0', acceptedAt: 'now' }, companion: { state: 'healthy' as const, host: '127.0.0.1' as const, port: 3210 } }
    const acceptDisclosure = vi.fn().mockResolvedValue({ ok: true, state: accepted })
    window.findMnemoLifecycle = {
      snapshot: vi.fn().mockResolvedValue(firstRun), subscribe: vi.fn().mockReturnValue(() => undefined),
      acceptDisclosure, setStartAtLogin: vi.fn(), startCompanion: vi.fn(), stopCompanion: vi.fn(), restartCompanion: vi.fn(), openTrustedTarget: vi.fn(),
      runDiagnostics: vi.fn(), previewSupportBundle: vi.fn(), chooseSupportDestination: vi.fn(), saveSupportBundle: vi.fn(),
      checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), cancelUpdateDownload: vi.fn(), activateUpdate: vi.fn(),
      inspectExistingState: vi.fn().mockResolvedValue({ state: 'fresh', databasePresent: false, credentialPresent: false, lifecycleSettingsPresent: true, listener: 'none', backupRequired: false, retainedLocation: '%LOCALAPPDATA%\\FindMnemo' }), adoptExistingState: vi.fn(),
      prepareUninstall: vi.fn(), launchUninstaller: vi.fn(),
      pairingSnapshot: vi.fn().mockResolvedValue({ state: 'unavailable', guidance: 'Start FindMnemo.' }), refreshPairingCode: vi.fn(),
      chooseProjectFolders: vi.fn(), commitProjectFolders: vi.fn(),
    } satisfies FindMnemoLifecycleBridge
    render(<LifecycleApp />)
    expect(await screen.findByRole('heading', { name: /your operational data stays/i })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /start findmnemo/i })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /accept and start/i }))
    expect(acceptDisclosure).toHaveBeenCalledWith(false)
    expect(await screen.findByText('healthy')).toBeVisible()
  })
})
