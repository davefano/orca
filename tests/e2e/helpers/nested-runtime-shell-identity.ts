import { expect } from '@stablyai/playwright-test'

import type { PairedElectronClient } from './paired-electron-client'

function remoteTerminalHandle(ptyId: string): string {
  const separator = ptyId.indexOf('@@')
  if (!ptyId.startsWith('remote:') || separator === -1) {
    throw new Error(`Expected runtime-owned PTY id, received ${ptyId}`)
  }
  return decodeURIComponent(ptyId.slice(separator + 2))
}

export async function readRemoteShellPid(
  client: PairedElectronClient,
  ptyId: string,
  marker: string
): Promise<string> {
  const terminal = remoteTerminalHandle(ptyId)
  const send = await client.page.evaluate(
    ({ environmentId, marker, terminal }) =>
      window.api.runtimeEnvironments.call({
        selector: environmentId,
        method: 'terminal.send',
        params: {
          terminal,
          text: `printf '${marker}%s\\n' "$$"\n`,
          client: { id: 'nested-shell-identity', type: 'desktop' }
        }
      }),
    { environmentId: client.environmentId, marker, terminal }
  )
  if (!send.ok) {
    throw new Error(`terminal.send failed: ${JSON.stringify(send)}`)
  }
  let pid = ''
  await expect
    .poll(
      async () => {
        pid = await client.page.evaluate(
          async ({ environmentId, marker, terminal }) => {
            const read = await window.api.runtimeEnvironments.call({
              selector: environmentId,
              method: 'terminal.read',
              params: { terminal, limit: 500 }
            })
            const match = JSON.stringify(read).match(new RegExp(`${marker}(\\d+)`))
            return match?.[1] ?? ''
          },
          { environmentId: client.environmentId, marker, terminal }
        )
        return pid
      },
      { timeout: 30_000 }
    )
    .not.toBe('')
  return pid
}
