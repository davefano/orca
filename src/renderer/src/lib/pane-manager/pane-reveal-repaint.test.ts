import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ManagedPaneInternal } from './pane-manager-types'
import { PaneManager } from './pane-manager'
import { schedulePaneRevealPresent, schedulePaneRevealRepaint } from './pane-reveal-repaint'
import { registerLivePaneManager, unregisterLivePaneManager } from './pane-manager-registry'
import { resetTerminalWebglSuggestion, resetWebglTextureAtlas } from './pane-webgl-renderer'

const { fitRevealedPane } = vi.hoisted(() => ({
  fitRevealedPane: vi.fn((_pane: ManagedPaneInternal, onSettled?: () => void) => onSettled?.())
}))

vi.mock('./pane-reveal-fit', () => ({ fitRevealedPane }))

type FakeWebglAddon = { clearTextureAtlas: ReturnType<typeof vi.fn> }
type FakeRenderService = {
  _isPaused: boolean
  _needsFullRefresh: boolean
  refreshRows: ReturnType<typeof vi.fn>
}
type FakePaneManager = {
  resetWebglTextureAtlases: Mock<() => void>
  refreshAllPanes: Mock<() => void>
}

function createPane(
  options: {
    id?: number
    webglAddon?: FakeWebglAddon | null
    renderService?: FakeRenderService
  } = {}
): ManagedPaneInternal {
  const leafId = '33333333-3333-4333-8333-333333333333' as never
  return {
    id: options.id ?? 1,
    leafId,
    stablePaneId: leafId,
    terminal: {
      cols: 80,
      rows: 24,
      refresh: vi.fn(),
      loadAddon: vi.fn(),
      ...(options.renderService ? { _core: { _renderService: options.renderService } } : {})
    } as never,
    container: {} as never,
    xtermContainer: {} as never,
    linkTooltip: {} as never,
    terminalGpuAcceleration: 'on',
    gpuRenderingEnabled: true,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    hasComplexScriptOutput: false,
    webglAddon: (options.webglAddon ?? null) as never,
    ligaturesAddon: null,
    fitResizeObserver: null,
    pendingObservedFitRafId: null,
    pendingWebglRefreshRafId: null,
    fitAddon: {
      proposeDimensions: vi.fn(() => ({ cols: 80, rows: 23 })),
      fit: vi.fn()
    } as never,
    searchAddon: {} as never,
    serializeAddon: {} as never,
    unicode11Addon: {} as never,
    webLinksAddon: {} as never,
    compositionHandler: null,
    pendingSplitScrollState: null,
    debugLabel: null
  }
}

describe('schedulePaneRevealRepaint', () => {
  let rafQueue: FrameRequestCallback[]
  const registeredManagers: FakePaneManager[] = []

  function registerPaneManager(getPanes: () => Iterable<ManagedPaneInternal>): FakePaneManager {
    const manager: FakePaneManager = {
      resetWebglTextureAtlases: vi.fn(() => {
        for (const pane of getPanes()) {
          resetWebglTextureAtlas(pane)
        }
      }),
      refreshAllPanes: vi.fn(() => {
        for (const pane of getPanes()) {
          pane.terminal.refresh(0, pane.terminal.rows - 1)
        }
      })
    }
    registerLivePaneManager(manager)
    registeredManagers.push(manager)
    return manager
  }

  function flushFrame(): void {
    const queue = rafQueue
    rafQueue = []
    for (const callback of queue) {
      callback(16)
    }
  }

  beforeEach(() => {
    resetTerminalWebglSuggestion()
    rafQueue = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafQueue.push(callback)
      return rafQueue.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    for (const manager of registeredManagers.splice(0)) {
      unregisterLivePaneManager(manager)
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('repaints only after the post-reveal frame has settled without clearing the atlas', () => {
    const webglAddon = { clearTextureAtlas: vi.fn() }
    const pane = createPane({ webglAddon })
    registerPaneManager(() => [pane])
    schedulePaneRevealRepaint(() => [pane])

    // First frame: reveal layout may still be in flight; redraw requests fired
    // here can be dropped by the renderer without retry.
    flushFrame()
    expect(webglAddon.clearTextureAtlas).not.toHaveBeenCalled()
    expect(pane.terminal.refresh).not.toHaveBeenCalled()

    flushFrame()
    expect(webglAddon.clearTextureAtlas).not.toHaveBeenCalled()
    expect(pane.terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('waits for a retained pane reveal fit to settle before repainting', () => {
    let settleFit: (() => void) | undefined
    fitRevealedPane.mockImplementationOnce((_pane, onSettled) => {
      settleFit = onSettled
    })
    const pane = createPane()

    schedulePaneRevealRepaint(() => [pane])
    flushFrame()
    flushFrame()

    expect(fitRevealedPane).toHaveBeenCalledWith(pane, expect.any(Function))
    expect(pane.terminal.refresh).not.toHaveBeenCalled()

    settleFit?.()
    expect(pane.terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('keeps a pane reveal scoped to the revealed manager', () => {
    const pane = createPane({ webglAddon: { clearTextureAtlas: vi.fn() } })
    const siblingPane = createPane({ webglAddon: { clearTextureAtlas: vi.fn() } })
    const targetManager = registerPaneManager(() => [pane])
    const siblingManager = registerPaneManager(() => [siblingPane])

    schedulePaneRevealRepaint(() => [pane])
    flushFrame()
    flushFrame()

    expect(targetManager.resetWebglTextureAtlases).not.toHaveBeenCalled()
    expect(siblingManager.resetWebglTextureAtlases).not.toHaveBeenCalled()
    expect(
      (siblingPane.webglAddon as never as FakeWebglAddon).clearTextureAtlas
    ).not.toHaveBeenCalled()
    expect(pane.terminal.refresh).toHaveBeenCalledWith(0, 23)
    expect(siblingPane.terminal.refresh).not.toHaveBeenCalled()
  })

  it('coalesces concurrent pane-scoped reveal repaints', () => {
    const firstPane = createPane({ webglAddon: { clearTextureAtlas: vi.fn() } })
    const secondPane = createPane({ webglAddon: { clearTextureAtlas: vi.fn() } })
    const firstManager = registerPaneManager(() => [firstPane])
    const secondManager = registerPaneManager(() => [secondPane])

    schedulePaneRevealRepaint(() => [firstPane])
    schedulePaneRevealRepaint(() => [secondPane])
    flushFrame()
    flushFrame()

    expect(firstManager.resetWebglTextureAtlases).not.toHaveBeenCalled()
    expect(secondManager.resetWebglTextureAtlases).not.toHaveBeenCalled()
    expect(firstPane.terminal.refresh).toHaveBeenCalledTimes(1)
    expect(secondPane.terminal.refresh).toHaveBeenCalledTimes(1)
  })

  it('repaints only the requested pane while its binding still owns it', () => {
    const firstPane = createPane({ id: 1 })
    const requestedPane = createPane({ id: 2 })
    const manager = Object.assign(Object.create(PaneManager.prototype), {
      panes: new Map([
        [firstPane.id, firstPane],
        [requestedPane.id, requestedPane]
      ]),
      atlasRecoveryVisible: true,
      destroyed: false
    }) as PaneManager

    manager.schedulePaneRepaint(requestedPane.id, () => true)
    flushFrame()
    flushFrame()

    expect(firstPane.terminal.refresh).not.toHaveBeenCalled()
    expect(requestedPane.terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('drops a queued pane repaint when ownership or pane visibility changes', () => {
    const pane = createPane()
    let ownsPane = true
    const manager = Object.assign(Object.create(PaneManager.prototype), {
      panes: new Map([[pane.id, pane]]),
      atlasRecoveryVisible: true,
      destroyed: false
    }) as PaneManager

    manager.schedulePaneRepaint(pane.id, () => ownsPane)
    ownsPane = false
    flushFrame()
    flushFrame()
    expect(pane.terminal.refresh).not.toHaveBeenCalled()

    ownsPane = true
    manager.schedulePaneRepaint(pane.id, () => ownsPane)
    manager.setAtlasRecoveryVisible(false)
    flushFrame()
    flushFrame()
    expect(pane.terminal.refresh).not.toHaveBeenCalled()

    manager.setAtlasRecoveryVisible(true)
    manager.schedulePaneRepaint(pane.id, () => ownsPane)
    ;(manager as unknown as { panes: Map<number, ManagedPaneInternal> }).panes.delete(pane.id)
    flushFrame()
    flushFrame()
    expect(pane.terminal.refresh).not.toHaveBeenCalled()
  })

  it('reattaches a missing WebGL addon before repainting', () => {
    const pane = createPane()
    const manager = registerPaneManager(() => [pane])
    schedulePaneRevealRepaint(() => [pane])

    flushFrame()
    flushFrame()

    expect(pane.webglAddon).not.toBeNull()
    expect(manager.resetWebglTextureAtlases).not.toHaveBeenCalled()
    expect(pane.terminal.refresh).toHaveBeenCalled()
  })

  it('resolves the pane list at repaint time, not at scheduling time', () => {
    const stalePane = createPane({ webglAddon: { clearTextureAtlas: vi.fn() } })
    const livePane = createPane({ webglAddon: { clearTextureAtlas: vi.fn() } })
    const panes = [stalePane]
    registerPaneManager(() => panes)
    schedulePaneRevealRepaint(() => panes)
    panes.splice(0, panes.length, livePane)

    flushFrame()
    flushFrame()

    expect(
      (stalePane.webglAddon as never as FakeWebglAddon).clearTextureAtlas
    ).not.toHaveBeenCalled()
    expect(
      (livePane.webglAddon as never as FakeWebglAddon).clearTextureAtlas
    ).not.toHaveBeenCalled()
    expect(stalePane.terminal.refresh).not.toHaveBeenCalled()
    expect(livePane.terminal.refresh).toHaveBeenCalledWith(0, 23)
  })

  it('keeps repainting remaining panes when one pane throws', () => {
    const explosivePane = {
      get gpuRenderingEnabled(): boolean {
        throw new Error('pane torn down mid-frame')
      }
    } as never as ManagedPaneInternal
    const webglAddon = { clearTextureAtlas: vi.fn() }
    const livePane = createPane({ webglAddon })
    registerPaneManager(() => [explosivePane, livePane])
    schedulePaneRevealRepaint(() => [explosivePane, livePane])

    flushFrame()
    flushFrame()

    expect(webglAddon.clearTextureAtlas).not.toHaveBeenCalled()
    expect(livePane.terminal.refresh).toHaveBeenCalled()
  })

  it('releases a revealed pane paused by xterm without clearing the atlas', () => {
    const renderService: FakeRenderService = {
      _isPaused: true,
      _needsFullRefresh: true,
      refreshRows: vi.fn()
    }
    const webglAddon = { clearTextureAtlas: vi.fn() }
    const pane = createPane({ webglAddon, renderService })

    schedulePaneRevealRepaint(() => [pane])
    flushFrame()
    flushFrame()

    expect(renderService._isPaused).toBe(false)
    expect(renderService._needsFullRefresh).toBe(false)
    expect(renderService.refreshRows).toHaveBeenCalledWith(0, 23, true)
    expect(pane.terminal.refresh).not.toHaveBeenCalled()
    expect(webglAddon.clearTextureAtlas).not.toHaveBeenCalled()
  })

  it('drops a stale repaint when the pane is hidden again before the settled frame', () => {
    const renderService: FakeRenderService = {
      _isPaused: true,
      _needsFullRefresh: true,
      refreshRows: vi.fn()
    }
    const pane = createPane({ renderService })
    let visible = true

    schedulePaneRevealRepaint(() => (visible ? [pane] : []))
    visible = false
    flushFrame()
    flushFrame()

    expect(renderService._isPaused).toBe(true)
    expect(renderService.refreshRows).not.toHaveBeenCalled()
    expect(pane.terminal.refresh).not.toHaveBeenCalled()
  })

  it('falls back to a timeout when animation frames are unavailable', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    const webglAddon = { clearTextureAtlas: vi.fn() }
    const pane = createPane({ webglAddon })
    registerPaneManager(() => [pane])

    schedulePaneRevealRepaint(() => [pane])
    vi.runAllTimers()

    expect(webglAddon.clearTextureAtlas).not.toHaveBeenCalled()
    expect(pane.terminal.refresh).toHaveBeenCalledWith(0, 23)
    vi.useRealTimers()
  })

  describe('schedulePaneRevealPresent', () => {
    it('presents the settled buffer without wiping the shared glyph atlas', () => {
      // The plain-refocus path must NOT clear the atlas — the clear is a
      // same-config shared wipe that re-arms the mid-stream page-merge race.
      const webglAddon = { clearTextureAtlas: vi.fn() }
      const pane = createPane({ webglAddon })
      schedulePaneRevealPresent(() => [pane])

      flushFrame()
      expect(pane.terminal.refresh).not.toHaveBeenCalled()

      flushFrame()
      expect(webglAddon.clearTextureAtlas).not.toHaveBeenCalled()
      expect(pane.terminal.refresh).toHaveBeenCalledWith(0, 23)
    })

    it('still retries a missing WebGL attach on the settled frame', () => {
      const pane = createPane()
      schedulePaneRevealPresent(() => [pane])

      flushFrame()
      flushFrame()

      expect(pane.webglAddon).not.toBeNull()
      expect(pane.terminal.refresh).toHaveBeenCalled()
    })
  })
})
