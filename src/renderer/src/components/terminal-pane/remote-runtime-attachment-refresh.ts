import type { RemoteRuntimePtyRecoveryPhase } from './remote-runtime-pty-recovery-state'

type AttachmentState = {
  attachmentReady: boolean
  connected: boolean
  destroyed: boolean
  handle: string | null
  remotePtyId: string | null
  terminalEnded: boolean
}

type AttachmentRefreshControllerOptions<ReplacementPolicy> = {
  beginRecovery: () => number
  cancelRecovery: () => void
  getConnectionGeneration: () => number
  getRecoveryPhase: () => RemoteRuntimePtyRecoveryPhase
  getReplacementPolicy: (handle: string) => ReplacementPolicy
  getState: () => AttachmentState
  handleError: (error: unknown) => void
  isRecoveryActive: () => boolean
  recoverAfterSubscribeFailure: (
    error: unknown,
    targetHandle: string,
    targetPtyId: string | null
  ) => boolean
  retryRecoveryNow: () => boolean
  scheduleResubscribe: (replacementPolicy: ReplacementPolicy, recoveryEpoch: number) => void
  subscribe: (onSubscribed: () => void) => Promise<void>
}

export type RemoteRuntimeAttachmentRefreshController = {
  needsRefresh: () => boolean
  refresh: () => boolean
  requiresRpcFallback: () => boolean
}

export function createRemoteRuntimeAttachmentRefreshController<ReplacementPolicy>(
  options: AttachmentRefreshControllerOptions<ReplacementPolicy>
): RemoteRuntimeAttachmentRefreshController {
  let inFlight: Promise<void> | null = null
  let lastRefreshGeneration = options.getConnectionGeneration()
  let rpcFallbackRequired = false

  const needsRefresh = (): boolean =>
    options.getRecoveryPhase() !== 'idle' ||
    lastRefreshGeneration !== options.getConnectionGeneration()

  return {
    needsRefresh,
    requiresRpcFallback: () => rpcFallbackRequired,
    refresh() {
      if (inFlight) {
        return true
      }
      const state = options.getState()
      if (
        state.destroyed ||
        state.terminalEnded ||
        !state.connected ||
        !state.handle ||
        !state.remotePtyId
      ) {
        return false
      }
      if (options.retryRecoveryNow()) {
        return true
      }
      if (options.getRecoveryPhase() === 'disconnected') {
        const recoveryEpoch = options.beginRecovery()
        options.scheduleResubscribe(options.getReplacementPolicy(state.handle), recoveryEpoch)
        return true
      }
      if (!state.attachmentReady || options.getRecoveryPhase() !== 'idle') {
        if (!options.isRecoveryActive()) {
          return false
        }
        options.cancelRecovery()
        const recoveryEpoch = options.beginRecovery()
        options.scheduleResubscribe(options.getReplacementPolicy(state.handle), recoveryEpoch)
        return true
      }

      const targetHandle = state.handle
      const targetPtyId = state.remotePtyId
      const refreshGeneration = options.getConnectionGeneration()
      rpcFallbackRequired = lastRefreshGeneration !== refreshGeneration
      inFlight = options
        .subscribe(() => {
          rpcFallbackRequired = false
          if (options.getConnectionGeneration() === refreshGeneration) {
            lastRefreshGeneration = refreshGeneration
          }
        })
        .catch((error) => {
          rpcFallbackRequired = false
          if (!options.recoverAfterSubscribeFailure(error, targetHandle, targetPtyId)) {
            options.handleError(error)
          }
        })
        .finally(() => {
          inFlight = null
        })
      return true
    }
  }
}
