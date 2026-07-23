import { z } from 'zod'
import {
  connectRegisteredSshTarget,
  getRegisteredSshPtyHealth,
  getRegisteredSshState,
  listRegisteredRemovedSshTargetLabels,
  listRegisteredSshTargets,
  pruneRegisteredSshPtyOwner
} from '../../../ipc/ssh'
import { defineMethod, type RpcMethod } from '../core'

const SshTarget = z.object({
  targetId: z.string().min(1)
})

const SshPtyOwner = SshTarget.extend({
  ownerId: z.string().min(1)
})

export const SSH_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'ssh.getState',
    params: SshTarget,
    handler: (params) => ({ state: getRegisteredSshState(params.targetId) ?? null })
  }),
  defineMethod({
    name: 'ssh.getPtyHealth',
    params: SshTarget,
    handler: async (params) => ({ health: await getRegisteredSshPtyHealth(params.targetId) })
  }),
  defineMethod({
    name: 'ssh.prunePtyOwner',
    params: SshPtyOwner,
    handler: async (params) => ({
      prune: await pruneRegisteredSshPtyOwner(params.targetId, params.ownerId)
    })
  }),
  defineMethod({
    name: 'ssh.connect',
    params: SshTarget,
    handler: async (params) => ({ state: await connectRegisteredSshTarget(params.targetId) })
  }),
  defineMethod({
    name: 'ssh.listTargets',
    params: null,
    handler: () => ({ targets: listRegisteredSshTargets() })
  }),
  defineMethod({
    name: 'ssh.listRemovedTargetLabels',
    params: null,
    handler: () => ({ labels: listRegisteredRemovedSshTargetLabels() })
  })
]
