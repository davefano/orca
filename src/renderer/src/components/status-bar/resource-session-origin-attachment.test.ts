import { describe, expect, it } from 'vitest'
import { canAttachSessionToOrigin } from './resource-session-origin-attachment'

describe('canAttachSessionToOrigin', () => {
  it('allows attachment when the origin leaf is empty', () => {
    expect(canAttachSessionToOrigin({}, 'leaf-1', 'pty-detached')).toBe(true)
  })

  it('allows attachment when the origin already references the session', () => {
    expect(canAttachSessionToOrigin({ 'leaf-1': 'pty-detached' }, 'leaf-1', 'pty-detached')).toBe(
      true
    )
  })

  it('rejects attachment when another PTY occupies the origin leaf', () => {
    expect(canAttachSessionToOrigin({ 'leaf-1': 'pty-newer' }, 'leaf-1', 'pty-detached')).toBe(
      false
    )
  })
})
