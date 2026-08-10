import type { ManagedPaneInternal } from './pane-manager-types'
import { fitRevealedPane } from './pane-reveal-fit'
import { reattachWebglIfNeeded } from './pane-webgl-reattach'
import { forceRepaintThroughRenderPause } from './terminal-render-pause-release'

type PaneGetter = () => Iterable<ManagedPaneInternal>

const pendingRevealRepaints = new Set<PaneGetter>()
let revealRepaintScheduled = false

function scheduleSettledFrame(callback: () => void): void {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.setTimeout(callback, 0)
    return
  }
  // Why: the first frame after a reveal can still be laying out the tab
  // overlay; the WebGL renderer silently drops redraw requests until the pane
  // is attached and measured, so repaint on the frame after layout settles.
  globalThis.requestAnimationFrame(() => {
    globalThis.requestAnimationFrame(callback)
  })
}

function forEachPaneOnSettledFrame(
  getPanes: () => Iterable<ManagedPaneInternal>,
  visit: (pane: ManagedPaneInternal) => void
): void {
  scheduleSettledFrame(() => {
    for (const pane of getPanes()) {
      try {
        visit(pane)
      } catch {
        /* ignore — one pane's failure must not block repaint of the rest */
      }
    }
  })
}

function flushPaneRevealRepaints(): void {
  revealRepaintScheduled = false
  const paneGetters = Array.from(pendingRevealRepaints)
  pendingRevealRepaints.clear()
  const livePanes = new Set<ManagedPaneInternal>()

  for (const getPanes of paneGetters) {
    try {
      for (const pane of getPanes()) {
        livePanes.add(pane)
      }
    } catch {
      /* ignore — a manager may be destroyed while its repaint is pending */
    }
  }

  for (const pane of livePanes) {
    try {
      // Why: retained paired-runtime panes were measured while display:none.
      // Repainting before their reveal fit settles leaves xterm presenting the
      // hidden geometry until new output or a hard refresh wakes it. Fit first,
      // then repaint the same pane once its visible grid is authoritative.
      fitRevealedPane(pane, () => repaintRevealedPane(pane))
    } catch {
      /* ignore — one pane's teardown must not block sibling repaint */
    }
  }
}

function repaintRevealedPane(pane: ManagedPaneInternal): void {
  try {
    reattachWebglIfNeeded(pane)
    // Why: xterm can still consider a newly revealed pane non-intersecting
    // for one frame. Release that pane's paused-render gate and repaint its
    // current buffer without clearing the module-global glyph atlas shared
    // by unrelated terminals.
    if (!forceRepaintThroughRenderPause(pane.terminal) && pane.terminal.rows > 0) {
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    }
  } catch {
    /* ignore — the pane may be disposed while its reveal fit is settling */
  }
}

/**
 * Repaints a revealed tab's panes from their xterm buffers.
 *
 * Why: while a pane is hidden, parsed output can update the WebGL renderer's
 * per-cell model without ever presenting a frame. At reveal the model diff
 * reports those cells unchanged, so plain refreshes skip them and the canvas
 * keeps compositing pre-hide pixels until a selection or resize rebuilds the
 * model. Once layout settles, reattach and repaint only the revealed panes.
 * Ordinary tab/worktree changes must preserve the shared glyph atlas: clearing
 * it invalidates sibling renderers and causes repeated rasterization whenever
 * the app returns to the foreground.
 */
export function schedulePaneRevealRepaint(getPanes: () => Iterable<ManagedPaneInternal>): void {
  pendingRevealRepaints.add(getPanes)
  if (revealRepaintScheduled) {
    return
  }
  revealRepaintScheduled = true
  scheduleSettledFrame(flushPaneRevealRepaints)
}

/**
 * Presents already-visible panes after layout settles.
 *
 * Why: a plain window refocus never hid its panes, so their WebGL model is
 * already current — a `refresh` re-presents the live buffer (covering a
 * compositor that dropped frames while occluded). It does not need the reveal
 * repaint's coalescing or paused-render release because these panes stayed
 * visible.
 */
export function schedulePaneRevealPresent(getPanes: () => Iterable<ManagedPaneInternal>): void {
  forEachPaneOnSettledFrame(getPanes, (pane) => {
    reattachWebglIfNeeded(pane)
    if (pane.terminal.rows > 0) {
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    }
  })
}
