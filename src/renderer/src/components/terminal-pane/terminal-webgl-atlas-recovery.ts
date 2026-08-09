import { resetAndRefreshAllTerminalWebglAtlases } from '@/lib/pane-manager/pane-manager-registry'

const ATLAS_RECOVERY_DELAYS_MS = [120, 500]

// Why: a streaming TUI requests output recovery every frame. Wait for that
// terminal to go quiet so its pane-scoped repaint runs once, on settle.
export const TERMINAL_OUTPUT_RECOVERY_QUIET_MS = 200

type TerminalWebglOutputRecovery = {
  schedule: () => void
  dispose: () => void
}

function scheduleNextFrame(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(callback)
    return
  }
  globalThis.setTimeout(callback, 0)
}

function resetAtlasesAndRefreshPanes(reason: string): void {
  try {
    // Why: the glyph atlas is shared across same-config terminals, so the
    // recovery reset must be followed by repainting each rebuilt render model.
    resetAndRefreshAllTerminalWebglAtlases(reason)
  } catch {
    /* ignore - terminal pane may have unmounted after scheduling recovery */
  }
}

function scheduleAtlasRecoveryBurst(reason: string): void {
  scheduleNextFrame(() => resetAtlasesAndRefreshPanes(reason))
  for (const delayMs of ATLAS_RECOVERY_DELAYS_MS) {
    globalThis.setTimeout(() => resetAtlasesAndRefreshPanes(reason), delayMs)
  }
}

export function scheduleImagePasteWebglAtlasRecovery(): void {
  // Why: image chips can redraw after bracketed paste parsing, so cover the
  // short post-paste paint window with a few cheap atlas rebuilds. Paste is a
  // one-shot event, so recover immediately rather than debouncing.
  scheduleAtlasRecoveryBurst('image-paste')
}

export function createTerminalWebglOutputRecovery(
  recover: () => void
): TerminalWebglOutputRecovery {
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearPendingTimer = (): void => {
    if (timer != null) {
      globalThis.clearTimeout(timer)
      timer = null
    }
  }

  const dispose = (): void => {
    disposed = true
    clearPendingTimer()
  }

  return {
    schedule: () => {
      // Why: xterm parse callbacks can complete after the PTY binding unmounts.
      // A late callback must not re-arm recovery for a successor pane.
      if (disposed) {
        return
      }
      // Why per PTY: unrelated remote TUIs can stream continuously. One shared
      // timer lets one host postpone another host's repaint.
      clearPendingTimer()
      timer = globalThis.setTimeout(() => {
        timer = null
        try {
          recover()
        } catch {
          /* ignore - terminal manager may have unmounted after scheduling recovery */
        }
      }, TERMINAL_OUTPUT_RECOVERY_QUIET_MS)
    },
    dispose
  }
}
