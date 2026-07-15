import { describe, it, expect } from 'vitest'
import {
  buildBadge,
  validateConfig,
  buildUploadStep,
  defaultConfig,
  type CodecovConfig,
} from './index'

// ---------------------------------------------------------------------------
// buildBadge
// ---------------------------------------------------------------------------

describe('buildBadge', () => {
  const repo = { owner: 'acme', repo: 'my-app' }

  it('returns an imageUrl, linkUrl, and markdown', () => {
    const badge = buildBadge(repo)
    expect(badge.imageUrl).toMatch(/^https:\/\/codecov\.io/)
    expect(badge.linkUrl).toMatch(/^https:\/\/codecov\.io/)
    expect(badge.markdown).toMatch(/^\[!\[codecov\]/)
  })

  it('defaults to svg format', () => {
    const badge = buildBadge(repo)
    expect(badge.imageUrl).toContain('.svg')
  })

  it('respects png format option', () => {
    const badge = buildBadge(repo, { format: 'png' })
    expect(badge.imageUrl).toContain('.png')
  })

  it('includes token in imageUrl when provided', () => {
    const badge = buildBadge(repo, { token: 'abc123' })
    expect(badge.imageUrl).toContain('token=abc123')
  })

  it('omits token query param when not provided', () => {
    const badge = buildBadge(repo)
    expect(badge.imageUrl).not.toContain('token=')
  })

  it('includes flag in imageUrl when provided', () => {
    const badge = buildBadge(repo, { flag: 'unit' })
    expect(badge.imageUrl).toContain('flag=unit')
  })

  it('linkUrl points to the root report page (no query params)', () => {
    const badge = buildBadge(repo, { token: 'tok', flag: 'unit' })
    expect(badge.linkUrl).not.toContain('?')
  })

  it('markdown embeds imageUrl and linkUrl', () => {
    const badge = buildBadge(repo)
    expect(badge.markdown).toContain(badge.imageUrl)
    expect(badge.markdown).toContain(badge.linkUrl)
  })

  it('embeds owner and repo in the URL slug', () => {
    const badge = buildBadge({ owner: 'org', repo: 'proj' })
    expect(badge.imageUrl).toContain('gh/org/proj')
    expect(badge.linkUrl).toContain('gh/org/proj')
  })

  it('markdown is valid Markdown image link syntax', () => {
    const badge = buildBadge(repo)
    expect(badge.markdown).toMatch(/^\[!\[codecov\]\(https?:\/\/[^)]+\)\]\(https?:\/\/[^)]+\)$/)
  })
})

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

describe('validateConfig', () => {
  const valid: CodecovConfig = {
    owner: 'acme',
    repo: 'app',
    thresholds: { project: 80, patch: 80 },
    flags: ['unit', 'e2e'],
    requireCiToPass: true,
  }

  it('returns null for a valid config', () => {
    expect(validateConfig(valid)).toBeNull()
  })

  it('errors when owner is empty', () => {
    expect(validateConfig({ ...valid, owner: '' })).toMatch(/owner/)
  })

  it('errors when owner is whitespace-only', () => {
    expect(validateConfig({ ...valid, owner: '   ' })).toMatch(/owner/)
  })

  it('errors when repo is empty', () => {
    expect(validateConfig({ ...valid, repo: '' })).toMatch(/repo/)
  })

  it('errors when project threshold is below 0', () => {
    const error = validateConfig({ ...valid, thresholds: { project: -1, patch: 80 } })
    expect(error).toMatch(/project/)
  })

  it('errors when project threshold exceeds 100', () => {
    const error = validateConfig({ ...valid, thresholds: { project: 101, patch: 80 } })
    expect(error).toMatch(/project/)
  })

  it('errors when patch threshold is below 0', () => {
    const error = validateConfig({ ...valid, thresholds: { project: 80, patch: -5 } })
    expect(error).toMatch(/patch/)
  })

  it('errors when patch threshold exceeds 100', () => {
    const error = validateConfig({ ...valid, thresholds: { project: 80, patch: 200 } })
    expect(error).toMatch(/patch/)
  })

  it('errors when flags array is empty', () => {
    const error = validateConfig({ ...valid, flags: [] })
    expect(error).toMatch(/flags/)
  })

  it('errors when flags contain duplicates', () => {
    const error = validateConfig({ ...valid, flags: ['unit', 'unit'] })
    expect(error).toMatch(/duplicate/)
  })

  it('accepts thresholds at boundary values (0 and 100)', () => {
    expect(
      validateConfig({ ...valid, thresholds: { project: 0, patch: 100 } }),
    ).toBeNull()
  })

  it('accepts a single flag', () => {
    expect(validateConfig({ ...valid, flags: ['unit'] })).toBeNull()
  })

  it('accepts custom non-standard flag names', () => {
    expect(validateConfig({ ...valid, flags: ['integration', 'smoke'] })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// defaultConfig
// ---------------------------------------------------------------------------

describe('defaultConfig', () => {
  it('passes validateConfig', () => {
    expect(validateConfig(defaultConfig)).toBeNull()
  })

  it('has an owner set', () => {
    expect(defaultConfig.owner.length).toBeGreaterThan(0)
  })

  it('has a repo set', () => {
    expect(defaultConfig.repo.length).toBeGreaterThan(0)
  })

  it('project threshold is >= 80', () => {
    expect(defaultConfig.thresholds.project).toBeGreaterThanOrEqual(80)
  })

  it('patch threshold is >= 80', () => {
    expect(defaultConfig.thresholds.patch).toBeGreaterThanOrEqual(80)
  })

  it('includes at least the unit flag', () => {
    expect(defaultConfig.flags).toContain('unit')
  })

  it('requireCiToPass is true', () => {
    expect(defaultConfig.requireCiToPass).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildUploadStep
// ---------------------------------------------------------------------------

describe('buildUploadStep', () => {
  const repo = { owner: 'acme', repo: 'my-app' }

  it('returns a string', () => {
    expect(typeof buildUploadStep(repo)).toBe('string')
  })

  it('references the codecov-action', () => {
    expect(buildUploadStep(repo)).toContain('codecov/codecov-action')
  })

  it('includes the CODECOV_TOKEN secret reference', () => {
    expect(buildUploadStep(repo)).toContain('secrets.CODECOV_TOKEN')
  })

  it('points at coverage/lcov.info', () => {
    expect(buildUploadStep(repo)).toContain('coverage/lcov.info')
  })

  it('includes the repo name when a flag is provided', () => {
    const step = buildUploadStep(repo, 'unit')
    expect(step).toContain('flags: unit')
  })

  it('omits the flags line when no flag is provided', () => {
    const step = buildUploadStep(repo)
    expect(step).not.toContain('flags:')
  })

  it('sets fail_ci_if_error: true', () => {
    expect(buildUploadStep(repo)).toContain('fail_ci_if_error: true')
  })

  it('sets verbose: true', () => {
    expect(buildUploadStep(repo)).toContain('verbose: true')
  })

  it('includes owner/repo in the name field', () => {
    const step = buildUploadStep({ owner: 'org', repo: 'proj' })
    expect(step).toContain('org/proj')
  })
})
