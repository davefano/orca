import { Server } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function OrcaServerSourceBadge({ name }: { name: string }): React.JSX.Element {
  const label = translate(
    'auto.components.sidebar.WorktreeList.serverSourceLabel',
    'From Orca server {{name}}',
    { name }
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex min-w-0 max-w-28 shrink items-center gap-1 rounded border border-worktree-sidebar-border bg-worktree-sidebar-accent px-1 py-0.5 text-[9px] font-medium leading-none text-muted-foreground"
          aria-label={label}
        >
          <Server className="size-2.5 shrink-0" />
          <span className="truncate">{name}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
