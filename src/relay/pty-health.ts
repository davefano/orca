import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { PtyHealthPressure, PtyHealthSnapshot } from '../shared/ssh-types'

const execFile = promisify(execFileCallback)
const DIAGNOSTIC_TIMEOUT_MS = 3_000

export function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseDarwinAllocatedPtys(output: string): number {
  const ttyNames = new Set<string>()
  for (const line of output.split(/\r?\n/u)) {
    const ttyName = line.trim()
    if (ttyName.startsWith('ttys')) {
      ttyNames.add(ttyName)
    }
  }
  return ttyNames.size
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

async function readDarwinAllocated(): Promise<number> {
  // Why: /dev/ttys* contains persistent device nodes, not live allocations.
  // Unique process-backed TTY names reveal the active pool without requiring elevated lsof access.
  const { stdout } = await execFile('/bin/ps', ['-axo', 'tty='], {
    timeout: DIAGNOSTIC_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024
  })
  return parseDarwinAllocatedPtys(stdout)
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
    const [systemCapacity, systemAllocated] = await Promise.all([
      readDarwinCapacity(),
      readDarwinAllocated()
    ])
    const systemAvailable =
      systemCapacity === null ? null : Math.max(0, systemCapacity - systemAllocated)
    return {
      platform,
      systemCapacity,
      systemAllocated,
      systemAvailable,
      relayOwned: args.relayOwned,
      relayCapacity: args.relayCapacity,
      pressure: classifyPtyPressure(systemCapacity, systemAvailable)
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
