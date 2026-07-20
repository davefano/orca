import { describe, expect, it } from 'vitest'
import { clampResourceManagerPosition } from './resource-manager-drag-bounds'

const rect = {
  left: 500,
  right: 900,
  top: 200,
  bottom: 600,
  width: 400,
  height: 400
}

describe('clampResourceManagerPosition', () => {
  it('keeps a fitting panel inside the viewport margin', () => {
    expect(
      clampResourceManagerPosition({
        current: { x: 0, y: 0 },
        proposed: { x: 800, y: -500 },
        rect,
        viewportWidth: 1_000,
        viewportHeight: 800,
        margin: 8,
        recoveryHeight: 32
      })
    ).toEqual({ x: 92, y: -192 })
  })

  it('uses the live translated rectangle when clamping a later drag', () => {
    expect(
      clampResourceManagerPosition({
        current: { x: 50, y: -100 },
        proposed: { x: -900, y: 600 },
        rect: { ...rect, left: 550, right: 950, top: 100, bottom: 500 },
        viewportWidth: 1_000,
        viewportHeight: 800,
        margin: 8,
        recoveryHeight: 32
      })
    ).toEqual({ x: -492, y: 192 })
  })

  it('keeps the recovery header visible when the panel is taller than the viewport', () => {
    expect(
      clampResourceManagerPosition({
        current: { x: 0, y: 0 },
        proposed: { x: 0, y: -1_000 },
        rect: { ...rect, top: 40, bottom: 940, height: 900 },
        viewportWidth: 1_000,
        viewportHeight: 700,
        margin: 8,
        recoveryHeight: 32
      })
    ).toEqual({ x: 0, y: -32 })
  })

  it('does not let an oversized panel leave through the bottom or right edge', () => {
    expect(
      clampResourceManagerPosition({
        current: { x: 0, y: 0 },
        proposed: { x: 2_000, y: 2_000 },
        rect: { left: 40, right: 1_140, top: 40, bottom: 940, width: 1_100, height: 900 },
        viewportWidth: 1_000,
        viewportHeight: 700,
        margin: 8,
        recoveryHeight: 32
      })
    ).toEqual({ x: 952, y: 620 })
  })
})
