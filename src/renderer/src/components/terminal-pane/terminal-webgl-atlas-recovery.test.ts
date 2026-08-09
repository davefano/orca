import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  registerLivePaneManager,
  unregisterLivePaneManager
} from '@/lib/pane-manager/pane-manager-registry'
import {
  createTerminalWebglOutputRecovery,
  scheduleImagePasteWebglAtlasRecovery,
  TERMINAL_OUTPUT_RECOVERY_QUIET_MS
} from './terminal-webgl-atlas-recovery'

describe('terminal WebGL recovery', () => {
  const registeredManagers: { resetWebglTextureAtlases(): void }[] = []

  function registerManager(): {
    resetWebglTextureAtlases: Mock<() => void>
    refreshAllPanes: Mock<() => void>
  } {
    const manager = {
      resetWebglTextureAtlases: vi.fn<() => void>(),
      refreshAllPanes: vi.fn<() => void>()
    }
    registerLivePaneManager(manager)
    registeredManagers.push(manager)
    return manager
  }

  afterEach(() => {
    for (const manager of registeredManagers.splice(0)) {
      unregisterLivePaneManager(manager)
    }
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('clears shared atlases through the post-paste redraw window', () => {
    vi.useFakeTimers()
    const rafCallbacks: FrameRequestCallback[] = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        rafCallbacks.push(callback)
        return rafCallbacks.length
      })
    )
    const manager = registerManager()
    const otherManager = registerManager()

    scheduleImagePasteWebglAtlasRecovery()
    rafCallbacks[0]?.(0)
    vi.advanceTimersByTime(500)

    expect(manager.resetWebglTextureAtlases).toHaveBeenCalledTimes(3)
    expect(manager.refreshAllPanes).toHaveBeenCalledTimes(3)
    expect(otherManager.resetWebglTextureAtlases).toHaveBeenCalledTimes(3)
    expect(otherManager.refreshAllPanes).toHaveBeenCalledTimes(3)
  })

  it('falls back to a timeout for paste recovery when animation frames are unavailable', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', undefined)
    const manager = registerManager()

    scheduleImagePasteWebglAtlasRecovery()
    vi.advanceTimersByTime(0)

    expect(manager.resetWebglTextureAtlases).toHaveBeenCalledOnce()
    expect(manager.refreshAllPanes).toHaveBeenCalledOnce()
  })

  it('does not recover mid-stream while one terminal keeps producing output', () => {
    vi.useFakeTimers()
    const recover = vi.fn()
    const controller = createTerminalWebglOutputRecovery(recover)

    for (let elapsed = 0; elapsed < 1_000; elapsed += 50) {
      controller.schedule()
      vi.advanceTimersByTime(50)
    }

    expect(recover).not.toHaveBeenCalled()
    vi.advanceTimersByTime(TERMINAL_OUTPUT_RECOVERY_QUIET_MS)
    expect(recover).toHaveBeenCalledOnce()
  })

  it('settles simultaneous terminal streams independently without global atlas clears', () => {
    vi.useFakeTimers()
    const manager = registerManager()
    const firstTerminalRecovery = vi.fn()
    const secondTerminalRecovery = vi.fn()
    const firstController = createTerminalWebglOutputRecovery(firstTerminalRecovery)
    const secondController = createTerminalWebglOutputRecovery(secondTerminalRecovery)

    firstController.schedule()
    vi.advanceTimersByTime(100)
    secondController.schedule()
    vi.advanceTimersByTime(100)

    expect(firstTerminalRecovery).toHaveBeenCalledOnce()
    expect(secondTerminalRecovery).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(secondTerminalRecovery).toHaveBeenCalledOnce()
    expect(manager.resetWebglTextureAtlases).not.toHaveBeenCalled()
    expect(manager.refreshAllPanes).not.toHaveBeenCalled()
  })

  it('cancels a pending output recovery when its PTY binding is disposed', () => {
    vi.useFakeTimers()
    const recover = vi.fn()
    const controller = createTerminalWebglOutputRecovery(recover)

    controller.schedule()
    controller.dispose()
    vi.advanceTimersByTime(TERMINAL_OUTPUT_RECOVERY_QUIET_MS)

    expect(recover).not.toHaveBeenCalled()
  })

  it('does not re-arm output recovery when a late parse callback runs after disposal', () => {
    vi.useFakeTimers()
    const recover = vi.fn()
    const controller = createTerminalWebglOutputRecovery(recover)

    controller.dispose()
    controller.schedule()
    vi.advanceTimersByTime(TERMINAL_OUTPUT_RECOVERY_QUIET_MS)

    expect(recover).not.toHaveBeenCalled()
  })
})
