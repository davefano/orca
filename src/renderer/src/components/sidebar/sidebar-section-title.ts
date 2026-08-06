import type { WorktreeGroupBy } from './worktree-list-groups'

export function getSidebarSectionTitle(groupBy: WorktreeGroupBy): string {
  if (groupBy === 'repo') {
    return 'Projects'
  }
  if (groupBy === 'repository') {
    return 'Repo'
  }
  return 'Workspaces'
}
