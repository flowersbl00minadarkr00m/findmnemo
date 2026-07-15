import { describe, expect, it, vi } from 'vitest'
import { OnboardingService } from './onboarding-service.js'
import type { ReconciliationEngine } from '../reconciliation/engine.js'
import type { ProjectFolderService } from './project-folder-service.js'
import type { GmailServices } from '../gmail/gmail-services.js'

describe('OnboardingService', () => {
  it('projects safe optional-source choices and refreshes only enabled selections', async () => {
    const start = vi.fn(() => ({ id: 'run-1', state: 'running', requestedSourceIds: ['findmnemo-tickets'], sources: [], items: [] }))
    const reconciliation = {
      history: vi.fn(() => []),
      sources: vi.fn(() => [
        { id: 'findmnemo-tickets', label: 'FindMnemo tickets', adapterVersion: '1', enabled: true, policy: 'review' },
        { id: 'project-folders', label: 'Project folders', adapterVersion: '1', enabled: true, policy: 'review' },
        { id: 'agent-ledger', label: 'Agent ledger', adapterVersion: '1', enabled: false, policy: 'review' },
      ]),
      start,
    } as unknown as ReconciliationEngine
    const folders = { list: vi.fn(() => [{ id: 'opaque', label: 'App', state: 'active' }]) } as unknown as ProjectFolderService
    const gmail = { configured: true, connected: vi.fn(async () => false) } as unknown as GmailServices
    const service = new OnboardingService(reconciliation, folders, gmail)

    const snapshot = await service.snapshot()
    expect(snapshot.needsSetup).toBe(true)
    expect(snapshot.sources.find((source) => source.id === 'project-folders')).toMatchObject({ state: 'connected', reconciliationSourceId: 'project-folders' })
    expect(JSON.stringify(snapshot)).not.toContain('canonicalPath')

    service.firstRefresh(['project-folders', 'agent-ledger'])
    expect(start).toHaveBeenCalledWith(['findmnemo-tickets', 'project-folders'], 'onboarding')
  })
})
