import { describe, expect, it } from 'vitest'
import {
  classifyPtyPressure,
  parseDarwinAllocatedPtyMasters,
  parsePositiveInteger
} from './pty-health'

describe('PTY health parsing', () => {
  it('counts allocated Darwin PTY master descriptors', () => {
    expect(
      parseDarwinAllocatedPtyMasters(
        ['p20873', 'f19', 'n/dev/ptmx', 'f20', 'n/dev/ptmx', 'p31051', 'f11', 'n/dev/ptmx'].join(
          '\n'
        )
      )
    ).toBe(3)
  })

  it('includes master-only allocations after their slave processes exit', () => {
    const leakedMasters = Array.from({ length: 480 }, (_, index) => [
      `f${index + 10}`,
      'n/dev/ptmx'
    ]).flat()
    expect(parseDarwinAllocatedPtyMasters(['p20873', ...leakedMasters].join('\n'))).toBe(480)
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
