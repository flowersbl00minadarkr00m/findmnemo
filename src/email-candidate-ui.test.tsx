import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GmailCandidateDto } from '../shared/companion-contract'
import { EmailPanel } from './components/EmailPanel'

const candidate: GmailCandidateDto = {
  accountId: 'user@example.com',
  threadId: 'thread-1',
  latestMessageId: 'message-1',
  sender: 'Person <person@example.com>',
  subject: 'A response is needed',
  receivedAt: '2026-07-11T08:00:00.000Z',
  snippet: 'Could you confirm the next step?',
  reasonCodes: ['LATEST_FROM_OTHER', 'NO_LATER_SELF_REPLY', 'NOT_AUTOMATED'],
  state: 'candidate',
  gmailUrl: 'https://mail.google.com/mail/u/user%40example.com/#inbox/thread-1',
  recordVersion: 2,
}

describe('operational Gmail candidate triage', () => {
  it('explains every candidate and exposes keyboard-native decisions plus a safe Gmail link', () => {
    const onDecision = vi.fn()
    render(<EmailPanel candidates={[candidate]} sourceStatus={{ state: 'complete', lastAttemptAt: candidate.receivedAt, lastSuccessAt: candidate.receivedAt, coverageStart: '2026-06-11T08:00:00.000Z', coverageEnd: candidate.receivedAt }} onRefresh={() => undefined} onDecision={onDecision} loading={false} />)

    expect(screen.getByRole('heading', { name: candidate.subject })).toBeVisible()
    expect(screen.getByText('The latest meaningful message is from someone else.')).toBeVisible()
    const link = screen.getByRole('link', { name: 'Open in Gmail' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    const defer = screen.getByRole('button', { name: 'Defer' })
    defer.focus()
    expect(defer).toHaveFocus()
    fireEvent.click(defer)
    expect(onDecision).toHaveBeenCalledWith(candidate, 'defer')
  })

  it('keeps prior data visible while partial, stale, or failed state is stated in text', () => {
    render(<EmailPanel candidates={[candidate]} check={{ id: 'run-1', state: 'partial', startedAt: candidate.receivedAt, finishedAt: candidate.receivedAt, coverageStart: '2026-06-11T08:00:00.000Z', coverageEnd: candidate.receivedAt, checkedThreads: 3, candidateThreads: 1, excludedThreads: 1, failedThreadIds: ['thread-2'] }} sourceStatus={{ state: 'stale' }} error="SOURCE_CHECK_FAILED" onRefresh={() => undefined} loading={false} />)

    expect(screen.getByText(/Partial coverage:/)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Prior candidate data remains visible')
    expect(screen.getByRole('heading', { name: candidate.subject })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry failed check' })).toBeVisible()
  })

  it('offers Gmail reconnection instead of retrying a check after token revocation', () => {
    const onConnect = vi.fn()
    render(<EmailPanel candidates={[]} sourceStatus={{ state: 'failed', connected: false, configured: true, errorCode: 'GMAIL_TOKEN_REVOKED' }} error="GMAIL_TOKEN_REVOKED" onRefresh={() => undefined} onConnect={onConnect} loading={false} />)

    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Retry failed check' })).not.toBeInTheDocument()
    expect(screen.getByText(/Google consent opens in your default browser/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }))
    expect(onConnect).toHaveBeenCalledOnce()
  })

  it('keeps core work available and disables Gmail connection when the secure store is unavailable', () => {
    const onConnect = vi.fn()
    render(<EmailPanel candidates={[]} sourceStatus={{ state: 'unavailable', connected: false, configured: false, credentialCapability: { backend: 'linux-secret-service', state: 'locked', code: 'CREDENTIAL_STORE_UNAVAILABLE', guidance: 'Unlock the local credential store, then restart FindMnemo.' } }} onRefresh={() => undefined} onConnect={onConnect} loading={false} />)

    expect(screen.getByRole('button', { name: 'Credential store unavailable' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('CREDENTIAL_STORE_UNAVAILABLE')
    expect(screen.getByRole('alert')).toHaveTextContent('tickets and other local sources are still available')
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('offers editable create and searchable link flows while preserving a failed confirmation', async () => {
    const confirmed = { ...candidate, state: 'confirmed-untracked' as const }
    const tickets = [{
      id: 'ticket-existing', title: 'Existing customer reply', description: 'Coordinate the requested answer', source: 'Codex' as const,
      status: 'todo' as const, workNotes: [], decisionLog: [], createdAt: candidate.receivedAt, updatedAt: candidate.receivedAt,
      origin: 'local-bridge' as const, artifacts: [],
    }]
    const onAssociate = vi.fn().mockRejectedValue(new Error('Network unavailable. Confirmation remains untracked.'))
    render(<EmailPanel candidates={[confirmed]} tickets={tickets} sourceStatus={{ state: 'complete' }} onRefresh={() => undefined} onAssociate={onAssociate} loading={false} />)

    const chooserTrigger = screen.getByRole('button', { name: 'Create or link ticket' })
    chooserTrigger.focus()
    fireEvent.click(chooserTrigger)
    const dialog = screen.getByRole('dialog', { name: 'Create or link a ticket' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('fixed')
    const title = screen.getByRole('textbox', { name: 'Ticket title' })
    expect(title).toHaveValue(candidate.subject)
    fireEvent.change(title, { target: { value: 'Edited ticket title' } })
    expect(title).toHaveValue('Edited ticket title')

    fireEvent.click(screen.getByRole('radio', { name: 'Link existing' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search existing tickets' }), { target: { value: 'customer' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Existing customer reply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Link selected ticket' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Confirmation remains untracked'))
    expect(screen.getByRole('heading', { name: 'Create or link a ticket' })).toBeVisible()
    expect(onAssociate).toHaveBeenCalledWith(confirmed, { mode: 'link', ticketId: 'ticket-existing' }, expect.any(String))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(chooserTrigger).toHaveFocus())
  })
})
