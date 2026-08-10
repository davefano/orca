#!/usr/bin/env node

const hasValue = (key) => {
  const value = process.env[key]
  return typeof value === 'string' && value.trim().length > 0
}

const credentialGroups = [
  {
    label: 'code signing',
    alternatives: [['CSC_LINK', 'CSC_KEY_PASSWORD'], ['CSC_NAME']]
  },
  {
    label: 'notarization',
    alternatives: [
      ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
      ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'],
      ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
    ]
  }
]

const missingGroups = credentialGroups.filter(({ alternatives }) =>
  alternatives.every((keys) => keys.some((key) => !hasValue(key)))
)

if (missingGroups.length > 0) {
  // Why: local developers still need ad-hoc builds for validation, but the
  // production release path must fail fast instead of silently shipping an
  // unsigned, unnotarized app that only looked successful in CI logs. Local
  // fleet builds may use an installed Developer ID identity and a validated
  // notarytool Keychain profile so secrets never enter the environment.
  console.error('Missing required macOS release credentials:')
  for (const { label, alternatives } of missingGroups) {
    console.error(`- ${label}: provide one of`)
    for (const keys of alternatives) {
      console.error(`  - ${keys.join(' + ')}`)
    }
  }
  console.error('')
  console.error('Use `pnpm build:mac` for local ad-hoc builds, or provide the')
  console.error('Developer ID + notarization credentials before running the')
  console.error('production release build.')
  process.exit(1)
}
