import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DetailHeader } from './detail-header'

describe('DetailHeader', () => {
  it('groups the follow slot with the action, after the @owner byline', () => {
    render(
      <DetailHeader
        kind="kit"
        title="DM Kit"
        owner="thiago"
        action={<button type="button">Add</button>}
        follow={<button type="button">Follow</button>}
      />,
    )
    const handle = screen.getByRole('link', { name: /@thiago/ })
    const action = screen.getByRole('button', { name: 'Add' })
    const follow = screen.getByRole('button', { name: 'Follow' })
    // Follow no longer lives in the byline — it pairs with the primary action
    // below the identity block, and comes right after it.
    expect(follow.parentElement?.contains(handle)).toBe(false)
    expect(follow.parentElement).toBe(action.parentElement)
    expect(handle.compareDocumentPosition(follow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(action.compareDocumentPosition(follow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no follow control when none is passed', () => {
    render(<DetailHeader kind="skill" title="Foo" owner="thiago" />)
    expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument()
  })
})
