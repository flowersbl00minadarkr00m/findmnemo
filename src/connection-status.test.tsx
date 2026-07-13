import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { COMPANION_CONNECTION_STATES } from '../shared/companion-contract'
import { ConnectionStatus } from './components/ConnectionStatus'

describe('connection recovery status', () => {
  it('renders every supported state with text and keeps ambiguous failures non-specific', () => {
    for (const state of COMPANION_CONNECTION_STATES) {
      const { unmount } = render(<ConnectionStatus state={state} />)
      expect(screen.getByRole('status')).toHaveTextContent(/.+/)
      unmount()
    }
    render(<ConnectionStatus state="error" />)
    expect(screen.getByRole('status')).toHaveTextContent('cause is not yet verified')
    expect(screen.getByRole('status')).not.toHaveTextContent(/firewall blocked|VPN blocked|enterprise policy blocked/i)
  })
})
