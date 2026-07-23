import { describe, expect, it } from 'vitest'
import type { PtyHealthSnapshot, PtyOwnerSnapshot } from '../shared/ssh-types'
import { classifyPtyPressure, parsePositiveInteger, selectPrunablePtyOwner } from './pty-health'

describe('PTY health parsing', () => {
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

function health(owners: PtyOwnerSnapshot[]): PtyHealthSnapshot {
  return {
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

describe('PTY owner prune gate', () => {
  it('accepts only a freshly inventoried safe legacy relay', () => {
    expect(selectPrunablePtyOwner(health([owner()]), owner().ownerId).pid).toBe(98022)
  })

  it('rejects active, current, stale, and non-relay owners', () => {
    expect(() =>
      selectPrunablePtyOwner(
        health([owner({ disposition: 'recover-first', activeAgentCount: 1 })]),
        owner().ownerId
      )
    ).toThrow('pty_owner_not_safe')
    expect(() =>
      selectPrunablePtyOwner(
        health([owner({ disposition: 'protected', isCurrentRelay: true })]),
        owner().ownerId
      )
    ).toThrow('pty_owner_not_safe')
    expect(() => selectPrunablePtyOwner(health([owner()]), '98022:old-start')).toThrow(
      'pty_owner_not_found'
    )
    expect(() =>
      selectPrunablePtyOwner(
        health([owner({ category: 'terminal', disposition: 'safe' })]),
        owner().ownerId
      )
    ).toThrow('pty_owner_not_safe')
  })
})
