import type { PersistedUIState } from '../../../../shared/types'

export function shouldShowProjectOrderManualDefaultNotice(args: {
  persistedUIReady: boolean
  projectOrderManualDefaultNoticeDismissed: boolean
  groupBy: PersistedUIState['groupBy']
  projectOrderBy: 'manual' | 'recent'
  repoCount: number
}): boolean {
  return (
    args.persistedUIReady &&
    !args.projectOrderManualDefaultNoticeDismissed &&
    args.groupBy === 'repo' &&
    args.projectOrderBy === 'manual' &&
    args.repoCount > 0
  )
}
