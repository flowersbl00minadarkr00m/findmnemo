import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataPrivacyView } from './components/DataPrivacyView'
import { LegacyMigrationPanel } from './components/LegacyMigrationPanel'
import App from './App'
import type { OperationalRepository } from './lib/operational-repository'

function repository(): OperationalRepository {
  return {
    listTickets: vi.fn(async () => []), createTicket: vi.fn(), updateTicketStatus: vi.fn(), addWorkNote: vi.fn(), deleteTicket: vi.fn(),
    getDataExportPreview: vi.fn(async () => ({ schema: 'findmnemo.data-export-preview.v1', workspace: 'operational', generatedAt: '2026-07-13T12:00:00.000Z', exclusions: ['Credentials are never exported.'], categories: [
      { id: 'tickets-work', label: 'Tickets and work', description: 'Operational tickets.', state: 'available', recordCount: 2, freshnessAt: '2026-07-13T12:00:00.000Z', coverage: 'Companion-owned.', selectedByDefault: true, exportable: true, importable: true, artifactProfile: 'findmnemo.tickets-work.v1', privacyNote: 'Safe fields only.' },
      { id: 'email-metadata', label: 'Email metadata', description: 'Minimized Gmail metadata.', state: 'partial', recordCount: 1, freshnessAt: null, coverage: 'Partial.', selectedByDefault: false, exportable: true, importable: false, artifactProfile: 'findmnemo.email-metadata.v1', privacyNote: 'Opt in.' },
    ] })),
    downloadDataBundle: vi.fn(async () => undefined),
  } as OperationalRepository
}

describe('DataPrivacyView', () => {
  afterEach(() => window.localStorage.clear())
  it('uses safe defaults and downloads selected companion categories', async () => {
    const repo = repository()
    const onNavigate = vi.fn()
    render(<DataPrivacyView repository={repo} onNavigate={onNavigate} />)
    expect(await screen.findByText('Tickets and work')).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Download selected data' }))
    await waitFor(() => expect(repo.downloadDataBundle).toHaveBeenCalledWith(['tickets-work']))
    expect(await screen.findByText('Download prepared')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Gmail controls' }))
    expect(onNavigate).toHaveBeenCalledWith('emails')
  })

  it('keeps Sample read-only and makes no operational call', () => {
    const repo = repository()
    render(<DataPrivacyView repository={repo} sample />)
    expect(screen.getByText(/fictional workspace cannot access/i)).toBeInTheDocument()
    expect(repo.getDataExportPreview).not.toHaveBeenCalled()
  })

  it('previews a bundle and commits only explicitly selected safe categories', async () => {
    const repo = {
      ...repository(),
      previewDataImport: vi.fn(async () => ({ schema: 'findmnemo.data-import-preview.v1' as const, planId: 'plan-1', expiresAt: '2026-07-13T12:10:00.000Z', detectedProfile: 'findmnemo.data-bundle.v1', safeToCommit: true, errors: [], categories: [
        { id: 'tickets-work' as const, importable: true, counts: { add: 1, duplicate: 0, conflict: 0, excluded: 0, unsupported: 0, failed: 0 }, conflictPolicy: 'preserve-current' as const, note: 'New ticket.' },
        { id: 'model-usage' as const, importable: false, counts: { add: 0, duplicate: 0, conflict: 0, excluded: 0, unsupported: 1, failed: 0 }, conflictPolicy: 'not-applicable' as const, note: 'Export-only.' },
      ] })),
      commitDataImport: vi.fn(async () => ({ schema: 'findmnemo.data-portability-receipt.v1' as const, operation: 'import' as const, outcome: 'complete' as const, completedAt: '2026-07-13T12:01:00.000Z', artifactName: null, categories: [{ id: 'tickets-work' as const, added: 1, skipped: 0, conflicts: 0, excluded: 0, failed: 0 }], nextAction: 'Reload.' })),
    } as OperationalRepository
    const { container } = render(<DataPrivacyView repository={repo} />)
    const fileInput = container.querySelector<HTMLInputElement>('input[accept*="findmnemo"]')
    expect(fileInput).not.toBeNull()
    fireEvent.change(fileInput!, { target: { files: [new File([JSON.stringify({ profile: 'findmnemo.data-bundle.v1' })], 'portable.findmnemo.json', { type: 'application/json' })] } })
    const preview = await screen.findByRole('region', { name: 'Import preview' })
    expect(within(preview).getByRole('checkbox')).toBeChecked()
    fireEvent.click(within(preview).getByRole('button', { name: 'Confirm selected safe additions' }))
    await waitFor(() => expect(repo.commitDataImport).toHaveBeenCalledWith(expect.objectContaining({ planId: 'plan-1', categoryIds: ['tickets-work'] })))
  })

  it('opens Data & Privacy from the operational shell without waiting on the prior view animation', async () => {
    const repo = repository()
    render(<App operationalRepository={repo} />)
    expect(await screen.findByRole('heading', { name: 'Operations Desk' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Data & Privacy' }))
    expect(await screen.findByRole('heading', { name: 'Download my data' })).toBeVisible()
    expect(repo.getDataExportPreview).toHaveBeenCalled()
  })

  it('hides excluded-only legacy records but preserves actionable migration', async () => {
    window.localStorage.setItem('mnemosync_tickets', JSON.stringify([{ id: 'sample-legacy', title: 'Sample', source: 'Codex', status: 'todo', origin: 'demo' }]))
    const excludedRepo = { ...repository(), previewLegacyMigration: vi.fn(async () => ({ eligible: 0, conflicts: 0, excluded: 1, imported: 0, alreadyImported: 0 })) } as OperationalRepository
    const { rerender } = render(<LegacyMigrationPanel repository={excludedRepo} onImported={vi.fn()} />)
    await waitFor(() => expect(excludedRepo.previewLegacyMigration).toHaveBeenCalled())
    expect(screen.queryByLabelText('Legacy ticket migration')).not.toBeInTheDocument()

    window.localStorage.setItem('mnemosync_tickets', JSON.stringify([{ id: 'valid-legacy', title: 'Valid', description: '', source: 'Codex', status: 'todo', origin: 'browser-ui' }]))
    const actionableRepo = { ...repository(), previewLegacyMigration: vi.fn(async () => ({ eligible: 1, conflicts: 0, excluded: 0, imported: 0, alreadyImported: 0 })) } as OperationalRepository
    rerender(<LegacyMigrationPanel repository={actionableRepo} onImported={vi.fn()} />)
    expect(await screen.findByLabelText('Legacy ticket migration')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import eligible tickets' })).toBeEnabled()
  })
})
