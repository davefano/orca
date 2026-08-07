import { describe, expect, it } from 'vitest'
import {
  collectFleetSnapshot,
  countRelayGenerations,
  evaluateFleetSnapshot,
  parseArgs,
  parseLsofConnectionPids
} from './orcateal-fleet-gate.mjs'

const policy = {
  release: {
    appVersion: '1.4.176-local.test',
    appAsarSha256: 'abc123',
    daemonProtocol: 32
  },
  topology: {
    authoritativeRuntime: 'ultraMagnus',
    pairedClient: 'airRaid',
    serverPort: 51000,
    expectedPairedConnections: 2,
    requiredSshTargets: ['wheeljack', 'perceptor', 'hotrod'],
    maxBlankTerminalsPerWorktree: 1,
    maxRelayGenerationsPerTarget: 1,
    maxRelayGenerationsByTarget: { hotrod: 4 }
  }
}

const healthySnapshot = {
  hosts: {
    ultraMagnus: {
      hostname: 'ultra-magnus',
      appVersion: '1.4.176-local.test',
      appAsarSha256: 'abc123',
      orcaTealAppPids: [100],
      orcaTealDaemons: [{ pid: 101, protocol: 32 }],
      productionPortListenerPids: [100],
      pairedConnectionPids: [],
      forbiddenUiProcesses: [],
      fallbackDaemons: []
    },
    airRaid: {
      hostname: 'air-raid',
      appVersion: '1.4.176-local.test',
      appAsarSha256: 'abc123',
      orcaTealAppPids: [200],
      orcaTealDaemons: [{ pid: 201, protocol: 32 }],
      productionPortListenerPids: [],
      pairedConnectionPids: [200, 200],
      forbiddenUiProcesses: [],
      fallbackDaemons: [{ pid: 250, liveChildren: 1, pairedConnections: 0 }]
    }
  },
  sshTargets: {
    wheeljack: { reachable: true, relayGenerations: 1 },
    perceptor: { reachable: true, relayGenerations: 1 },
    hotrod: { reachable: true, relayGenerations: 1 }
  },
  terminalInventory: {
    terminals: [
      {
        ptyId: 'ssh:perceptor@@pty-2',
        worktreeId: 'repo::/Users/daveagent/workspaces/teal',
        orphaned: false,
        connected: true,
        writable: true,
        title: 'Claude Code',
        preview: 'Ready'
      }
    ]
  }
}

describe('evaluateFleetSnapshot', () => {
  it('accepts the pnpm argument separator used by the runbook', () => {
    expect(parseArgs(['--', '--samples', '2', '--interval-seconds', '0'])).toMatchObject({
      samples: 2,
      intervalSeconds: 0
    })
  })

  it('counts lsof descriptors without mistaking field rows for connections', () => {
    expect(parseLsofConnectionPids('p51101\nf39\nf85\nf86\n')).toEqual([51101, 51101, 51101])
  })

  it('counts only detached Node relay generations, not launcher shells', () => {
    expect(
      countRelayGenerations(
        [
          "/bin/sh -c nohup '/opt/node' relay.js --detached &",
          '/opt/node relay.js --detached --sock-path current.sock',
          '/usr/bin/node unrelated.js'
        ].join('\n')
      )
    ).toBe(1)
  })

  it('accepts the frozen build and authoritative Air to Ultra topology', () => {
    const result = evaluateFleetSnapshot(policy, healthySnapshot)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toContain(
      'airRaid: fallback Orca daemon 250 owns 1 local child process; preserved as local-only'
    )
  })

  it('rejects build drift and duplicate paired connections', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.hosts.airRaid.appVersion = '1.4.177-local.unvetted'
    snapshot.hosts.airRaid.appAsarSha256 = 'different'
    snapshot.hosts.airRaid.pairedConnectionPids.push(200)

    const result = evaluateFleetSnapshot(policy, snapshot)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'airRaid: expected app version 1.4.176-local.test, found 1.4.177-local.unvetted'
    )
    expect(result.errors).toContain('airRaid: installed app.asar hash does not match the freeze')
    expect(result.errors).toContain('airRaid: expected 2 paired connections to Ultra, found 3')
  })

  it('rejects duplicate daemon generations and competing Orca UIs', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.hosts.ultraMagnus.orcaTealDaemons.push({ pid: 102, protocol: 30 })
    snapshot.hosts.ultraMagnus.forbiddenUiProcesses.push({ pid: 103, label: 'Orca Dev' })

    const result = evaluateFleetSnapshot(policy, snapshot)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('ultraMagnus: expected one OrcaTeal daemon generation, found 2')
    expect(result.errors).toContain('ultraMagnus: competing UI is running: Orca Dev (pid 103)')
  })

  it('rejects a fallback daemon connected to the production runtime', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.hosts.airRaid.fallbackDaemons[0].pairedConnections = 1

    const result = evaluateFleetSnapshot(policy, snapshot)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'airRaid: fallback Orca daemon 250 has 1 production-runtime connection(s)'
    )
  })

  it('requires the fleet SSH smokes defined by policy', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.sshTargets.perceptor = { reachable: false, error: 'timeout' }

    const result = evaluateFleetSnapshot(policy, snapshot)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('ssh: perceptor is unreachable from Ultra (timeout)')
  })

  it('rejects orphaned terminals and reconnect-created blank terminal bursts', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.terminalInventory.terminals = [
      {
        ptyId: 'ssh:perceptor@@pty-2',
        worktreeId: 'repo::/Users/daveagent/workspaces/teal',
        orphaned: true,
        connected: true,
        writable: true,
        title: null,
        preview: ''
      },
      {
        ptyId: 'ssh:perceptor@@pty-3',
        worktreeId: 'repo::/Users/daveagent/workspaces/teal',
        orphaned: false,
        connected: true,
        writable: true,
        title: null,
        preview: ''
      }
    ]

    const result = evaluateFleetSnapshot(policy, snapshot)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('terminals: found 1 orphaned live terminal(s)')
    expect(result.errors).toContain(
      'terminals: worktree repo::/Users/daveagent/workspaces/teal has 2 blank live terminals (limit 1)'
    )
  })

  it('rejects multiple relay generations on one SSH target', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.sshTargets.perceptor.relayGenerations = 2

    const result = evaluateFleetSnapshot(policy, snapshot)

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('ssh: perceptor has 2 relay generations (limit 1)')
  })

  it('allows the frozen Hot Rod relay ceiling and rejects a new generation', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.sshTargets.hotrod.relayGenerations = 4

    const frozen = evaluateFleetSnapshot(policy, snapshot)
    expect(frozen.ok).toBe(true)
    expect(frozen.warnings).toContain(
      'ssh: hotrod retains 4 protected relay generations within its frozen limit'
    )

    snapshot.sshTargets.hotrod.relayGenerations = 5
    const drifted = evaluateFleetSnapshot(policy, snapshot)
    expect(drifted.ok).toBe(false)
    expect(drifted.errors).toContain('ssh: hotrod has 5 relay generations (limit 4)')
  })

  it('rejects invalid relay counts and truncated terminal inventories', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.sshTargets.perceptor.relayGenerations = -1
    snapshot.terminalInventory = { terminals: [], totalCount: 1200, truncated: true }

    const result = evaluateFleetSnapshot(policy, snapshot)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('ssh: perceptor returned an invalid relay-generation count')
    expect(result.errors).toContain('terminals: inventory was truncated (0/1200)')
  })

  it('rejects listener and paired sockets owned by foreign processes', () => {
    const snapshot = structuredClone(healthySnapshot)
    snapshot.hosts.ultraMagnus.productionPortListenerPids = [999]
    snapshot.hosts.airRaid.pairedConnectionPids = [200, 999]

    const result = evaluateFleetSnapshot(policy, snapshot)
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('ultraMagnus: production listener is not owned by OrcaTeal')
    expect(result.errors).toContain('airRaid: paired connection is not owned by OrcaTeal')
  })

  it('collects policy-selected hosts and representative live command output', () => {
    const customPolicy = structuredClone(policy)
    customPolicy.hosts = {
      controller: { sshTarget: 'ultra-ssh' },
      client: { sshTarget: 'air-ssh' }
    }
    customPolicy.topology.authoritativeRuntime = 'controller'
    customPolicy.topology.pairedClient = 'client'
    customPolicy.topology.serverAddress = '100.65.239.16'
    customPolicy.topology.environmentName = 'Ultra Magnus'

    const runSsh = (target, command) => {
      if (command.includes('PlistBuddy')) {
        return `${policy.release.appVersion}\n`
      }
      if (command.includes('shasum')) {
        return `${policy.release.appAsarSha256}\n`
      }
      if (command.includes("pgrep -fal 'Application Support/orcateal")) {
        return `101 node daemon-entry.js daemon-v${policy.release.daemonProtocol}.sock\n`
      }
      if (command.includes("pgrep -fal '/Applications/Orca[.]app")) {
        return ''
      }
      if (command === 'hostname') {
        return `${target}\n`
      }
      if (command.includes("pgrep -f '^/Applications/OrcaTeal")) {
        return target === 'ultra-ssh' ? '100\n' : '200\n'
      }
      if (command.includes('-sTCP:LISTEN')) {
        return target === 'ultra-ssh' ? '100\n' : ''
      }
      if (command.includes('-sTCP:ESTABLISHED')) {
        return target === 'air-ssh' ? 'p200\nf39\nf85\n' : ''
      }
      if (command.includes("pgrep -fal '^/Applications/(Orca Dev")) {
        return ''
      }
      if (command.includes("'printf ORCATEAL_SSH_OK'")) {
        return 'ORCATEAL_SSH_OK'
      }
      if (command.includes("'ps -axo command='")) {
        return '/usr/bin/node relay.js --detached --sock-path current.sock\n'
      }
      if (command.includes('terminal list')) {
        return JSON.stringify({
          ok: true,
          result: {
            terminals: healthySnapshot.terminalInventory.terminals,
            totalCount: 1,
            truncated: false
          }
        })
      }
      throw new Error(`unexpected command for ${target}: ${command}`)
    }

    const snapshot = collectFleetSnapshot(customPolicy, { runSsh })
    expect(Object.keys(snapshot.hosts)).toEqual(['controller', 'client'])
    const evaluation = evaluateFleetSnapshot(customPolicy, snapshot)
    expect(evaluation.errors).toEqual([])
    expect(evaluation.ok).toBe(true)
  })

  it('turns a host SSH outage into a structured failing snapshot', () => {
    const customPolicy = structuredClone(policy)
    customPolicy.hosts = {
      ultraMagnus: { sshTarget: 'ultra-ssh' },
      airRaid: { sshTarget: 'air-ssh' }
    }
    customPolicy.topology.serverAddress = '100.65.239.16'
    customPolicy.topology.environmentName = 'Ultra Magnus'

    const snapshot = collectFleetSnapshot(customPolicy, {
      runSsh: () => {
        throw new Error('ssh timeout')
      }
    })
    const result = evaluateFleetSnapshot(customPolicy, snapshot)

    expect(snapshot.hosts.ultraMagnus.collectionError).toBe('ssh timeout')
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('ultraMagnus: collection failed (ssh timeout)')
    expect(result.errors).toContain('airRaid: collection failed (ssh timeout)')
  })
})
