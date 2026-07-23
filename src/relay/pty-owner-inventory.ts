import type { PtyOwnerCategory, PtyOwnerDisposition, PtyOwnerSnapshot } from '../shared/ssh-types'

type ProcessSnapshot = {
  pid: number
  ppid: number
  tty: string
  startedAt: string
  command: string
}

type LsofOwner = {
  pid: number
  command: string
  rawDevices: Set<string>
}

export type DarwinPtyOwnerInventory = {
  systemAllocated: number
  owners: PtyOwnerSnapshot[]
}

function parseLsofPtmxOwners(output: string): Map<number, LsofOwner> {
  const owners = new Map<number, LsofOwner>()
  let currentOwner: LsofOwner | null = null
  let currentRawDevice: string | null = null

  for (const line of output.split(/\r?\n/u)) {
    const field = line[0]
    const value = line.slice(1)
    if (field === 'p') {
      const pid = Number.parseInt(value, 10)
      currentOwner = Number.isSafeInteger(pid)
        ? { pid, command: '', rawDevices: new Set<string>() }
        : null
      if (currentOwner) {
        owners.set(pid, currentOwner)
      }
      currentRawDevice = null
    } else if (field === 'c' && currentOwner) {
      currentOwner.command = value
    } else if (field === 'f') {
      currentRawDevice = null
    } else if (field === 'r') {
      currentRawDevice = value
    } else if (field === 'n' && value === '/dev/ptmx' && currentOwner && currentRawDevice) {
      currentOwner.rawDevices.add(currentRawDevice)
    }
  }
  return owners
}

function parseDarwinProcesses(output: string): Map<number, ProcessSnapshot> {
  const processes = new Map<number, ProcessSnapshot>()
  const linePattern =
    /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/u

  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(linePattern)
    if (!match) {
      continue
    }
    const pid = Number.parseInt(match[1], 10)
    const ppid = Number.parseInt(match[2], 10)
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) {
      continue
    }
    processes.set(pid, {
      pid,
      ppid,
      tty: match[3],
      startedAt: match[4],
      command: match[5]
    })
  }
  return processes
}

function commandBasename(command: string): string {
  const executable = command.trim().split(/\s+/u)[0] ?? ''
  const segments = executable.split('/')
  return segments.at(-1) ?? executable
}

function isShellProcess(process: ProcessSnapshot): boolean {
  const basename = commandBasename(process.command).replace(/^-/, '')
  return basename === 'zsh' || basename === 'bash' || basename === 'sh' || basename === 'login'
}

function isAgentProcess(process: ProcessSnapshot): boolean {
  const basename = commandBasename(process.command)
  return basename === 'claude' || basename === 'claude.exe' || basename === 'codex'
}

function isDefunctProcess(process: ProcessSnapshot): boolean {
  return process.command.trim() === '<defunct>'
}

function classifyOwner(process: ProcessSnapshot | undefined, currentPid: number): PtyOwnerCategory {
  if (process?.pid === currentPid || process?.command.includes('relay.js --detached')) {
    return 'orca-relay'
  }
  if (process && isAgentProcess(process)) {
    return 'agent'
  }
  if (process?.command.includes('Terminal.app')) {
    return 'terminal'
  }
  return 'other'
}

function indexChildren(processes: Map<number, ProcessSnapshot>): Map<number, ProcessSnapshot[]> {
  const children = new Map<number, ProcessSnapshot[]>()
  for (const process of processes.values()) {
    const siblings = children.get(process.ppid) ?? []
    siblings.push(process)
    children.set(process.ppid, siblings)
  }
  return children
}

function descendantsOf(
  rootPid: number,
  childrenByParent: Map<number, ProcessSnapshot[]>
): ProcessSnapshot[] {
  const descendants: ProcessSnapshot[] = []
  const pending = [rootPid]
  while (pending.length > 0) {
    const parentPid = pending.pop()
    for (const process of childrenByParent.get(parentPid ?? -1) ?? []) {
      descendants.push(process)
      pending.push(process.pid)
    }
  }
  return descendants
}

function classifyDisposition(args: {
  category: PtyOwnerCategory
  isCurrentRelay: boolean
  activeAgentCount: number
  workloadCount: number
}): { disposition: PtyOwnerDisposition; reason: string } {
  if (args.category !== 'orca-relay') {
    return { disposition: 'protected', reason: 'PTY belongs to a non-relay process' }
  }
  if (args.isCurrentRelay) {
    return { disposition: 'protected', reason: 'Current Orca relay cannot prune itself' }
  }
  if (args.activeAgentCount > 0) {
    return {
      disposition: 'recover-first',
      reason: `${args.activeAgentCount} active agent${args.activeAgentCount === 1 ? '' : 's'} must be recovered first`
    }
  }
  if (args.workloadCount > 0) {
    return {
      disposition: 'protected',
      reason: `${args.workloadCount} foreground workload${args.workloadCount === 1 ? '' : 's'} still running`
    }
  }
  return { disposition: 'safe', reason: 'Legacy relay contains only idle shells or leaked PTYs' }
}

export function parseDarwinPtyOwnerInventory(args: {
  lsofOutput: string
  psOutput: string
  currentPid: number
}): DarwinPtyOwnerInventory {
  const lsofOwners = parseLsofPtmxOwners(args.lsofOutput)
  const processes = parseDarwinProcesses(args.psOutput)
  const childrenByParent = indexChildren(processes)
  const allRawDevices = new Set<string>()
  const owners: PtyOwnerSnapshot[] = []

  for (const lsofOwner of lsofOwners.values()) {
    for (const rawDevice of lsofOwner.rawDevices) {
      allRawDevices.add(rawDevice)
    }
    const ownerProcess = processes.get(lsofOwner.pid)
    const descendants = descendantsOf(lsofOwner.pid, childrenByParent)
    const category = classifyOwner(ownerProcess, args.currentPid)
    const isCurrentRelay = lsofOwner.pid === args.currentPid
    const relayShellRoots = descendants.filter(
      (process) => process.ppid === lsofOwner.pid && isShellProcess(process)
    )
    const relayShellDescendants = relayShellRoots.map((shell) =>
      descendantsOf(shell.pid, childrenByParent)
    )
    const relayPayloads = relayShellDescendants.map((shellDescendants) =>
      shellDescendants.filter((process) => !isShellProcess(process) && !isDefunctProcess(process))
    )
    const shellOwnedPids = new Set(
      relayShellDescendants.flatMap((shellDescendants) =>
        shellDescendants.map((process) => process.pid)
      )
    )
    const unownedPayloadCount = descendants.filter(
      (process) =>
        !relayShellRoots.includes(process) &&
        !shellOwnedPids.has(process.pid) &&
        !isShellProcess(process) &&
        !isDefunctProcess(process)
    ).length
    const activeAgentCount =
      category === 'orca-relay'
        ? relayPayloads.filter((payload) => payload.some(isAgentProcess)).length
        : Number(Boolean(ownerProcess && isAgentProcess(ownerProcess)))
    const workloadCount =
      category === 'orca-relay'
        ? relayPayloads.filter((payload) => payload.length > 0).length + unownedPayloadCount
        : descendants.filter((process) => !isShellProcess(process) && !isDefunctProcess(process))
            .length
    const idleShellCount =
      category === 'orca-relay'
        ? relayPayloads.filter((payload) => payload.length === 0).length
        : descendants.filter((process) => isShellProcess(process)).length
    const attachedPtyCount = new Set(
      descendants.map((process) => process.tty).filter((tty) => /^ttys[0-9a-f]+$/u.test(tty))
    ).size
    const allocationCount = lsofOwner.rawDevices.size
    const disposition = classifyDisposition({
      category,
      isCurrentRelay,
      activeAgentCount,
      workloadCount
    })
    const processStartedAt = ownerProcess?.startedAt ?? 'unknown'

    owners.push({
      ownerId: `${lsofOwner.pid}:${processStartedAt}`,
      pid: lsofOwner.pid,
      processStartedAt,
      command: commandBasename(ownerProcess?.command ?? lsofOwner.command),
      category,
      isCurrentRelay,
      allocationCount,
      attachedPtyCount,
      leakedPtyCount: Math.max(0, allocationCount - attachedPtyCount),
      activeAgentCount,
      workloadCount,
      idleShellCount,
      disposition: disposition.disposition,
      reason: disposition.reason
    })
  }

  owners.sort((left, right) => right.allocationCount - left.allocationCount)
  return { systemAllocated: allRawDevices.size, owners }
}
