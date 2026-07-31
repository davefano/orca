import { describe, expect, it } from 'vitest'

import {
  classifyCherryOutput,
  subjectsAppearInOrder,
  validateManifest
} from './verify-teal-patch-stack.mjs'

describe('Teal patch stack verification', () => {
  it('recognizes exact upstream patch equivalents', () => {
    expect(classifyCherryOutput('- abc123')).toBe('upstream-equivalent')
    expect(classifyCherryOutput('+ abc123')).toBe('teal-only')
  })

  it('requires patch subjects in declared order while allowing audit commits between them', () => {
    expect(
      subjectsAppearInOrder(['patch one', 'docs: audit', 'patch two'], ['patch one', 'patch two'])
    ).toBe(true)
    expect(subjectsAppearInOrder(['patch two', 'patch one'], ['patch one', 'patch two'])).toBe(
      false
    )
  })

  it('rejects duplicate ids and non-increasing order', () => {
    const errors = validateManifest({
      schemaVersion: 1,
      base: { tag: 'v1', commit: 'abc' },
      patches: [
        { id: 'same', order: 20, sourceCommits: [{ sha: '1', subject: 'one' }] },
        { id: 'same', order: 10, sourceCommits: [{ sha: '2', subject: 'two' }] }
      ]
    })
    expect(errors).toContain('duplicate patch id: same')
    expect(errors).toContain('patch order must be strictly increasing: same')
  })

  it('requires auditable upstream watch items with unique ids', () => {
    const errors = validateManifest({
      schemaVersion: 1,
      base: { tag: 'v1', commit: 'abc' },
      patches: [{ id: 'same', order: 10, sourceCommits: [{ sha: '1', subject: 'one' }] }],
      upstreamWatchlist: [
        { id: 'same', commits: [{ sha: '2', subject: 'two' }] },
        { id: 'missing-commits', commits: [] }
      ]
    })
    expect(errors).toContain('duplicate patch or watch id: same')
    expect(errors).toContain('upstream watch item same has an invalid commit')
    expect(errors).toContain('upstream watch item missing-commits requires commits')
  })
})
