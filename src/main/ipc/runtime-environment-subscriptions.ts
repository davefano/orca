import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'

export type RetainedRemoteRuntimeSubscription = RemoteRuntimeSubscription & {
  environmentId: string
  method: string
  ownerWebContentsId: number
  removeDestroyedListener: () => void
  notifyClosed: () => void
  sequence: number
}

export const remoteRuntimeSubscriptions = new Map<string, RetainedRemoteRuntimeSubscription>()
const latestTerminalMultiplexerSequenceByOwner = new Map<string, number>()
let remoteRuntimeSubscriptionSequence = 0

function terminalMultiplexerOwnerKey(
  method: string,
  ownerWebContentsId: number,
  environmentId: string
): string | null {
  return method === 'terminal.multiplex'
    ? JSON.stringify([ownerWebContentsId, environmentId])
    : null
}

export function claimRemoteRuntimeSubscriptionSequence(
  method: string,
  ownerWebContentsId: number,
  environmentId: string
): number {
  const sequence = ++remoteRuntimeSubscriptionSequence
  const ownerKey = terminalMultiplexerOwnerKey(method, ownerWebContentsId, environmentId)
  if (ownerKey) {
    latestTerminalMultiplexerSequenceByOwner.set(ownerKey, sequence)
  }
  return sequence
}

export function forgetTerminalMultiplexerOwner(
  method: string,
  ownerWebContentsId: number,
  environmentId: string
): void {
  const ownerKey = terminalMultiplexerOwnerKey(method, ownerWebContentsId, environmentId)
  if (ownerKey) {
    latestTerminalMultiplexerSequenceByOwner.delete(ownerKey)
  }
}

function retireRemoteRuntimeSubscription(
  subscription: RetainedRemoteRuntimeSubscription,
  context: string
): void {
  try {
    subscription.close()
  } catch (error) {
    console.warn(`[runtime-environments] subscription close failed during ${context}:`, error)
  }
  try {
    subscription.notifyClosed()
  } catch (error) {
    console.warn(
      `[runtime-environments] subscription close notice failed during ${context}:`,
      error
    )
  }
}

export function retainRemoteRuntimeSubscription(
  subscriptionId: string,
  subscription: RetainedRemoteRuntimeSubscription
): void {
  if (subscription.method !== 'terminal.multiplex') {
    remoteRuntimeSubscriptions.set(subscriptionId, subscription)
    return
  }
  const ownerKey = terminalMultiplexerOwnerKey(
    subscription.method,
    subscription.ownerWebContentsId,
    subscription.environmentId
  )!
  const latestSequence = latestTerminalMultiplexerSequenceByOwner.get(ownerKey)
  if (latestSequence !== undefined && latestSequence > subscription.sequence) {
    console.warn('[runtime-environments] rejected stale terminal multiplexer subscription', {
      environmentId: subscription.environmentId,
      ownerWebContentsId: subscription.ownerWebContentsId,
      subscriptionId
    })
    retireRemoteRuntimeSubscription(subscription, 'stale terminal multiplexer rejection')
    return
  }
  let incumbent: [string, RetainedRemoteRuntimeSubscription] | undefined
  for (const entry of remoteRuntimeSubscriptions) {
    const candidate = entry[1]
    if (
      candidate.method === subscription.method &&
      candidate.ownerWebContentsId === subscription.ownerWebContentsId &&
      candidate.environmentId === subscription.environmentId
    ) {
      incumbent = entry
      break
    }
  }
  if (incumbent) {
    remoteRuntimeSubscriptions.delete(incumbent[0])
    console.warn('[runtime-environments] retired duplicate terminal multiplexer subscription', {
      environmentId: subscription.environmentId,
      ownerWebContentsId: subscription.ownerWebContentsId,
      replacedSubscriptionId: incumbent[0],
      replacementSubscriptionId: subscriptionId
    })
    retireRemoteRuntimeSubscription(incumbent[1], 'terminal multiplexer replacement')
  }
  remoteRuntimeSubscriptions.set(subscriptionId, subscription)
}

export function closeSubscriptionsForEnvironment(environmentId: string): void {
  // Why: removed runtimes must not retain terminal/browser WebSockets until renderer teardown.
  for (const [subscriptionId, subscription] of remoteRuntimeSubscriptions) {
    if (subscription.environmentId !== environmentId) {
      continue
    }
    remoteRuntimeSubscriptions.delete(subscriptionId)
    // Why: a shared-control logical close never calls back, so notify directly.
    retireRemoteRuntimeSubscription(subscription, 'retirement')
  }
}
