import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(new URL('./verify-macos-release-env.mjs', import.meta.url))
const baseEnv = { PATH: process.env.PATH ?? '' }

function verify(extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: { ...baseEnv, ...extraEnv }
  })
}

describe('verify-macos-release-env', () => {
  it('rejects a release without signing or notarization credentials', () => {
    const result = verify()

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /code signing/)
    assert.match(result.stderr, /notarization/)
  })

  it('accepts an installed signing identity and Keychain notarization profile', () => {
    const result = verify({
      APPLE_KEYCHAIN: '/tmp/login.keychain-db',
      APPLE_KEYCHAIN_PROFILE: 'OrcaTeal-Notary',
      CSC_NAME: 'Developer ID Application: Example Corp (TEAMID1234)'
    })

    assert.equal(result.status, 0, result.stderr)
  })

  it('accepts a p12 export and Apple ID notarization credentials', () => {
    const result = verify({
      APPLE_APP_SPECIFIC_PASSWORD: 'not-a-real-password',
      APPLE_ID: 'developer@example.com',
      APPLE_TEAM_ID: 'TEAMID1234',
      CSC_KEY_PASSWORD: 'not-a-real-password',
      CSC_LINK: '/tmp/developer-id.p12'
    })

    assert.equal(result.status, 0, result.stderr)
  })

  it('accepts App Store Connect API notarization credentials', () => {
    const result = verify({
      APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000',
      APPLE_API_KEY: '/tmp/AuthKey_KEYID12345.p8',
      APPLE_API_KEY_ID: 'KEYID12345',
      CSC_NAME: 'Developer ID Application: Example Corp (TEAMID1234)'
    })

    assert.equal(result.status, 0, result.stderr)
  })

  it('rejects partial credential alternatives', () => {
    const result = verify({
      APPLE_KEYCHAIN_PROFILE: 'OrcaTeal-Notary',
      CSC_NAME: 'Developer ID Application: Example Corp (TEAMID1234)'
    })

    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stderr, /code signing/)
    assert.match(result.stderr, /notarization/)
    assert.match(result.stderr, /APPLE_KEYCHAIN \+ APPLE_KEYCHAIN_PROFILE/)
  })
})
