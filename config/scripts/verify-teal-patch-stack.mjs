import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SCRIPT_DIR = import.meta.dirname
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..')
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'config/teal-patch-stack.json')

function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

export function validateManifest(manifest) {
  const errors = []
  if (manifest?.schemaVersion !== 1) {
    errors.push('schemaVersion must equal 1')
  }
  if (!manifest?.base?.tag) {
    errors.push('base.tag is required')
  }
  if (!manifest?.base?.commit) {
    errors.push('base.commit is required')
  }
  if (!Array.isArray(manifest?.patches) || manifest.patches.length === 0) {
    errors.push('patches must be a non-empty array')
    return errors
  }

  const ids = new Set()
  let previousOrder = -Infinity
  for (const patch of manifest.patches) {
    if (!patch.id) {
      errors.push('every patch requires an id')
    }
    if (ids.has(patch.id)) {
      errors.push(`duplicate patch id: ${patch.id}`)
    }
    ids.add(patch.id)
    if (!Number.isFinite(patch.order) || patch.order <= previousOrder) {
      errors.push(`patch order must be strictly increasing: ${patch.id ?? '<unknown>'}`)
    }
    previousOrder = patch.order
    if (!Array.isArray(patch.sourceCommits) || patch.sourceCommits.length === 0) {
      errors.push(`patch ${patch.id} requires sourceCommits`)
    }
    for (const commit of patch.sourceCommits ?? []) {
      if (!commit.sha || !commit.subject) {
        errors.push(`patch ${patch.id} has an invalid source commit`)
      }
    }
  }
  return errors
}

export function subjectsAppearInOrder(subjects, expected) {
  let cursor = 0
  for (const subject of subjects) {
    if (subject === expected[cursor]) {
      cursor += 1
    }
    if (cursor === expected.length) {
      return true
    }
  }
  return expected.length === 0
}

export function classifyCherryOutput(output) {
  const marker = output.trim().split(/\s+/)[0]
  if (marker === '-') {
    return 'upstream-equivalent'
  }
  if (marker === '+') {
    return 'teal-only'
  }
  return 'unknown'
}

function audit({ manifestPath = DEFAULT_MANIFEST, baseOverride, strict = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const validationErrors = validateManifest(manifest)
  if (validationErrors.length > 0) {
    return { ok: false, validationErrors, patches: [] }
  }

  const base = baseOverride ?? manifest.base.tag
  const baseCommit = git(['rev-parse', '--short=9', `${base}^{commit}`])
  const subjects = git(['log', '--format=%s', `${base}..HEAD`])
    .split('\n')
    .filter(Boolean)
    .toReversed()
  const patches = []
  const failures = []

  if (!baseOverride && !baseCommit.startsWith(manifest.base.commit)) {
    failures.push(`base ${base} resolves to ${baseCommit}, expected ${manifest.base.commit}`)
  }

  for (const patch of manifest.patches) {
    const expectedSubjects = patch.sourceCommits.map((commit) => commit.subject)
    const packagingOnly = patch.disposition === 'required-packaging-branch'
    const applied = subjectsAppearInOrder(subjects, expectedSubjects)
    const missingPaths = (patch.requiredPaths ?? []).filter(
      (relativePath) => !fs.existsSync(path.join(REPO_ROOT, relativePath))
    )
    const upstreamStatuses = patch.sourceCommits.map((commit) => {
      try {
        const output = git(['cherry', base, commit.sha, `${commit.sha}^`])
        return { sha: commit.sha, status: classifyCherryOutput(output) }
      } catch {
        return { sha: commit.sha, status: 'unavailable' }
      }
    })
    const absorbed = upstreamStatuses.every((entry) => entry.status === 'upstream-equivalent')

    if (!packagingOnly && !applied) {
      failures.push(`required patch is not applied: ${patch.id}`)
    }
    if ((!packagingOnly || applied) && missingPaths.length > 0) {
      failures.push(`required paths missing for ${patch.id}: ${missingPaths.join(', ')}`)
    }
    if (strict && applied && absorbed) {
      failures.push(`patch ${patch.id} appears upstream-equivalent; review and drop or justify it`)
    }
    if (strict && upstreamStatuses.some((entry) => entry.status === 'unavailable')) {
      failures.push(
        `patch ${patch.id} could not be compared with upstream; fetch its donor commits`
      )
    }
    patches.push({
      id: patch.id,
      disposition: patch.disposition,
      applied,
      absorbed,
      upstreamStatuses
    })
  }

  for (const excluded of manifest.excluded ?? []) {
    for (const subject of excluded.subjects ?? []) {
      if (subjects.includes(subject)) {
        failures.push(`excluded patch is present (${excluded.id}): ${subject}`)
      }
    }
  }

  return { ok: failures.length === 0, base, baseCommit, failures, validationErrors: [], patches }
}

function printReport(report) {
  console.log(
    `Teal patch stack base: ${report.base ?? 'invalid'} (${report.baseCommit ?? 'unknown'})`
  )
  for (const patch of report.patches) {
    const state = patch.applied
      ? 'applied'
      : patch.disposition.includes('packaging')
        ? 'packaging'
        : 'missing'
    const upstream = patch.absorbed ? 'upstream-equivalent' : 'teal-only'
    console.log(`- ${patch.id}: ${state}; ${upstream}`)
  }
  for (const error of [...report.validationErrors, ...(report.failures ?? [])]) {
    console.error(`ERROR: ${error}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename
if (isMain) {
  const baseIndex = process.argv.indexOf('--base')
  const baseOverride = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined
  const report = audit({ baseOverride, strict: process.argv.includes('--strict') })
  printReport(report)
  process.exitCode = report.ok ? 0 : 1
}

export { audit }
