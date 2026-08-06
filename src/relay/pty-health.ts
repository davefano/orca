import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { PtyHealthPressure, PtyHealthSnapshot } from '../shared/ssh-types'

const execFile = promisify(execFileCallback)
const DIAGNOSTIC_TIMEOUT_MS = 3_000

export function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function parseDarwinAllocatedPtyMasters(output: string): number {
  const masters = new Set<string>()
  let processId: string | null = null
  let fileDescriptor: string | null = null
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('p')) {
      processId = line.slice(1)
      fileDescriptor = null
    } else if (line.startsWith('f')) {
      fileDescriptor = line.slice(1)
    } else if (line === 'n/dev/ptmx' && processId && fileDescriptor) {
      masters.add(`${processId}:${fileDescriptor}`)
    }
  }
  return masters.size
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
  // Why: leaked relays can retain hundreds of PTY masters after every slave process exits.
  // Counting /dev/ptmx file descriptors sees those allocations; process TTY names do not.
  const { stdout } = await execFile('/usr/sbin/lsof', ['-n', '-F', 'pfn', '/dev/ptmx'], {
    timeout: DIAGNOSTIC_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024
  })
  return parseDarwinAllocatedPtyMasters(stdout)
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
