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
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { PtyOwnerSnapshot, SshPtyHealthResult } from '../../../../shared/ssh-types'

type PruneCandidate = {
  targetId: string
  targetLabel: string
  owner: PtyOwnerSnapshot
}

function dispositionLabel(owner: PtyOwnerSnapshot): string {
  if (owner.disposition === 'safe') {
    return translate('auto.components.status.bar.SshPtyHealthPanel.safeToPrune', 'Safe to prune')
  }
  if (owner.disposition === 'recover-first') {
    return translate('auto.components.status.bar.SshPtyHealthPanel.recoverFirst', 'Recover first')
  }
  if (owner.isCurrentRelay) {
    return translate('auto.components.status.bar.SshPtyHealthPanel.currentRelay', 'Current relay')
  }
  return translate('auto.components.status.bar.SshPtyHealthPanel.protected', 'Protected')
}

function ownerLabel(owner: PtyOwnerSnapshot): string {
  if (owner.category === 'orca-relay') {
    return translate(
      'auto.components.status.bar.SshPtyHealthPanel.orcaRelayPid',
      'Orca relay · PID {{value0}}',
      { value0: owner.pid }
    )
  }
  if (owner.category === 'agent') {
    return translate(
      'auto.components.status.bar.SshPtyHealthPanel.agentPtyHostPid',
      'Agent PTY host · PID {{value0}}',
      { value0: owner.pid }
    )
  }
  if (owner.category === 'terminal') {
    return translate(
      'auto.components.status.bar.SshPtyHealthPanel.terminalAppPid',
      'Terminal.app · PID {{value0}}',
      { value0: owner.pid }
    )
  }
  return translate(
    'auto.components.status.bar.SshPtyHealthPanel.processPid',
    'Process · PID {{value0}}',
    { value0: owner.pid }
  )
}

function healthSummary(result: SshPtyHealthResult): string {
  const health = result.health
  if (health?.systemAllocated !== null && health?.systemCapacity !== null && health) {
    return translate(
      'auto.components.status.bar.SshPtyHealthPanel.healthSummary',
      '{{value0}}/{{value1}} PTYs · {{value2}} free',
      {
        value0: health.systemAllocated,
        value1: health.systemCapacity,
        value2: health.systemAvailable
      }
    )
  }
  return (
    result.error ??
    health?.diagnosticError ??
    translate('auto.components.status.bar.SshPtyHealthPanel.orcaPtys', '{{value0}} Orca PTYs', {
      value0: health?.relayOwned ?? 0
    })
  )
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
          <span>
            {translate('auto.components.status.bar.SshPtyHealthPanel.title', 'SSH PTY health')}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="rounded p-0.5 transition-colors hover:bg-accent disabled:opacity-40"
            aria-label={translate(
              'auto.components.status.bar.SshPtyHealthPanel.refresh',
              'Refresh SSH PTY health'
            )}
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
                  aria-label={
                    expanded
                      ? translate(
                          'auto.components.status.bar.SshPtyHealthPanel.hideOwners',
                          'Hide {{value0}} PTY owners',
                          { value0: result.label }
                        )
                      : translate(
                          'auto.components.status.bar.SshPtyHealthPanel.showOwners',
                          'Show {{value0}} PTY owners',
                          { value0: result.label }
                        )
                  }
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
                            {translate(
                              'auto.components.status.bar.SshPtyHealthPanel.ownerCounts',
                              '{{value0}} allocated · {{value1}} attached · {{value2}} leaked',
                              {
                                value0: owner.allocationCount,
                                value1: owner.attachedPtyCount,
                                value2: owner.leakedPtyCount
                              }
                            )}
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
                              aria-label={translate(
                                'auto.components.status.bar.SshPtyHealthPanel.pruneSafeRelay',
                                'Prune safe relay PID {{value0}}',
                                { value0: owner.pid }
                              )}
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
            <DialogTitle>
              {translate(
                'auto.components.status.bar.SshPtyHealthPanel.pruneTitle',
                'Prune idle PTYs on {{value0}}?',
                { value0: pruneCandidate?.targetLabel ?? '' }
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.status.bar.SshPtyHealthPanel.pruneDescription',
                'This sends SIGTERM only after the host rechecks that relay PID {{value0}} still contains no agents or foreground workloads. It should release {{value1}} PTYs.',
                {
                  value0: pruneCandidate?.owner.pid ?? '',
                  value1: pruneCandidate?.owner.allocationCount ?? 0
                }
              )}
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
              {translate('auto.components.status.bar.SshPtyHealthPanel.cancel', 'Cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={pruning} onClick={runPrune}>
              {pruning && <LoaderCircle className="mr-1 size-4 animate-spin" />}
              {translate(
                'auto.components.status.bar.SshPtyHealthPanel.pruneCount',
                'Prune {{value0}} PTYs',
                { value0: pruneCandidate?.owner.allocationCount ?? 0 }
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
