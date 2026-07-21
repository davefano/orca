import { BrowserWindow, powerMonitor } from 'electron'
import { recordCrashBreadcrumb } from './crash-reporting/crash-breadcrumb-store'

export const SYSTEM_RESUMED_CHANNEL = 'system:resumed'

type PowerEventSource = {
  on(event: 'suspend' | 'resume', listener: () => void): unknown
  off(event: 'suspend' | 'resume', listener: () => void): unknown
}

type ResumeBroadcastWindow = {
  isDestroyed(): boolean
  webContents: { send(channel: string): void }
}

type SystemResumeBroadcastOptions = {
  resumeSource?: PowerEventSource
  getWindows?: () => ResumeBroadcastWindow[]
  recordBreadcrumb?: (name: string) => void
}

// Why: renderers cannot observe OS sleep/wake directly, and Linux has no
// window-occlusion tracking so visibilitychange never fires around suspend.
// Wake-sensitive renderer recovery needs this explicit resume signal.
export function registerSystemResumeBroadcast(
  options: SystemResumeBroadcastOptions = {}
): () => void {
  const resumeSource = options.resumeSource ?? powerMonitor
  const getWindows = options.getWindows ?? (() => BrowserWindow.getAllWindows())
  const recordBreadcrumb = options.recordBreadcrumb ?? recordCrashBreadcrumb
  const onSuspend = (): void => {
    // Why: renderer exits after display/system sleep otherwise lack a causal
    // marker, making a transport reconnect look identical to an unrelated crash.
    recordBreadcrumb('system_suspend')
  }
  const onResume = (): void => {
    recordBreadcrumb('system_resume')
    for (const window of getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(SYSTEM_RESUMED_CHANNEL)
      }
    }
  }
  resumeSource.on('suspend', onSuspend)
  resumeSource.on('resume', onResume)
  return () => {
    resumeSource.off('suspend', onSuspend)
    resumeSource.off('resume', onResume)
  }
}
