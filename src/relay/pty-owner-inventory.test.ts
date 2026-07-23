import { describe, expect, it } from 'vitest'
import { parseDarwinPtyOwnerInventory } from './pty-owner-inventory'

const PS_OUTPUT = [
  '20873     1 ??       Tue Jul 14 23:35:22 2026 /opt/node relay.js --detached',
  '60867 20873 ttys022  Thu Jul 16 09:50:44 2026 /bin/zsh -l',
  '75679 60867 ttys022  Thu Jul 16 09:50:53 2026 claude --model sonnet',
  '98022     1 ??       Sat Jul 18 09:22:04 2026 /opt/node relay.js --detached',
  '63839 98022 ttys026  Sat Jul 18 14:19:17 2026 /bin/zsh -l',
  '64285 98022 ttys033  Sat Jul 18 14:19:23 2026 /bin/zsh -l',
  '64299 98022 ??       Sat Jul 18 14:20:01 2026 node relay-helper.js',
  '84875     1 ??       Wed Jul 22 22:54:30 2026 /opt/node relay.js --detached',
  '60037 84875 ttys052  Wed Jul 22 23:57:33 2026 /bin/zsh -l',
  '60469 60037 ttys052  Wed Jul 22 23:57:41 2026 claude',
  '90904 90895 ??       Thu Jul 23 13:03:49 2026 claude --bg-pty-host'
].join('\n')

const LSOF_OUTPUT = [
  'p20873',
  'cnode',
  'f18',
  'r0xf00002c',
  'n/dev/ptmx',
  'f19',
  'r0xf00001d',
  'n/dev/ptmx',
  'f20',
  'r0xf00001b',
  'n/dev/ptmx',
  'p98022',
  'cnode',
  'f23',
  'r0xf000026',
  'n/dev/ptmx',
  'f27',
  'r0xf000033',
  'n/dev/ptmx',
  'p84875',
  'cnode',
  'f26',
  'r0xf000052',
  'n/dev/ptmx',
  'p90904',
  'cclaude.ex',
  'f6',
  'r0xf000054',
  'n/dev/ptmx',
  'f8',
  'r0xf000054',
  'n/dev/ptmx',
  'f9',
  'r0xf000054',
  'n/dev/ptmx'
].join('\n')

describe('Darwin PTY owner inventory', () => {
  it('counts unique raw PTY devices instead of duplicate descriptors', () => {
    const inventory = parseDarwinPtyOwnerInventory({
      lsofOutput: LSOF_OUTPUT,
      psOutput: PS_OUTPUT,
      currentPid: 84875
    })

    expect(inventory.systemAllocated).toBe(7)
    expect(inventory.owners.find((owner) => owner.pid === 90904)).toMatchObject({
      allocationCount: 1,
      attachedPtyCount: 0,
      category: 'agent'
    })
  })

  it('protects active, current, and non-shell workload relays', () => {
    const inventory = parseDarwinPtyOwnerInventory({
      lsofOutput: LSOF_OUTPUT,
      psOutput: PS_OUTPUT,
      currentPid: 84875
    })

    expect(inventory.owners.find((owner) => owner.pid === 20873)).toMatchObject({
      allocationCount: 3,
      attachedPtyCount: 1,
      leakedPtyCount: 2,
      activeAgentCount: 1,
      disposition: 'recover-first'
    })
    expect(inventory.owners.find((owner) => owner.pid === 98022)).toMatchObject({
      allocationCount: 2,
      attachedPtyCount: 2,
      idleShellCount: 2,
      workloadCount: 1,
      disposition: 'protected'
    })
    expect(inventory.owners.find((owner) => owner.pid === 84875)).toMatchObject({
      isCurrentRelay: true,
      disposition: 'protected'
    })
  })

  it('marks a legacy relay safe when it has only idle shells and leaked masters', () => {
    const inventory = parseDarwinPtyOwnerInventory({
      lsofOutput: LSOF_OUTPUT,
      psOutput: PS_OUTPUT.replace(
        '64299 98022 ??       Sat Jul 18 14:20:01 2026 node relay-helper.js',
        ''
      ),
      currentPid: 84875
    })

    expect(inventory.owners.find((owner) => owner.pid === 98022)).toMatchObject({
      workloadCount: 0,
      idleShellCount: 2,
      disposition: 'safe'
    })
  })

  it('uses the process start time in the owner identity', () => {
    const inventory = parseDarwinPtyOwnerInventory({
      lsofOutput: LSOF_OUTPUT,
      psOutput: PS_OUTPUT,
      currentPid: 84875
    })

    expect(inventory.owners.find((owner) => owner.pid === 98022)?.ownerId).toBe(
      '98022:Sat Jul 18 09:22:04 2026'
    )
  })
})
