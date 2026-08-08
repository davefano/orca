// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REMOTE_RUNTIME_RECONNECT_BANNER_DELAY_MS,
  TerminalRemoteRuntimeReconnectBanner
} from './TerminalRemoteRuntimeReconnectBanner'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TerminalRemoteRuntimeReconnectBanner', () => {
  it('does not surface a brief automatic pane reattachment as a runtime outage', async () => {
    render(<TerminalRemoteRuntimeReconnectBanner phase="backoff" onReconnect={vi.fn()} />)

    expect(screen.queryByText('Reconnecting to remote runtime')).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(REMOTE_RUNTIME_RECONNECT_BANNER_DELAY_MS - 1))
    expect(screen.queryByText('Reconnecting to remote runtime')).not.toBeInTheDocument()
  })

  it('shows quiet bounded automatic recovery when the outage outlives the grace period', async () => {
    render(<TerminalRemoteRuntimeReconnectBanner phase="backoff" onReconnect={vi.fn()} />)

    await act(() => vi.advanceTimersByTimeAsync(REMOTE_RUNTIME_RECONNECT_BANNER_DELAY_MS))
    expect(screen.getByText('Reconnecting to remote runtime')).toBeInTheDocument()
    expect(screen.getByText(/retry for up to one minute/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers one explicit reconnect action after automatic recovery stops', () => {
    const onReconnect = vi.fn()
    render(<TerminalRemoteRuntimeReconnectBanner phase="disconnected" onReconnect={onReconnect} />)

    expect(screen.getByText('Remote runtime disconnected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(onReconnect).toHaveBeenCalledOnce()
  })
})
