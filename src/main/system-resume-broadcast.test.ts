import { describe, expect, it, vi } from 'vitest'
import { registerSystemResumeBroadcast, SYSTEM_RESUMED_CHANNEL } from './system-resume-broadcast'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  powerMonitor: { on: vi.fn(), off: vi.fn() }
}))

type PowerListener = () => void
type PowerEvent = 'suspend' | 'resume'

function createResumeSource() {
  const state: Record<PowerEvent, PowerListener | null> = { suspend: null, resume: null }
  const source = {
    on: vi.fn((event: PowerEvent, callback: PowerListener) => {
      state[event] = callback
    }),
    off: vi.fn((event: PowerEvent, _callback: PowerListener) => {
      state[event] = null
    })
  }
  return {
    source,
    fireSuspend: () => state.suspend?.(),
    fireResume: () => state.resume?.()
  }
}

function createWindow(destroyed = false): {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn<(channel: string) => void>> }
} {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn<(channel: string) => void>() }
  }
}

describe('registerSystemResumeBroadcast', () => {
  it('broadcasts the resume channel to every live window', () => {
    const { source, fireResume } = createResumeSource()
    const liveWindow = createWindow()
    const destroyedWindow = createWindow(true)
    registerSystemResumeBroadcast({
      resumeSource: source,
      getWindows: () => [liveWindow, destroyedWindow]
    })

    fireResume()

    expect(liveWindow.webContents.send).toHaveBeenCalledWith(SYSTEM_RESUMED_CHANNEL)
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('records suspend and resume breadcrumbs around wake recovery', () => {
    const { source, fireSuspend, fireResume } = createResumeSource()
    const recordBreadcrumb = vi.fn()
    registerSystemResumeBroadcast({
      resumeSource: source,
      recordBreadcrumb
    })

    fireSuspend()
    fireResume()

    expect(recordBreadcrumb.mock.calls).toEqual([['system_suspend'], ['system_resume']])
  })

  it('stops broadcasting after unsubscribe', () => {
    const { source, fireResume } = createResumeSource()
    const window = createWindow()
    const unsubscribe = registerSystemResumeBroadcast({
      resumeSource: source,
      getWindows: () => [window]
    })

    unsubscribe()
    fireResume()

    expect(source.off).toHaveBeenCalledTimes(2)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })
})
