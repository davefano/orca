# Teal Orca Patch Stack

OrcaTeal's coding-server release line is pinned to upstream **v1.4.176**.
Release candidates and later upstream releases are review sources, not
daily-driver bases.

The daily fleet does not automatically follow every stable release. The exact
deployed artifact remains frozen in
[`orcateal-production.json`](./orcateal-production.json) until Dave explicitly
approves a promoted replacement after the burn-in gate passes.

The machine-readable authority is [`teal-patch-stack.json`](./teal-patch-stack.json).
Run this before and after every selective upstream import:

```bash
pnpm verify:teal-patch-stack -- --base v1.4.176 --strict
```

The audit checks patch order, required files, excluded patches, and exact
patch-id equivalence against the selected upstream base. An upstream-equivalent
result is a required review stop: remove the Teal patch or document why the
upstream implementation does not satisfy the fleet workflow.

The manifest also carries an upstream watchlist for dependency-heavy fixes we
must not lose sight of but should not transplant casually. Each selective
import reports whether those donor commits are already ancestors of the base
and whether the current Teal implementation is patch-equivalent.

## Maintained branch

- `teal/coding-server-v1.4.176`: the only coding-server release branch. It
  includes isolated OrcaTeal packaging, mobile support, paired-runtime
  ownership hardening, and the windowless runtime graph.

Do not rebase this branch. Do not build daily artifacts from temporary reset,
PR, release-candidate, or historical `teal/coding-server` branches.

## Release procedure

1. Start a short-lived review branch from `teal/coding-server-v1.4.176`.
2. Cherry-pick only the upstream commit needed for a confirmed coding-server or
   mobile defect. Never merge or rebase upstream wholesale.
3. Run the patch audit against `v1.4.176` and review every conflict or
   `upstream-equivalent` result.
4. Run the imported patch's focused verification and the complete source gates.
5. Build one signed OrcaTeal artifact from the reviewed branch.
6. Snapshot the Air and Ultra apps and profiles. Deploy Ultra first, then Air.
7. Verify Air UI -> Ultra runtime -> at least three fleet SSH hosts, including
   reconnect and fresh-terminal streaming. Air -> Ultra -> Air is not a release
   requirement.
8. Record base, commits, artifact hashes, snapshots, and smoke results in the
   Orca operations runbook and durable memory.
9. Fast-forward `teal/coding-server-v1.4.176` only after the live gate passes.

## Production freeze and burn-in

Run the live gate from a fleet machine with the Ratchet SSH key:

```bash
pnpm check:orcateal-fleet -- --ssh-key ~/.ssh/ratchet_fleet
```

The gate fails on build/hash drift, duplicate OrcaTeal daemon generations,
competing Dev/PR UIs, non-Teal Orca daemons connected to the production
runtime, an abnormal Air-to-Ultra paired connection count, a failed
Ultra-to-fleet SSH smoke, a new relay generation above its frozen ceiling, an
orphaned terminal, or a reconnect-created blank-terminal burst.

Before replacing the frozen build, run a minimum 24-hour soak at five-minute
intervals:

```bash
pnpm check:orcateal-fleet -- --ssh-key ~/.ssh/ratchet_fleet \
  --samples 288 --interval-seconds 300
```

Any failed sample resets the soak. Do not move the stable branches, publish an
artifact, or deploy a new version until the complete soak is green and the
manual restart/reconnect checks in
[`ORCATEAL_FLEET_OPERATIONS.md`](./ORCATEAL_FLEET_OPERATIONS.md)
pass.

## Deliberate exclusions

- PTY health is read-only in the daily build. Automatic pruning is excluded.
- The historical broad terminal-recovery patch is excluded; upstream owns that
  subsystem now.
- Client workspace isolation is excluded until a focused Air/Ultra reproduction
  proves stable upstream still needs it.
- Paired-terminal recovery PRs #11005, #11416, and #11513 are included in
  `v1.4.175`. The same stable base also carries the host-surface, rejected-input,
  path-owner, and host-partition fixes tracked by
  `paired-runtime-pane-ownership-recovery`. Keep both watch items until the
  packaged Air -> Ultra -> fleet reconnect and restart smoke passes; do not
  carry a Teal replacement patch.
