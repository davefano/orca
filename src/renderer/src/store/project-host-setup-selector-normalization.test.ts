import { describe, expect, it } from 'vitest'
import type { Project, ProjectHostSetup, Repo } from '../../../shared/types'
import { getProjectHostSetupProjectionFromState } from './project-host-setup-selector'
import { normalizeHydratedProjectHostSetupProjection } from './project-host-setup-selector-normalization'

describe('normalizeHydratedProjectHostSetupProjection', () => {
  it('keeps authoritative server metadata when its project id normalizes to a derived identity', () => {
    const repo: Repo = {
      id: 'remote-teal',
      path: '/Users/dave/workspaces/teal',
      displayName: 'Teal @ Wheeljack',
      badgeColor: '#14b8a6',
      addedAt: 1,
      executionHostId: 'runtime:ultra-magnus',
      upstream: { owner: 'Teal-HQ', repo: 'teal' }
    }
    const serverProject: Project = {
      id: 'server-project-teal',
      displayName: 'Teal',
      badgeColor: '#14b8a6',
      sourceRepoIds: [repo.id],
      createdAt: 1,
      updatedAt: 2
    }
    const serverSetup: ProjectHostSetup = {
      id: 'server-setup-teal',
      projectId: serverProject.id,
      hostId: 'runtime:ultra-magnus',
      repoId: repo.id,
      path: repo.path,
      displayName: repo.displayName,
      setupState: 'ready',
      setupMethod: 'imported-existing-folder',
      createdAt: 1,
      updatedAt: 2
    }

    const normalized = normalizeHydratedProjectHostSetupProjection(
      [repo],
      [serverProject],
      [serverSetup]
    )

    expect(normalized.projects).toEqual([
      expect.objectContaining({
        id: 'github:teal-hq/teal',
        displayName: 'Teal',
        updatedAt: 2
      })
    ])
    expect(normalized.setups).toEqual([
      expect.objectContaining({
        id: serverSetup.id,
        projectId: 'github:teal-hq/teal'
      })
    ])
  })

  it('surfaces the exact server project name after selector reconciliation', () => {
    const repo: Repo = {
      id: 'remote-teal',
      path: '/Users/dave/workspaces/teal',
      displayName: 'Teal @ Wheeljack',
      badgeColor: '#14b8a6',
      addedAt: 1,
      executionHostId: 'runtime:ultra-magnus',
      upstream: { owner: 'Teal-HQ', repo: 'teal' }
    }
    const project: Project = {
      id: 'server-project-teal',
      displayName: 'Teal',
      badgeColor: '#14b8a6',
      sourceRepoIds: [repo.id],
      createdAt: 1,
      updatedAt: 2
    }
    const setup: ProjectHostSetup = {
      id: 'server-setup-teal',
      projectId: project.id,
      hostId: 'runtime:ultra-magnus',
      repoId: repo.id,
      path: repo.path,
      displayName: repo.displayName,
      setupState: 'ready',
      setupMethod: 'imported-existing-folder',
      createdAt: 1,
      updatedAt: 2
    }

    const projection = getProjectHostSetupProjectionFromState({
      repos: [repo],
      projects: [project],
      projectHostSetups: [setup]
    })

    expect(projection.projects).toEqual([
      expect.objectContaining({ id: 'github:teal-hq/teal', displayName: 'Teal' })
    ])
    expect(projection.setups[0]).toEqual(
      expect.objectContaining({ projectId: 'github:teal-hq/teal' })
    )
  })
})
