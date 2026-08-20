import { describe, expect, it } from 'vitest'
import { ADMIN_NAV_ITEMS, isAdminNavItemActive } from './admin-nav-items'

const item = (href: string) => ADMIN_NAV_ITEMS.find((i) => i.href === href)!

describe('isAdminNavItemActive', () => {
  it('lights only Overview (exact) on the admin root', () => {
    expect(isAdminNavItemActive(item('/admin'), '/admin')).toBe(true)
    expect(isAdminNavItemActive(item('/admin/mirror'), '/admin')).toBe(false)
  })

  it('does not light the exact Overview on a child route', () => {
    expect(isAdminNavItemActive(item('/admin'), '/admin/mirror')).toBe(false)
  })

  it('lights a section on its own route and its nested routes', () => {
    expect(isAdminNavItemActive(item('/admin/mirror'), '/admin/mirror')).toBe(true)
    expect(isAdminNavItemActive(item('/admin/blog'), '/admin/blog/new')).toBe(true)
    expect(isAdminNavItemActive(item('/admin/blog'), '/admin/blog/some-slug/edit')).toBe(true)
  })

  it('does not treat a sibling prefix as active', () => {
    // /admin/reports must not light for /admin/reports-archive (no slash boundary)
    expect(isAdminNavItemActive(item('/admin/reports'), '/admin/reports-archive')).toBe(false)
  })

  it('exposes a plain array (importable without a client boundary)', () => {
    expect(Array.isArray(ADMIN_NAV_ITEMS)).toBe(true)
    expect(ADMIN_NAV_ITEMS.map((i) => i.href)).toEqual([
      '/admin',
      '/admin/log',
      '/admin/mirror',
      '/admin/reports',
      '/admin/moderation',
      '/admin/featured',
      '/admin/blog',
    ])
  })
})
