// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalRemoteRuntimeReconnectBanner } from './TerminalRemoteRuntimeReconnectBanner'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TerminalRemoteRuntimeReconnectBanner', () => {
  it.each(['recovering', 'backoff'] as const)(
    'keeps automatic %s non-blocking even when recovery is sustained',
    async (phase) => {
      render(<TerminalRemoteRuntimeReconnectBanner phase={phase} onReconnect={vi.fn()} />)

      await act(() => vi.advanceTimersByTimeAsync(60_000))
      expect(screen.queryByText('Reconnecting to remote runtime')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    }
  )

  it('offers one explicit reconnect action after automatic recovery stops', () => {
    const onReconnect = vi.fn()
    render(<TerminalRemoteRuntimeReconnectBanner phase="disconnected" onReconnect={onReconnect} />)

    expect(screen.getByText('Remote runtime disconnected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(onReconnect).toHaveBeenCalledOnce()
  })
})
