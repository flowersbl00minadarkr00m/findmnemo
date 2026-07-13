import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('browser test harness', () => {
  it('renders with React Testing Library and jsdom matchers', () => {
    render(<p>FindMnemo browser harness</p>)

    expect(screen.getByText('FindMnemo browser harness')).toBeVisible()
  })
})
