import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeEnvironmentMock } = vi.hoisted(() => ({
  callRuntimeEnvironmentMock: vi.fn()
}))

vi.mock('../ipc/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment: callRuntimeEnvironmentMock
}))

import { saveClipboardImageBufferInRuntime } from './clipboard-runtime-image-upload'

describe('saveClipboardImageBufferInRuntime', () => {
  beforeEach(() => {
    callRuntimeEnvironmentMock.mockReset()
  })

  it('preserves the SSH destination during chunked runtime upload', async () => {
    callRuntimeEnvironmentMock.mockImplementation(async (_path, _runtimeId, method) => {
      if (method === 'clipboard.startImageUpload') {
        return { ok: true, result: { uploadId: 'upload-1' } }
      }
      if (method === 'clipboard.appendImageUploadChunk') {
        return { ok: true, result: { receivedBase64Length: 8 } }
      }
      if (method === 'clipboard.commitImageUpload') {
        return { ok: true, result: '/tmp/orca-paste-optimus.png' }
      }
      throw new Error(`unexpected method: ${method}`)
    })

    await expect(
      saveClipboardImageBufferInRuntime(
        '/profile',
        'ultra-magnus',
        Buffer.from([0, 1, 2, 3]),
        'ssh-optimus'
      )
    ).resolves.toBe('/tmp/orca-paste-optimus.png')
    expect(callRuntimeEnvironmentMock).toHaveBeenNthCalledWith(
      1,
      '/profile',
      'ultra-magnus',
      'clipboard.startImageUpload',
      { expectedBase64Length: 8, connectionId: 'ssh-optimus' },
      30_000
    )
  })

  it('preserves the SSH destination in the legacy single-frame fallback', async () => {
    callRuntimeEnvironmentMock.mockImplementation(async (_path, _runtimeId, method) => {
      if (method === 'clipboard.startImageUpload') {
        return { ok: false, error: { code: 'method_not_found', message: 'unsupported' } }
      }
      if (method === 'clipboard.saveImageAsTempFile') {
        return { ok: true, result: '/tmp/orca-paste-optimus.png' }
      }
      throw new Error(`unexpected method: ${method}`)
    })

    await expect(
      saveClipboardImageBufferInRuntime(
        '/profile',
        'ultra-magnus',
        Buffer.from([0, 1, 2, 3]),
        'ssh-optimus'
      )
    ).resolves.toBe('/tmp/orca-paste-optimus.png')
    expect(callRuntimeEnvironmentMock).toHaveBeenNthCalledWith(
      2,
      '/profile',
      'ultra-magnus',
      'clipboard.saveImageAsTempFile',
      { contentBase64: 'AAECAw==', connectionId: 'ssh-optimus' },
      30_000
    )
  })
})
