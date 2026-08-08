# Teal Orca Patch Stack

OrcaTeal is a maintained coding-server fork pinned to the known-good upstream
`v1.4.173` base. Upstream releases are donor sources, not automatic upgrade
targets. Daily builds move only when a selected upstream commit passes the full
Air/mobile -> Ultra -> fleet SSH continuity matrix.

The machine-readable authority is [`teal-patch-stack.json`](./teal-patch-stack.json).
Run this before every release and after every selective upstream cherry-pick:

```bash
pnpm verify:teal-patch-stack -- --base vX.Y.Z --strict
```

The audit checks patch order, required files, excluded patches, and exact
patch-id equivalence against the selected upstream base. An upstream-equivalent
result is a required review stop: remove the Teal patch or document why the
upstream implementation does not satisfy the fleet workflow.

The manifest also carries an upstream watchlist for dependency-heavy fixes we
may evaluate later. Never rebase the maintained branch onto a newer upstream
release. Test candidate commits on a disposable evaluation branch and
cherry-pick only the commits we explicitly choose to own.

## Maintained branch

- `teal/coding-server`: pinned source patches, isolated OrcaTeal packaging,
  paired desktop support, and the mobile web client.

Do not build daily artifacts from upstream, temporary reset, PR, rebase, or
evaluation branches.

## Release procedure

1. Start from `teal/coding-server`; never rebase it onto upstream.
2. When an upstream change is wanted, create a disposable evaluation branch,
   cherry-pick the smallest complete dependency chain, and run the patch audit.
3. Run every manifest verification command. Window close/reopen must preserve
   the same remote PTY and shell PID for a paired client.
4. Run the complete source verification gates and build one signed artifact.
5. Snapshot the Air and Ultra apps and profiles. Deploy the exact same artifact
   to Ultra first, then Air. Do not restart fleet relays, PTYs, or agents.
6. Verify Air UI -> Ultra runtime -> HotRod, Perceptor, and one fleet Mac,
   including app switching, Ultra window close/reopen, reconnect, typing, and
   fresh-terminal streaming. Verify the mobile web client against Ultra too.
7. Record base, commits, artifact hashes, snapshots, and smoke results in the
   Orca operations runbook and durable memory.

## Deliberate exclusions

- PTY health is read-only in the daily build. Automatic pruning is excluded.
- The historical broad terminal-recovery patch is excluded; upstream owns that
  subsystem now.
- Client workspace isolation is excluded until a focused Air/Ultra reproduction
  proves stable upstream still needs it.
- Paired-terminal recovery PRs #11005, #11416, and #11513 are included in
  `v1.4.173`, but they do not preserve runtime graph authority when Ultra's
  desktop window closes. The Teal windowless-authority patch owns that gap.
