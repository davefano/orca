import React, { useState } from 'react'
import { ChevronDown, ChevronRight, LoaderCircle, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { PtyOwnerSnapshot, SshPtyHealthResult } from '../../../../shared/ssh-types'

type PruneCandidate = {
  targetId: string
  targetLabel: string
  owner: PtyOwnerSnapshot
}

function dispositionLabel(owner: PtyOwnerSnapshot): string {
  if (owner.disposition === 'safe') {
    return 'Safe to prune'
  }
  if (owner.disposition === 'recover-first') {
    return 'Recover first'
  }
  if (owner.isCurrentRelay) {
    return 'Current relay'
  }
  return 'Protected'
}

function ownerLabel(owner: PtyOwnerSnapshot): string {
  if (owner.category === 'orca-relay') {
    return `Orca relay · PID ${owner.pid}`
  }
  if (owner.category === 'agent') {
    return `Agent PTY host · PID ${owner.pid}`
  }
  if (owner.category === 'terminal') {
    return `Terminal.app · PID ${owner.pid}`
  }
  return `Process · PID ${owner.pid}`
}

function healthSummary(result: SshPtyHealthResult): string {
  const health = result.health
  if (health?.systemAllocated !== null && health?.systemCapacity !== null && health) {
    return `${health.systemAllocated}/${health.systemCapacity} PTYs · ${health.systemAvailable} free`
  }
  return result.error ?? health?.diagnosticError ?? `${health?.relayOwned ?? 0} Orca PTYs`
}

export function SshPtyHealthPanel({
  results,
  loading,
  onRefresh,
  onPrune
}: {
  results: SshPtyHealthResult[]
  loading: boolean
  onRefresh: () => void
  onPrune: (targetId: string, ownerId: string) => Promise<void>
}): React.JSX.Element | null {
  const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set())
  const [pruneCandidate, setPruneCandidate] = useState<PruneCandidate | null>(null)
  const [pruning, setPruning] = useState(false)
  const [pruneError, setPruneError] = useState<string | null>(null)

  if (results.length === 0 && !loading) {
    return null
  }

  const toggleTarget = (targetId: string): void => {
    setExpandedTargets((current) => {
      const next = new Set(current)
      if (next.has(targetId)) {
        next.delete(targetId)
      } else {
        next.add(targetId)
      }
      return next
    })
  }

  const runPrune = async (): Promise<void> => {
    if (!pruneCandidate) {
      return
    }
    setPruning(true)
    setPruneError(null)
    try {
      await onPrune(pruneCandidate.targetId, pruneCandidate.owner.ownerId)
      setPruneCandidate(null)
      onRefresh()
    } catch (error) {
      setPruneError(error instanceof Error ? error.message : String(error))
    } finally {
      setPruning(false)
    }
  }

  return (
    <>
      <div className="border-b border-border px-3 py-2 text-[10px]">
        <div className="mb-1.5 flex items-center justify-between uppercase tracking-wide text-muted-foreground">
          <span>SSH PTY health</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded p-0.5 transition-colors hover:bg-accent disabled:opacity-40"
            aria-label="Refresh SSH PTY health"
          >
            <RotateCw className={cn('size-3', loading && 'animate-spin')} />
          </button>
        </div>
        <div className="space-y-1">
          {results.map((result) => {
            const health = result.health
            const expanded = expandedTargets.has(result.targetId)
            const owners = health?.owners ?? []
            const tone =
              health?.pressure === 'critical'
                ? 'text-destructive'
                : health?.pressure === 'warning'
                  ? 'text-yellow-500'
                  : 'text-muted-foreground'
            return (
              <div key={result.targetId} className="rounded border border-border/50">
                <button
                  type="button"
                  onClick={() => toggleTarget(result.targetId)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-accent/50"
                  aria-label={`${expanded ? 'Hide' : 'Show'} ${result.label} PTY owners`}
                  aria-expanded={expanded}
                >
                  <span className="flex min-w-0 items-center gap-1 text-foreground">
                    {expanded ? (
                      <ChevronDown className="size-3 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0" />
                    )}
                    <span className="truncate">{result.label}</span>
                  </span>
                  <span className={cn('shrink-0 tabular-nums', tone)}>{healthSummary(result)}</span>
                </button>
                {expanded && owners.length > 0 && (
                  <div className="border-t border-border/50">
                    {owners.map((owner) => (
                      <div
                        key={owner.ownerId}
                        className="flex items-center justify-between gap-2 border-b border-border/30 px-2 py-1 last:border-b-0"
                        title={owner.reason}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">
                            {ownerLabel(owner)}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {owner.allocationCount} allocated · {owner.attachedPtyCount} attached ·{' '}
                            {owner.leakedPtyCount} leaked
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              'rounded px-1 py-0.5',
                              owner.disposition === 'safe'
                                ? 'bg-primary/10 text-primary'
                                : owner.disposition === 'recover-first'
                                  ? 'bg-yellow-500/10 text-yellow-500'
                                  : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {dispositionLabel(owner)}
                          </span>
                          {owner.disposition === 'safe' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPruneError(null)
                                setPruneCandidate({
                                  targetId: result.targetId,
                                  targetLabel: result.label,
                                  owner
                                })
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Prune safe relay PID ${owner.pid}`}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <Dialog
        open={pruneCandidate !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !pruning) {
            setPruneCandidate(null)
            setPruneError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Prune idle PTYs on {pruneCandidate?.targetLabel}?</DialogTitle>
            <DialogDescription>
              This sends SIGTERM only after the host rechecks that relay PID{' '}
              {pruneCandidate?.owner.pid} still contains no agents or foreground workloads. It
              should release {pruneCandidate?.owner.allocationCount ?? 0} PTYs.
            </DialogDescription>
          </DialogHeader>
          {pruneError && <p className="text-sm text-destructive">{pruneError}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pruning}
              onClick={() => setPruneCandidate(null)}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={pruning} onClick={runPrune}>
              {pruning && <LoaderCircle className="mr-1 size-4 animate-spin" />}
              Prune {pruneCandidate?.owner.allocationCount ?? 0} PTYs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
