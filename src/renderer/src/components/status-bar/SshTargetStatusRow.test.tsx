import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../store', () => {
  const state = {
    recordFeatureInteraction: vi.fn(),
    setRemoteWorkspaceSyncStatus: vi.fn()
  }
  const useAppStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state }
  )
  return { useAppStore }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import { SshTargetStatusRow } from './SshTargetStatusRow'

describe('SshTargetStatusRow', () => {
  it('offers a read-only refresh for workspace conflicts', () => {
    const markup = renderToStaticMarkup(
      <SshTargetStatusRow
        targetId="wheeljack"
        label="Wheeljack"
        status="connected"
        syncStatus={{
          phase: 'conflict',
          revision: 7,
          message: 'Workspace changed on another device'
        }}
      />
    )

    expect(markup).toContain('Workspace sync conflict')
    expect(markup).toContain('Refresh')
    expect(markup).not.toContain('Disconnect')
  })

  it('keeps the normal disconnect action when workspace sync is healthy', () => {
    const markup = renderToStaticMarkup(
      <SshTargetStatusRow
        targetId="wheeljack"
        label="Wheeljack"
        status="connected"
        syncStatus={{ phase: 'synced', revision: 7 }}
      />
    )

    expect(markup).toContain('Disconnect')
    expect(markup).not.toContain('Refresh')
  })
})
