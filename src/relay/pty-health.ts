import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  PtyHealthPressure,
  PtyHealthSnapshot,
  PtyOwnerPruneResult,
  PtyOwnerSnapshot
} from '../shared/ssh-types'
import { parseDarwinPtyOwnerInventory } from './pty-owner-inventory'

const execFile = promisify(execFileCallback)
const DIAGNOSTIC_TIMEOUT_MS = 3_000

async function readDarwinLsofOutput(): Promise<string> {
  try {
    const { stdout } = await execFile('/usr/sbin/lsof', ['-n', '-P', '-Fpcuftrn', '/dev/ptmx'], {
      timeout: DIAGNOSTIC_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    })
    return stdout
  } catch (error) {
    const lsofError = error as { code?: number | string; stdout?: string }
    // Why: lsof exits 1 when no matching files exist; that is a valid empty inventory.
    if (Number(lsofError.code) === 1 && !lsofError.stdout?.trim()) {
      return ''
    }
    throw error
  }
}

export function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function classifyPtyPressure(
  capacity: number | null,
  available: number | null
): PtyHealthPressure {
  if (capacity === null || available === null) {
    return 'unknown'
  }
  const criticalAt = Math.max(3, Math.ceil(capacity * 0.02))
  const warningAt = Math.max(8, Math.ceil(capacity * 0.1))
  if (available <= criticalAt) {
    return 'critical'
  }
  if (available <= warningAt) {
    return 'warning'
  }
  return 'normal'
}

async function readDarwinCapacity(): Promise<number | null> {
  const { stdout } = await execFile('/usr/sbin/sysctl', ['-n', 'kern.tty.ptmx_max'], {
    timeout: DIAGNOSTIC_TIMEOUT_MS,
    maxBuffer: 64 * 1024
  })
  return parsePositiveInteger(stdout)
}

async function readDarwinOwnerInventory(): Promise<
  ReturnType<typeof parseDarwinPtyOwnerInventory>
> {
  // Why: slave TTYs miss leaked master-only allocations; lsof's raw device id deduplicates inherited descriptors.
  const [lsofOutput, { stdout: psOutput }] = await Promise.all([
    readDarwinLsofOutput(),
    execFile('/bin/ps', ['-axo', 'pid=,ppid=,tty=,lstart=,command='], {
      timeout: DIAGNOSTIC_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' }
    })
  ])
  return parseDarwinPtyOwnerInventory({
    lsofOutput,
    psOutput,
    currentPid: process.pid
  })
}

export async function collectPtyHealth(args: {
  relayOwned: number
  relayCapacity: number
  platform?: NodeJS.Platform
}): Promise<PtyHealthSnapshot> {
  const platform = args.platform ?? process.platform
  if (platform !== 'darwin') {
    return {
      platform,
      systemCapacity: null,
      systemAllocated: null,
      systemAvailable: null,
      relayOwned: args.relayOwned,
      relayCapacity: args.relayCapacity,
      pressure: 'unknown'
    }
  }
  try {
    const [systemCapacity, inventory] = await Promise.all([
      readDarwinCapacity(),
      readDarwinOwnerInventory()
    ])
    const systemAllocated = inventory.systemAllocated
    const systemAvailable =
      systemCapacity === null ? null : Math.max(0, systemCapacity - systemAllocated)
    return {
      platform,
      systemCapacity,
      systemAllocated,
      systemAvailable,
      relayOwned: args.relayOwned,
      relayCapacity: args.relayCapacity,
      pressure: classifyPtyPressure(systemCapacity, systemAvailable),
      owners: inventory.owners
    }
  } catch (error) {
    return {
      platform,
      systemCapacity: null,
      systemAllocated: null,
      systemAvailable: null,
      relayOwned: args.relayOwned,
      relayCapacity: args.relayCapacity,
      pressure: 'unknown',
      diagnosticError: error instanceof Error ? error.message : String(error)
    }
  }
}

export function selectPrunablePtyOwner(
  snapshot: PtyHealthSnapshot,
  ownerId: string
): PtyOwnerSnapshot {
  const owner = snapshot.owners?.find((candidate) => candidate.ownerId === ownerId)
  if (!owner) {
    throw new Error('pty_owner_not_found')
  }
  if (owner.category !== 'orca-relay' || owner.isCurrentRelay || owner.disposition !== 'safe') {
    throw new Error('pty_owner_not_safe')
  }
  return owner
}

export async function prunePtyOwner(args: {
  ownerId: string
  relayOwned: number
  relayCapacity: number
}): Promise<PtyOwnerPruneResult> {
  if (process.platform !== 'darwin') {
    throw new Error('pty_owner_prune_unsupported')
  }
  // Why: rescan immediately before signaling so a stale UI cannot prune a relay that gained work.
  const snapshot = await collectPtyHealth({
    relayOwned: args.relayOwned,
    relayCapacity: args.relayCapacity
  })
  const owner = selectPrunablePtyOwner(snapshot, args.ownerId)
  process.kill(owner.pid, 'SIGTERM')
  return { owner, signaled: true }
}
