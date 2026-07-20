import type { Project, ProjectHostSetup, Repo } from '../../../shared/types'
import {
  getProjectIdentityKey,
  type ProjectHostSetupProjection
} from '../../../shared/project-host-setup-projection'

export type NormalizedProjectHostSetupProjection = ProjectHostSetupProjection & {
  changed: boolean
}

export function normalizeHydratedProjectHostSetupProjection(
  repos: readonly Repo[],
  projects: readonly Project[],
  setups: readonly ProjectHostSetup[]
): NormalizedProjectHostSetupProjection {
  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  const projectIdByHydratedProjectId = new Map<string, string>()
  let changed = false
  const normalizedSetups = setups.map((setup) => {
    const repo = repoById.get(setup.repoId) ?? repoById.get(setup.id)
    if (!repo) {
      return setup
    }
    const projectId = getProjectIdentityKey(repo)
    if (projectId === setup.projectId || projectId === `repo:${repo.id}`) {
      return setup
    }
    changed = true
    projectIdByHydratedProjectId.set(setup.projectId, projectId)
    return { ...setup, projectId }
  })
  const normalizedProjects = projects.map((project) => {
    const projectId = projectIdByHydratedProjectId.get(project.id)
    if (!projectId || projectId === project.id) {
      return project
    }
    // Why: the server's project metadata is authoritative even when its
    // path-scoped id normalizes to a repo-derived identity already known by the
    // client. Keep the record under the normalized id so the selector overlay
    // preserves the server's exact name instead of falling back to whichever
    // host repo happened to be projected first.
    changed = true
    return { ...project, id: projectId }
  })
  return { projects: normalizedProjects, setups: normalizedSetups, changed }
}
