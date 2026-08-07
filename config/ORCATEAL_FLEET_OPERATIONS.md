# OrcaTeal fleet operations

OrcaTeal is an internal, pinned fleet controller. It is not an automatically
updated mirror of upstream Orca.

## Production contract

- **Air Raid** is the paired desktop client.
- **Ultra Magnus** is the sole authoritative OrcaTeal runtime.
- Fleet terminals are Ultra-owned SSH relays to hosts such as Wheeljack,
  Perceptor, and Hot Rod.
- Official Orca is a local-only fallback on Air. It must not connect to Ultra's
  production runtime or the fleet SSH relays.
- Orca Dev and PR/test builds use disposable profiles and never connect to the
  production runtime or production SSH relays.
- The installed version, hashes, topology, and frozen relay limits are pinned
  in `config/orcateal-production.json`.

Run the gate before and after any operational change:

```bash
pnpm check:orcateal-fleet -- --ssh-key ~/.ssh/ratchet_fleet
```

The gate rejects version/hash drift, competing runtimes, abnormal paired
connections, unreachable fleet hosts, new SSH relay generations, orphaned live
terminals, and reconnect-created blank-terminal bursts.

A warning about a fallback daemon with a local child is informational. Preserve
that process. An empty fallback daemon is prunable after a profile snapshot and
one final child/PTY check. Any production-runtime connection from fallback Orca
is a hard failure.

Hot Rod temporarily retains four protected relay generations because they own
live Claude sessions. Four is a frozen ceiling, not a desired steady state.
Migrate each durable session at a stable handoff point and lower the limit after
the retired relay is verified empty.

## Upgrade policy

1. Keep the current production manifest frozen. Do not chase daily stable or RC
   releases.
2. Rebase the Teal source stack on an exact stable tag in a staging branch.
3. Run the strict patch-stack audit, focused patch tests, full typecheck/lint,
   production build, and signature/hash verification.
4. Install the candidate only in an isolated profile that cannot see the
   production runtime or fleet relays.
5. Exercise the candidate against disposable local and Docker/headless SSH
   fixtures first.
6. Snapshot the installed app and `~/Library/Application Support/orcateal` on
   Ultra and Air.
7. Deploy Ultra first, then Air. Never run old and new production UIs
   concurrently against the same relays.
8. Verify Air reload, Air full restart, Ultra restart, SSH reconnect, terminal
   close/reopen, fresh terminal streaming, and existing terminal input.
9. Run the fleet gate for 24 hours. One failed sample resets the soak.
10. Only after the soak passes, update the production manifest and move the
    archived stable branches with rollback refs preserved.

## Development and test isolation

Use the fresh-profile launcher for manual development:

```bash
./config/scripts/dev-fresh-profile.sh
```

Do not set `ORCA_DEV_USER_DATA_PATH`, `ORCA_USER_DATA_PATH`, or an Electron
`--user-data-dir` to `~/Library/Application Support/orcateal`. Do not import the
production project/host catalog into a test profile. A test that requires SSH
uses the repo's Docker/headless fixtures or a disposable host, not a live fleet
relay.

When a production-only reproduction is unavoidable, snapshot both profiles,
record every live PTY and durable agent session ID, stop the daily client first,
run exactly one test client, then restore the daily client before ending the
operation.

## Durable session recovery

The durable Claude/Codex session is the recovery contract. An Orca pane is not.

Before a risky restart or cleanup, record:

- host, repo path, branch, and current command;
- Orca relay PID/generation and PTY ID;
- Claude or Codex durable session ID;
- whether the process is active, idle, detached, or duplicated.

Recovery order:

1. If the current PTY is live and has one authoritative owner, attach or switch
   it to a new pane.
2. If ownership is conflicted, preserve one authoritative durable session,
   retire only empty/duplicate relay generations, and create one fresh terminal.
3. Resume Claude with `claude --resume <session-id>` or Codex with
   `codex resume <session-id>` from the original repo path.
4. Confirm one agent process, one visible pane, and real typed input from Air.
5. Never repeatedly click/open a stuck workspace; that can create duplicate
   resumes and PTYs.

For especially important long-running work, start the agent inside tmux or
zellij when available. That gives the shell its own persistence layer while
Orca remains the viewer/controller.

## Incident triage

Do not restart first. Capture:

```bash
pnpm check:orcateal-fleet -- --ssh-key ~/.ssh/ratchet_fleet --json
```

Then distinguish:

- Air renderer/view problem;
- Ultra tab/group or paired-socket ownership problem;
- stale relay generation on the SSH host;
- healthy PTY with a detached pane;
- actual SSH/Tailscale/host outage.

Prefer the smallest repair that preserves live work. Snapshot before mutation.
Deployment order is Ultra then Air; ordinary renderer recovery is Air-only when
the gate proves Ultra and the SSH relay are healthy.

## Rollback

Keep the previous app, profile snapshot, source commit, packaging commit,
artifact hash, and signing identity. A rollback restores the app and profile as
one matched pair, launches Ultra first, verifies its daemon protocol, then
launches Air and reruns the fleet gate.
