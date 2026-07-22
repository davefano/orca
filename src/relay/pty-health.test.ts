import { describe, expect, it } from 'vitest'
import { classifyPtyPressure, parseDarwinAllocatedPtys, parsePositiveInteger } from './pty-health'

describe('PTY health parsing', () => {
  it('counts unique live Darwin PTY slave paths rather than device nodes', () => {
    expect(
      parseDarwinAllocatedPtys(['??', 'ttys001', 'ttys001', 'ttys00a', 'console'].join('\n'))
    ).toBe(2)
  })

  it('rejects invalid system capacities', () => {
    expect(parsePositiveInteger('511\n')).toBe(511)
    expect(parsePositiveInteger('0')).toBeNull()
    expect(parsePositiveInteger('not-a-number')).toBeNull()
  })
})

describe('PTY pressure thresholds', () => {
  it('warns with ten percent headroom remaining', () => {
    expect(classifyPtyPressure(511, 53)).toBe('normal')
    expect(classifyPtyPressure(511, 52)).toBe('warning')
  })

  it('becomes critical with two percent headroom remaining', () => {
    expect(classifyPtyPressure(511, 12)).toBe('warning')
    expect(classifyPtyPressure(511, 11)).toBe('critical')
  })

  it('uses minimum thresholds on small pools', () => {
    expect(classifyPtyPressure(50, 9)).toBe('normal')
    expect(classifyPtyPressure(50, 8)).toBe('warning')
    expect(classifyPtyPressure(50, 3)).toBe('critical')
  })

  it('reports unknown without capacity', () => {
    expect(classifyPtyPressure(null, null)).toBe('unknown')
  })
})
