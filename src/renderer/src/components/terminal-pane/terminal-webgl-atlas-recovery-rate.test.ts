import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTerminalWebglOutputRecovery,
  TERMINAL_OUTPUT_RECOVERY_QUIET_MS
} from './terminal-webgl-atlas-recovery'

describe('terminal WebGL output recovery cadence', () => {
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('coalesces a high-rate stream to one target recovery after quiet', () => {
    vi.useFakeTimers()
    const recover = vi.fn()
    const controller = createTerminalWebglOutputRecovery(recover)

    for (let elapsed = 0; elapsed < 300_000; elapsed += 50) {
      controller.schedule()
      vi.advanceTimersByTime(50)
    }

    expect(recover).not.toHaveBeenCalled()
    vi.advanceTimersByTime(TERMINAL_OUTPUT_RECOVERY_QUIET_MS)
    expect(recover).toHaveBeenCalledOnce()
  })

  it('keeps a quiet target responsive while another target continues streaming', () => {
    vi.useFakeTimers()
    const quietTarget = vi.fn()
    const streamingTarget = vi.fn()
    const quietController = createTerminalWebglOutputRecovery(quietTarget)
    const streamingController = createTerminalWebglOutputRecovery(streamingTarget)

    quietController.schedule()
    for (let elapsed = 0; elapsed < 1_000; elapsed += 50) {
      streamingController.schedule()
      vi.advanceTimersByTime(50)
    }

    expect(quietTarget).toHaveBeenCalledOnce()
    expect(streamingTarget).not.toHaveBeenCalled()
    vi.advanceTimersByTime(TERMINAL_OUTPUT_RECOVERY_QUIET_MS)
    expect(streamingTarget).toHaveBeenCalledOnce()
  })
})
