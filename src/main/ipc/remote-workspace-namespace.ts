import { createHash } from 'node:crypto'
import type { SshTarget } from '../../shared/ssh-types'

export function getRemoteWorkspaceClientScope(args: {
  hostname: string
  installId?: string | null
  userDataPath: string
}): string {
  const stableKey = [
    args.hostname.trim() || 'unknown-host',
    args.installId?.trim() || 'missing-install-id',
    args.userDataPath
  ].join('\n')
  return createHash('sha256').update(stableKey).digest('hex').slice(0, 32)
}

export function getRemoteWorkspaceNamespace(target: SshTarget, clientScope?: string): string {
  const stableKey = [
    target.configHost || target.host,
    target.host,
    String(target.port),
    target.username,
    clientScope?.trim() || 'shared'
  ].join('\n')
  return createHash('sha256').update(stableKey).digest('hex').slice(0, 32)
}
