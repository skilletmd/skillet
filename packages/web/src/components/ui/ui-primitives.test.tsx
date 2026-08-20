import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Avatar } from './avatar'
import { Badge } from './badge'
import { Button } from './button'
import { Input } from './input'
import { SegmentedControl } from './segmented-control'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('Button', () => {
  it('renders a button with the variant styling', () => {
    render(<Button variant="secondary">Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    // Secondary is the bordered surface variant.
    expect(btn.className).toContain('border-(--line)')
    expect(btn.className).toContain('bg-(--surface)')
  })

  it('renders a link when href is set', () => {
    render(
      <Button href="/x" variant="primary">
        Go
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link).toHaveAttribute('href', '/x')
    // Primary is the solid --ink fill.
    expect(link.className).toContain('bg-(--ink)')
  })

  it('icon variant is the standalone square button (not the filled primary)', () => {
    render(
      <Button variant="icon" aria-label="x">
        ·
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'x' })
    expect(btn.className).toContain('h-[30px]')
    expect(btn.className).not.toContain('bg-(--ink)')
  })

  it('forwards props like disabled/onClick', () => {
    render(
      <Button disabled type="submit">
        Send
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.type).toBe('submit')
  })
})

describe('Avatar', () => {
  it('renders an illustrated default face for a person with no photo', () => {
    render(<Avatar name="Grace Liu" />)
    const img = screen.getByAltText('Grace Liu') as HTMLImageElement
    expect(img.getAttribute('src')).toContain('/avatars/default/')
  })

  it('shows two-letter initials for a team with no logo', () => {
    render(<Avatar name="Grace Liu" kind="team" />)
    expect(screen.getByText('GR')).toBeInTheDocument()
  })

  it('renders the image with the name as alt when src is set', () => {
    render(<Avatar src="https://x/a.png" name="Grace Liu" />)
    expect(screen.getByAltText('Grace Liu')).toHaveAttribute('src', 'https://x/a.png')
  })
})

describe('Badge', () => {
  it('renders children with the danger variant token color class', () => {
    render(<Badge variant="danger">private</Badge>)
    const el = screen.getByText('private')
    expect(el.className).toContain('text-(--danger)')
  })
})

describe('Input', () => {
  it('renders an input and forwards props', () => {
    render(<Input placeholder="Name" defaultValue="hi" />)
    const input = screen.getByPlaceholderText('Name') as HTMLInputElement
    expect(input.value).toBe('hi')
  })
})

describe('SegmentedControl', () => {
  it('marks the active option and fires onChange', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        ariaLabel="Theme"
        value="light"
        onChange={onChange}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />,
    )
    const light = screen.getByRole('radio', { name: 'Light' })
    const dark = screen.getByRole('radio', { name: 'Dark' })
    expect(light).toHaveAttribute('aria-checked', 'true')
    expect(dark).toHaveAttribute('aria-checked', 'false')
    dark.click()
    expect(onChange).toHaveBeenCalledWith('dark')
  })
})
