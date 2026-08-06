import { describe, expect, it } from 'vitest'
import { getSidebarSectionTitle } from './sidebar-section-title'

describe('getSidebarSectionTitle', () => {
  it('uses Repo for canonical repository grouping', () => {
    expect(getSidebarSectionTitle('repository')).toBe('Repo')
  })

  it('keeps the other grouping headings stable', () => {
    expect(getSidebarSectionTitle('repo')).toBe('Projects')
    expect(getSidebarSectionTitle('none')).toBe('Workspaces')
  })
})
