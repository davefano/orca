#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_POLICY = resolve(import.meta.dirname, '..', 'orcateal-production.json')

function lines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function uniqueNumbers(value) {
  return [...new Set(lines(value).map(Number).filter(Number.isInteger))]
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

export function parseLsofConnectionPids(value) {
  const connections = []
  let currentPid = null
  for (const field of lines(value)) {
    if (field.startsWith('p')) {
      currentPid = Number(field.slice(1))
    } else if (field.startsWith('f') && Number.isInteger(currentPid)) {
      connections.push(currentPid)
    }
  }
  return connections
}

export function countRelayGenerations(value) {
  return lines(value).filter((row) =>
    /(?:^|\s)(?:\S*\/)?node\s+relay[.]js\s+--detached(?:\s|$)/.test(row)
  ).length
}

function runSsh(target, command, { sshKey, timeoutSeconds = 8 } = {}) {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${timeoutSeconds}`,
    '-o',
    'IdentitiesOnly=yes'
  ]
  if (sshKey) {
    args.push('-i', sshKey)
  }
  args.push(target, command)
  return execFileSync('ssh', args, { encoding: 'utf8', timeout: (timeoutSeconds + 3) * 1000 })
}

function sshRunner(opts) {
  return opts.runSsh ?? runSsh
}

function parseProcessRows(value) {
  return lines(value).map((row) => {
    const match = row.match(/^(\d+)\s+(.+)$/)
    return match ? { pid: Number(match[1]), command: match[2] } : { pid: -1, command: row }
  })
}

function collectHost(policy, hostKey, opts) {
  const host = policy.hosts[hostKey]
  const server = `${policy.topology.serverAddress}:${policy.topology.serverPort}`
  const run = (command) => sshRunner(opts)(host.sshTarget, command, opts)
  const appVersion = run(
    "/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/OrcaTeal.app/Contents/Info.plist 2>/dev/null || true"
  ).trim()
  const appAsarSha256 = run(
    "shasum -a 256 /Applications/OrcaTeal.app/Contents/Resources/app.asar 2>/dev/null | awk '{print $1}'"
  ).trim()
  const daemonRows = parseProcessRows(
    run("pgrep -fal 'Application Support/orcateal/daemon/daemon-v[0-9]+[.]sock' || true")
  )
  const fallbackRows = parseProcessRows(
    run("pgrep -fal '/Applications/Orca[.]app/.*/daemon-entry[.]js' || true")
  )
  const fallbackDaemons = fallbackRows.map(({ pid }) => ({
    pid,
    liveChildren: uniqueNumbers(run(`pgrep -P ${pid} || true`)).length,
    pairedConnections: parseLsofConnectionPids(
      run(`lsof -a -p ${pid} -nP -iTCP@${server} -sTCP:ESTABLISHED -Fp 2>/dev/null || true`)
    ).length
  }))

  return {
    hostname: run('hostname').trim(),
    appVersion,
    appAsarSha256,
    orcaTealAppPids: uniqueNumbers(
      run("pgrep -f '^/Applications/OrcaTeal[.]app/Contents/MacOS/OrcaTeal$' || true")
    ),
    orcaTealDaemons: daemonRows.map(({ pid, command }) => ({
      pid,
      protocol: Number(command.match(/daemon-v(\d+)[.]sock/)?.[1] ?? -1)
    })),
    productionPortListenerPids: uniqueNumbers(
      run(
        `lsof -nP -iTCP:${policy.topology.serverPort} -sTCP:LISTEN -Fp 2>/dev/null | sed 's/^p//'`
      )
    ),
    pairedConnectionPids: parseLsofConnectionPids(
      run(`lsof -nP -iTCP@${server} -sTCP:ESTABLISHED -Fp 2>/dev/null || true`)
    ),
    forbiddenUiProcesses: parseProcessRows(
      run(
        "pgrep -fal '^/Applications/(Orca Dev|Orca PR|OrcaTeal Dev)[^/]*/Contents/MacOS/' || true"
      )
    ).map(({ pid, command }) => ({
      pid,
      label: command.match(/Applications\/([^.]*)[.]app/)?.[1] ?? command
    })),
    fallbackDaemons
  }
}

function failedHostSnapshot(error) {
  return {
    collectionError: String(error.message).split('\n')[0],
    hostname: '',
    appVersion: '',
    appAsarSha256: '',
    orcaTealAppPids: [],
    orcaTealDaemons: [],
    productionPortListenerPids: [],
    pairedConnectionPids: [],
    forbiddenUiProcesses: [],
    fallbackDaemons: []
  }
}

function collectHostSafely(policy, hostKey, opts) {
  try {
    return collectHost(policy, hostKey, opts)
  } catch (error) {
    return failedHostSnapshot(error)
  }
}

function collectSshTargets(policy, opts) {
  const ultra = policy.hosts[policy.topology.authoritativeRuntime]
  const run = sshRunner(opts)
  return Object.fromEntries(
    policy.topology.requiredSshTargets.map((target) => {
      if (!/^[A-Za-z0-9._-]+$/.test(target)) {
        throw new Error(`Unsafe SSH alias: ${target}`)
      }
      try {
        run(
          ultra.sshTarget,
          `ssh -o BatchMode=yes -o ConnectTimeout=6 ${target} 'printf ORCATEAL_SSH_OK'`,
          { ...opts, timeoutSeconds: 10 }
        )
        const relayProcesses = run(
          ultra.sshTarget,
          `ssh -o BatchMode=yes -o ConnectTimeout=6 ${target} 'ps -axo command='`,
          { ...opts, timeoutSeconds: 10 }
        )
        const relayGenerations = countRelayGenerations(relayProcesses)
        return [
          target,
          {
            reachable: true,
            relayGenerations
          }
        ]
      } catch (error) {
        return [target, { reachable: false, error: String(error.message).split('\n')[0] }]
      }
    })
  )
}

function collectTerminalInventory(policy, opts) {
  const air = policy.hosts[policy.topology.pairedClient]
  const app = '/Applications/OrcaTeal.app'
  const executable = `${app}/Contents/MacOS/OrcaTeal`
  const cli = `${app}/Contents/Resources/app.asar.unpacked/out/cli/index.js`
  const command = [
    'ORCA_USER_DATA_PATH="$HOME/Library/Application Support/orcateal"',
    'ELECTRON_RUN_AS_NODE=1',
    shellQuote(executable),
    shellQuote(cli),
    'terminal',
    'list',
    '--limit',
    '1000',
    '--environment',
    shellQuote(policy.topology.environmentName),
    '--json'
  ].join(' ')
  try {
    const response = JSON.parse(
      sshRunner(opts)(air.sshTarget, command, { ...opts, timeoutSeconds: 15 })
    )
    if (response.ok !== true || !Array.isArray(response.result?.terminals)) {
      throw new Error('terminal list returned an invalid response')
    }
    return {
      terminals: response.result.terminals,
      totalCount: response.result.totalCount,
      truncated: response.result.truncated
    }
  } catch (error) {
    return { terminals: [], error: String(error.message).split('\n')[0] }
  }
}

export function collectFleetSnapshot(policy, opts = {}) {
  const hostKeys = [
    ...new Set([policy.topology.authoritativeRuntime, policy.topology.pairedClient])
  ]
  return {
    capturedAt: new Date().toISOString(),
    hosts: Object.fromEntries(
      hostKeys.map((hostKey) => [hostKey, collectHostSafely(policy, hostKey, opts)])
    ),
    sshTargets: collectSshTargets(policy, opts),
    terminalInventory: collectTerminalInventory(policy, opts)
  }
}

export function evaluateFleetSnapshot(policy, snapshot) {
  const errors = []
  const warnings = []
  for (const [hostKey, host] of Object.entries(snapshot.hosts)) {
    if (host.collectionError) {
      errors.push(`${hostKey}: collection failed (${host.collectionError})`)
      continue
    }
    if (host.appVersion !== policy.release.appVersion) {
      errors.push(
        `${hostKey}: expected app version ${policy.release.appVersion}, found ${host.appVersion || 'missing'}`
      )
    }
    if (host.appAsarSha256 !== policy.release.appAsarSha256) {
      errors.push(`${hostKey}: installed app.asar hash does not match the freeze`)
    }
    if (host.orcaTealAppPids.length !== 1) {
      errors.push(`${hostKey}: expected one OrcaTeal UI, found ${host.orcaTealAppPids.length}`)
    }
    if (host.orcaTealDaemons.length !== 1) {
      errors.push(
        `${hostKey}: expected one OrcaTeal daemon generation, found ${host.orcaTealDaemons.length}`
      )
    } else if (host.orcaTealDaemons[0].protocol !== policy.release.daemonProtocol) {
      errors.push(
        `${hostKey}: expected daemon protocol v${policy.release.daemonProtocol}, found v${host.orcaTealDaemons[0].protocol}`
      )
    }
    for (const process of host.forbiddenUiProcesses) {
      errors.push(`${hostKey}: competing UI is running: ${process.label} (pid ${process.pid})`)
    }
    for (const daemon of host.fallbackDaemons) {
      if (daemon.pairedConnections > 0) {
        errors.push(
          `${hostKey}: fallback Orca daemon ${daemon.pid} has ${daemon.pairedConnections} production-runtime connection(s)`
        )
      } else if (daemon.liveChildren > 0) {
        warnings.push(
          `${hostKey}: fallback Orca daemon ${daemon.pid} owns ${daemon.liveChildren} local child process; preserved as local-only`
        )
      } else {
        warnings.push(`${hostKey}: empty fallback Orca daemon ${daemon.pid} is prunable`)
      }
    }
  }

  const ultra = snapshot.hosts[policy.topology.authoritativeRuntime]
  if (!ultra.collectionError && ultra.productionPortListenerPids.length !== 1) {
    errors.push(
      `${policy.topology.authoritativeRuntime}: expected one listener on port ${policy.topology.serverPort}, found ${ultra.productionPortListenerPids.length}`
    )
  } else if (
    !ultra.collectionError &&
    ultra.productionPortListenerPids.some((pid) => !ultra.orcaTealAppPids.includes(pid))
  ) {
    errors.push(
      `${policy.topology.authoritativeRuntime}: production listener is not owned by OrcaTeal`
    )
  }
  const air = snapshot.hosts[policy.topology.pairedClient]
  if (
    !air.collectionError &&
    air.pairedConnectionPids.length !== policy.topology.expectedPairedConnections
  ) {
    errors.push(
      `${policy.topology.pairedClient}: expected ${policy.topology.expectedPairedConnections} paired connections to Ultra, found ${air.pairedConnectionPids.length}`
    )
  } else if (
    !air.collectionError &&
    air.pairedConnectionPids.some((pid) => !air.orcaTealAppPids.includes(pid))
  ) {
    errors.push(`${policy.topology.pairedClient}: paired connection is not owned by OrcaTeal`)
  }
  for (const target of policy.topology.requiredSshTargets) {
    const result = snapshot.sshTargets[target]
    if (!result?.reachable) {
      errors.push(`ssh: ${target} is unreachable from Ultra (${result?.error ?? 'no result'})`)
    } else {
      const relayLimit =
        policy.topology.maxRelayGenerationsByTarget?.[target] ??
        policy.topology.maxRelayGenerationsPerTarget
      if (result.relayGenerations > relayLimit) {
        errors.push(
          `ssh: ${target} has ${result.relayGenerations} relay generations (limit ${relayLimit})`
        )
      } else if (result.relayGenerations > 1) {
        warnings.push(
          `ssh: ${target} retains ${result.relayGenerations} protected relay generations within its frozen limit`
        )
      } else if (!Number.isInteger(result.relayGenerations) || result.relayGenerations < 0) {
        errors.push(`ssh: ${target} returned an invalid relay-generation count`)
      }
    }
  }

  if (snapshot.terminalInventory?.error) {
    errors.push(`terminals: inventory failed (${snapshot.terminalInventory.error})`)
  } else if (snapshot.terminalInventory?.truncated) {
    errors.push(
      `terminals: inventory was truncated (${snapshot.terminalInventory.terminals.length}/${snapshot.terminalInventory.totalCount})`
    )
  } else {
    const liveTerminals = (snapshot.terminalInventory?.terminals ?? []).filter(
      (terminal) => terminal.connected
    )
    const orphaned = liveTerminals.filter((terminal) => terminal.orphaned)
    if (orphaned.length > 0) {
      errors.push(`terminals: found ${orphaned.length} orphaned live terminal(s)`)
    }
    const blankByWorktree = new Map()
    for (const terminal of liveTerminals) {
      if (terminal.writable && !terminal.title && !terminal.preview) {
        blankByWorktree.set(
          terminal.worktreeId,
          (blankByWorktree.get(terminal.worktreeId) ?? 0) + 1
        )
      }
    }
    for (const [worktreeId, count] of blankByWorktree) {
      if (count > policy.topology.maxBlankTerminalsPerWorktree) {
        errors.push(
          `terminals: worktree ${worktreeId} has ${count} blank live terminals (limit ${policy.topology.maxBlankTerminalsPerWorktree})`
        )
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings }
}

export function parseArgs(argv) {
  const opts = { policyPath: DEFAULT_POLICY, samples: 1, intervalSeconds: 30, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--policy') {
      opts.policyPath = resolve(argv[++index])
    } else if (arg === '--ssh-key') {
      opts.sshKey = resolve(argv[++index].replace(/^~\//, `${process.env.HOME}/`))
    } else if (arg === '--samples') {
      opts.samples = Number(argv[++index])
    } else if (arg === '--interval-seconds') {
      opts.intervalSeconds = Number(argv[++index])
    } else if (arg === '--json') {
      opts.json = true
    } else if (arg === '--help') {
      opts.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!Number.isInteger(opts.samples) || opts.samples < 1) {
    throw new Error('--samples must be a positive integer')
  }
  if (!Number.isFinite(opts.intervalSeconds) || opts.intervalSeconds < 0) {
    throw new Error('--interval-seconds must be non-negative')
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(
      'Usage: node config/scripts/orcateal-fleet-gate.mjs [--samples N] [--interval-seconds N] [--ssh-key PATH] [--json]'
    )
    return
  }
  const policy = JSON.parse(readFileSync(opts.policyPath, 'utf8'))
  const samples = []
  for (let index = 0; index < opts.samples; index += 1) {
    const snapshot = collectFleetSnapshot(policy, opts)
    samples.push({ snapshot, evaluation: evaluateFleetSnapshot(policy, snapshot) })
    if (index + 1 < opts.samples) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, opts.intervalSeconds * 1000))
    }
  }
  const ok = samples.every((sample) => sample.evaluation.ok)
  if (opts.json) {
    console.log(JSON.stringify({ ok, policy: opts.policyPath, samples }, null, 2))
  } else {
    for (const [index, sample] of samples.entries()) {
      console.log(
        `[orcateal-fleet-gate] sample ${index + 1}/${samples.length}: ${sample.evaluation.ok ? 'PASS' : 'FAIL'}`
      )
      for (const warning of sample.evaluation.warnings) {
        console.log(`WARN ${warning}`)
      }
      for (const error of sample.evaluation.errors) {
        console.error(`FAIL ${error}`)
      }
    }
  }
  if (!ok) {
    process.exitCode = 1
  }
}

if (process.argv[1] === import.meta.filename) {
  await main()
}
