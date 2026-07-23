// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PtyOwnerSnapshot, SshPtyHealthResult } from '../../../../shared/ssh-types'
import { SshPtyHealthPanel } from './SshPtyHealthPanel'

function owner(overrides: Partial<PtyOwnerSnapshot> = {}): PtyOwnerSnapshot {
  return {
    ownerId: '98022:Sat Jul 18 09:22:04 2026',
    pid: 98022,
    processStartedAt: 'Sat Jul 18 09:22:04 2026',
    command: '/opt/node relay.js --detached',
    category: 'orca-relay',
    isCurrentRelay: false,
    allocationCount: 4,
    attachedPtyCount: 2,
    leakedPtyCount: 2,
    activeAgentCount: 0,
    workloadCount: 0,
    idleShellCount: 2,
    disposition: 'safe',
    reason: 'Legacy relay contains only idle shells or leaked PTYs',
    ...overrides
  }
}

function result(owners: PtyOwnerSnapshot[]): SshPtyHealthResult {
  return {
    targetId: 'wheeljack',
    label: 'Wheeljack',
    status: 'connected',
    health: {
      platform: 'darwin',
      systemCapacity: 511,
      systemAllocated: 511,
      systemAvailable: 0,
      relayOwned: 1,
      relayCapacity: 50,
      pressure: 'critical',
      owners
    }
  }
}

describe('SSH PTY health panel', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderPanel(
    results: SshPtyHealthResult[],
    onPrune: (targetId: string, ownerId: string) => Promise<void> = vi.fn()
  ): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <SshPtyHealthPanel
          results={results}
          loading={false}
          onRefresh={() => {}}
          onPrune={onPrune}
        />
      )
    })
  }

  it('shows exact allocation and leaked-owner diagnostics', () => {
    renderPanel([
      result([
        owner({
          pid: 20873,
          allocationCount: 480,
          attachedPtyCount: 4,
          leakedPtyCount: 476,
          activeAgentCount: 4,
          disposition: 'recover-first'
        })
      ])
    ])

    expect(container.textContent).toContain('511/511 PTYs')
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Show Wheeljack PTY owners"]')
        ?.click()
    })
    expect(container.textContent).toContain('PID 20873')
    expect(container.textContent).toContain('480 allocated')
    expect(container.textContent).toContain('476 leaked')
    expect(container.textContent).toContain('Recover first')
  })

  it('offers pruning only for safe legacy relays and confirms before calling', async () => {
    const onPrune = vi.fn(async () => {})
    renderPanel(
      [
        result([
          owner(),
          owner({
            ownerId: '20873:Tue Jul 14 23:35:22 2026',
            pid: 20873,
            disposition: 'recover-first',
            activeAgentCount: 4
          })
        ])
      ],
      onPrune
    )

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Show Wheeljack PTY owners"]')
        ?.click()
    })
    expect(container.querySelectorAll('button[aria-label^="Prune safe relay PID"]')).toHaveLength(1)

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Prune safe relay PID 98022"]')
        ?.click()
    })
    expect(document.body.textContent).toContain('Prune idle PTYs on Wheeljack?')

    await act(async () => {
      const buttons = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      buttons.find((button) => button.textContent === 'Prune 4 PTYs')?.click()
      await Promise.resolve()
    })

    expect(onPrune).toHaveBeenCalledWith('wheeljack', '98022:Sat Jul 18 09:22:04 2026')
  })
})
