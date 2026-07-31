# Teal Orca Patch Stack

OrcaTeal tracks the latest **stable** upstream Orca release. Release candidates
are test targets, not daily-driver bases.

The machine-readable authority is [`teal-patch-stack.json`](./teal-patch-stack.json).
Run this before and after every rebase:

```bash
pnpm verify:teal-patch-stack -- --base vX.Y.Z --strict
```

The audit checks patch order, required files, excluded patches, and exact
patch-id equivalence against the selected upstream base. An upstream-equivalent
result is a required review stop: remove the Teal patch or document why the
upstream implementation does not satisfy the fleet workflow.

The manifest also carries an upstream watchlist for dependency-heavy fixes we
must not lose sight of but should not transplant casually. Each stable rebase
reports whether those donor commits are now ancestors of the base and whether
the current Teal implementation is patch-equivalent.

## Maintained branches

- `teal/orca-stable`: stable upstream plus behavior patches.
- `teal/orcateal-stable`: `teal/orca-stable` plus isolated OrcaTeal packaging.

Do not build daily artifacts from temporary reset, PR, or release-candidate
branches.

## Release procedure

1. Fetch upstream tags and identify the newest non-prerelease tag.
2. Create a staging branch from that tag.
3. Run the patch audit against the new tag before applying Teal commits.
4. Review every `upstream-equivalent` result and every conflict. Never restore
   old terminal-routing or recovery code solely because it existed previously.
   Review every watch item too: promote it only when the complete dependency
   chain is in stable, or when a focused production reproduction justifies a
   small reviewed backport.
5. Apply the source patches in manifest order and run each patch's focused
   verification command.
6. Run the complete source verification gates.
7. Apply OrcaTeal packaging on the packaging branch and build one signed
   artifact.
8. Snapshot the Air and Ultra apps and profiles. Deploy Ultra first, then Air.
9. Verify Air UI -> Ultra runtime -> at least three fleet SSH hosts, including
   reconnect and fresh-terminal streaming. Air -> Ultra -> Air is not a release
   requirement.
10. Record tag, commits, artifact hashes, snapshots, and smoke results in the
    Orca operations runbook and durable memory.

## Deliberate exclusions

- PTY health is read-only in the daily build. Automatic pruning is excluded.
- The historical broad terminal-recovery patch is excluded; upstream owns that
  subsystem now.
- Client workspace isolation is excluded until a focused Air/Ultra reproduction
  proves stable upstream still needs it.
- Paired-terminal recovery PRs #11005, #11416, and #11513 remain on the
  upstream watchlist for `v1.4.162`. Their subsystem-sized dependency chain is
  intentionally not cherry-picked into the daily stable build.
