import type { TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/types'
import { mayDestroyWithoutOwnerEvidence } from '../../../../shared/pty-listed-session'
import type { DaemonSession } from './resource-usage-merge-types'

export type ResourceSessionBindingInputs = {
  tabsByWorktree: Record<string, TerminalTab[]>
  ptyIdsByTabId: Record<string, string[]>
  terminalLayoutsByTabId?: Record<string, TerminalLayoutSnapshot>
  /**
   * Sessions restore knows exist on an SSH host but has not reattached yet, keyed by tab. Restore
   * skips reattach while the relay is not connected (`terminals.ts` reconnectPersistedTerminals),
   * so these are live remote sessions no other binding source can see. Omitting them is what let
   * Resource Manager classify live agent sessions as orphans and force-kill them (#8459).
   */
  deferredSshSessionIdsByTabId?: Record<string, string>
  workspaceSessionReady: boolean
}

export type ResourceSessionBindingOrigin = {
  tabId: string
  worktreeId: string | null
  leafId: string | null
  source: 'live' | 'tab-wake' | 'layout-wake'
}

export type ResourceSessionBindingIndex = {
  ptyIdToTabId: Map<string, string>
  tabIdToWorktreeId: Map<string, string>
  boundPtyIds: Set<string>
  originByPtyId: Map<string, ResourceSessionBindingOrigin>
}

function addBinding(
  ptyIdToTabId: Map<string, string>,
  originByPtyId: Map<string, ResourceSessionBindingOrigin>,
  tabIdToWorktreeId: Map<string, string>,
  tabId: string,
  ptyId: string | null | undefined,
  source: ResourceSessionBindingOrigin['source'],
  leafId: string | null = null
): void {
  if (!ptyId || ptyIdToTabId.has(ptyId)) {
    return
  }
  ptyIdToTabId.set(ptyId, tabId)
  originByPtyId.set(ptyId, {
    tabId,
    worktreeId: tabIdToWorktreeId.get(tabId) ?? null,
    leafId,
    source
  })
}

export function buildResourceSessionBindingIndex(
  inputs: ResourceSessionBindingInputs
): ResourceSessionBindingIndex {
  const ptyIdToTabId = new Map<string, string>()
  const tabIdToWorktreeId = new Map<string, string>()
  const originByPtyId = new Map<string, ResourceSessionBindingOrigin>()

  for (const [worktreeId, tabs] of Object.entries(inputs.tabsByWorktree)) {
    for (const tab of tabs) {
      tabIdToWorktreeId.set(tab.id, worktreeId)
    }
  }

  for (const [tabId, ptyIds] of Object.entries(inputs.ptyIdsByTabId)) {
    for (const ptyId of ptyIds) {
      addBinding(ptyIdToTabId, originByPtyId, tabIdToWorktreeId, tabId, ptyId, 'live')
    }
  }

  // Why: startup-deferred reattach intentionally leaves inactive tabs out of
  // ptyIdsByTabId, but their daemon sessions are still owned by tab/layout
  // wake hints. Resource Manager should not classify those as orphans.
  for (const tabs of Object.values(inputs.tabsByWorktree)) {
    for (const tab of tabs) {
      addBinding(ptyIdToTabId, originByPtyId, tabIdToWorktreeId, tab.id, tab.ptyId, 'tab-wake')
    }
  }

  for (const [tabId, layout] of Object.entries(inputs.terminalLayoutsByTabId ?? {})) {
    if (!tabIdToWorktreeId.has(tabId)) {
      continue
    }
    for (const [leafId, ptyId] of Object.entries(layout.ptyIdsByLeafId ?? {})) {
      addBinding(
        ptyIdToTabId,
        originByPtyId,
        tabIdToWorktreeId,
        tabId,
        ptyId,
        'layout-wake',
        leafId
      )
    }
  }

  // Why last: a deferred reattach is the one case where the session is known live but has no
  // live-PTY, tab, or layout binding to find it by.
  for (const [tabId, sessionId] of Object.entries(inputs.deferredSshSessionIdsByTabId ?? {})) {
    if (!tabIdToWorktreeId.has(tabId)) {
      continue
    }
    addBinding(ptyIdToTabId, originByPtyId, tabIdToWorktreeId, tabId, sessionId, 'tab-wake')
  }

  return {
    ptyIdToTabId,
    tabIdToWorktreeId,
    boundPtyIds: inputs.workspaceSessionReady ? new Set(ptyIdToTabId.keys()) : new Set(),
    originByPtyId
  }
}

/**
 * The sessions Resource Manager may offer for bulk destruction: unbound in this renderer *and*
 * unclaimed by any agent. Single source of truth so the advertised count and the set actually
 * killed cannot diverge — that divergence would be live agent sessions (#8459).
 */
export function selectUnboundDaemonSessions(
  sessions: readonly DaemonSession[],
  inputs: ResourceSessionBindingInputs
): DaemonSession[] {
  if (!inputs.workspaceSessionReady) {
    return []
  }
  const { boundPtyIds } = buildResourceSessionBindingIndex(inputs)
  // Why the ownership check: this renderer's binding map is empty during restore, so it cannot
  // decide alone. Only proven absence of an owner qualifies — 'unknown' protects.
  return sessions.filter(
    (session) => !boundPtyIds.has(session.id) && mayDestroyWithoutOwnerEvidence(session)
  )
}

export function countUnboundDaemonSessions(
  sessions: readonly DaemonSession[],
  inputs: ResourceSessionBindingInputs
): number {
  return selectUnboundDaemonSessions(sessions, inputs).length
}
