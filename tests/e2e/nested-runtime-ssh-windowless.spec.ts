import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { createRestartSession } from './helpers/orca-restart'
import { readRemoteShellPid } from './helpers/nested-runtime-shell-identity'
import { assertInteractiveTerminal } from './helpers/nested-runtime-ssh-client-route'

const isDockerNestedRuntimeRun =
  process.env.ORCA_E2E_NESTED_RUNTIME_SSH === '1' && process.env.ORCA_E2E_WEB_CLIENT === '1'

test.skip(
  !isDockerNestedRuntimeRun,
  'Run with ORCA_E2E_NESTED_RUNTIME_SSH=1 and ORCA_E2E_WEB_CLIENT=1'
)

test('keeps a paired nested SSH route interactive while the HUB desktop window is closed', async ({
  orcaAppExtraEnv: _orcaAppExtraEnv
}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'Ultra and Air use the macOS windowless-app lifecycle')
  test.setTimeout(720_000)
  const hub = createRestartSession(testInfo)
  let target: DockerSshRelayTarget | null = null
  let client: PairedElectronClient | null = null
  let hubLaunch: Awaited<ReturnType<typeof hub.launch>> | null = null
  try {
    target = startDockerSshRelayTarget(testInfo)
    hubLaunch = await hub.launch()
    await hubLaunch.page.waitForFunction(
      () => window.__store?.getState().workspaceSessionReady === true,
      null,
      { timeout: 30_000 }
    )
    const remote = await connectDockerSshRelayTarget(hubLaunch.page, target, {
      relayGracePeriodSeconds: 120
    })
    const offer = await createRuntimeDesktopPairingOffer(hubLaunch.page)
    client = await launchPairedElectronClient(offer, testInfo, 'Nested SSH windowless HUB')
    const beforeClose = await assertInteractiveTerminal(
      client,
      remote.repoId,
      `HUB_WINDOW_BEFORE_${Date.now()}`
    )
    const shellPid = await readRemoteShellPid(
      client,
      beforeClose.ptyId,
      'ORCA_SHELL_BEFORE_WINDOW_CLOSE_'
    )
    const hubWindow = await hubLaunch.app.browserWindow(hubLaunch.page)
    const hubWindowId = await hubWindow.evaluate((window) => window.id)

    await hubWindow.evaluate((window) => window.close())
    await expect
      .poll(
        () =>
          hubLaunch!.app.evaluate(
            ({ BrowserWindow }, windowId) => BrowserWindow.fromId(windowId) === null,
            hubWindowId
          ),
        { timeout: 30_000, message: 'HUB desktop window never closed' }
      )
      .toBe(true)

    const whileClosed = await assertInteractiveTerminal(
      client,
      remote.repoId,
      `HUB_WINDOW_CLOSED_${Date.now()}`
    )
    expect(whileClosed.ptyId).toBe(beforeClose.ptyId)
    expect(
      await readRemoteShellPid(client, whileClosed.ptyId, 'ORCA_SHELL_WHILE_WINDOW_CLOSED_')
    ).toBe(shellPid)

    const reopenedPagePromise = hubLaunch.app.waitForEvent('window')
    await hubLaunch.app.evaluate(({ app }) => app.emit('activate'))
    const reopenedPage = await reopenedPagePromise
    await reopenedPage.waitForLoadState('domcontentloaded')
    await reopenedPage.waitForFunction(
      () => window.__store?.getState().workspaceSessionReady === true,
      null,
      { timeout: 30_000 }
    )
    hubLaunch = { app: hubLaunch.app, page: reopenedPage }

    const afterReopen = await assertInteractiveTerminal(
      client,
      remote.repoId,
      `HUB_WINDOW_REOPENED_${Date.now()}`
    )
    expect(afterReopen.ptyId).toBe(beforeClose.ptyId)
    expect(
      await readRemoteShellPid(client, afterReopen.ptyId, 'ORCA_SHELL_AFTER_WINDOW_REOPEN_')
    ).toBe(shellPid)
    expect(await client.getDirectSshAttemptTargetIds()).toEqual([])
  } finally {
    await client?.dispose()
    if (hubLaunch) {
      await hub.close(hubLaunch.app)
    }
    await hub.dispose()
    cleanupDockerSshRelayTarget(target)
  }
})
