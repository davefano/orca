import { ServerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { PtyTransportRecoveryState } from './pty-transport-types'

type VisibleRecoveryPhase = Extract<
  PtyTransportRecoveryState['phase'],
  'recovering' | 'backoff' | 'disconnected'
>

export function TerminalRemoteRuntimeReconnectBanner({
  phase,
  onReconnect
}: {
  phase: VisibleRecoveryPhase
  onReconnect: () => void
}): React.JSX.Element | null {
  // Why: pane-stream recovery can outlive a short grace period while the
  // paired runtime and host relay remain healthy. Keep buffered terminal
  // content usable instead of presenting automatic reattachment as an outage.
  if (phase !== 'disconnected') {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center"
      data-terminal-remote-runtime-reconnect-banner={phase}
    >
      <div
        className="pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-md border border-border bg-card/95 px-3 py-3 text-card-foreground shadow-xs backdrop-blur-[1px]"
        role="status"
        aria-live="polite"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
          <ServerOff className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {translate(
              'auto.components.terminal.pane.TerminalRemoteRuntimeReconnectBanner.disconnectedTitle',
              'Remote runtime disconnected'
            )}
          </div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {translate(
              'auto.components.terminal.pane.TerminalRemoteRuntimeReconnectBanner.disconnectedBody',
              'Automatic retries stopped. Reconnect to resume this terminal session.'
            )}
          </div>
        </div>
        <Button size="sm" onClick={onReconnect}>
          {translate(
            'auto.components.terminal.pane.TerminalRemoteRuntimeReconnectBanner.reconnectButton',
            'Reconnect'
          )}
        </Button>
      </div>
    </div>
  )
}
