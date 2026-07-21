import { describe, expect, it } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'
import {
  getRemoteWorkspaceClientScope,
  getRemoteWorkspaceNamespace
} from './remote-workspace-namespace'

const target: SshTarget = {
  id: 'target-1',
  label: 'Bumblebee',
  host: 'bumblebee',
  port: 22,
  username: 'daveagent'
}

describe('remote workspace namespace', () => {
  it('keeps one client namespace stable across launches', () => {
    const scope = getRemoteWorkspaceClientScope({
      hostname: 'ultra-magnus',
      installId: 'install-1',
      userDataPath: '/Users/davidfano/Library/Application Support/orca-dev'
    })

    expect(getRemoteWorkspaceNamespace(target, scope)).toBe(
      getRemoteWorkspaceNamespace(target, scope)
    )
  })

  it('isolates clients that connect to the same SSH host', () => {
    const ultraScope = getRemoteWorkspaceClientScope({
      hostname: 'ultra-magnus',
      installId: 'install-ultra',
      userDataPath: '/Users/davidfano/Library/Application Support/orca-dev'
    })
    const airScope = getRemoteWorkspaceClientScope({
      hostname: 'air-raid',
      installId: 'install-air',
      userDataPath: '/Users/davidfano/Library/Application Support/orca-dev'
    })

    expect(getRemoteWorkspaceNamespace(target, ultraScope)).not.toBe(
      getRemoteWorkspaceNamespace(target, airScope)
    )
  })

  it('isolates profiles that share a machine and install identity', () => {
    const prodScope = getRemoteWorkspaceClientScope({
      hostname: 'ultra-magnus',
      installId: 'install-1',
      userDataPath: '/Users/davidfano/Library/Application Support/orca'
    })
    const devScope = getRemoteWorkspaceClientScope({
      hostname: 'ultra-magnus',
      installId: 'install-1',
      userDataPath: '/Users/davidfano/Library/Application Support/orca-dev'
    })

    expect(getRemoteWorkspaceNamespace(target, prodScope)).not.toBe(
      getRemoteWorkspaceNamespace(target, devScope)
    )
  })
})
