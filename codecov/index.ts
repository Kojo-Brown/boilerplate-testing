// Typed helpers for Codecov configuration and badge generation.
//
// These utilities let you programmatically validate .codecov.yml settings
// and generate README badge markup for any repository.

/** Coverage threshold in percent (0–100). */
export type CoveragePercent = number

/** Codecov flag name — must match a flag defined in .codecov.yml. */
export type CodecovFlag = 'unit' | 'e2e' | string

export interface CodecovThreshold {
  /** Minimum overall coverage to pass the status check. */
  project: CoveragePercent
  /** Minimum coverage of code introduced in the PR. */
  patch: CoveragePercent
}

export interface CodecovConfig {
  /** GitHub org or user slug (e.g. "my-org"). */
  owner: string
  /** Repository slug (e.g. "my-repo"). */
  repo: string
  thresholds: CodecovThreshold
  /** Flags configured in .codecov.yml for per-suite coverage tracking. */
  flags: CodecovFlag[]
  /** Whether CI must pass before Codecov posts its status. */
  requireCiToPass: boolean
}

/** Badge image format emitted by Codecov. */
export type BadgeFormat = 'svg' | 'png'

export interface CodecovBadge {
  /** Full image URL for the badge. */
  imageUrl: string
  /** Target URL the badge links to (the Codecov report page). */
  linkUrl: string
  /** Ready-to-paste Markdown snippet. */
  markdown: string
}

const CODECOV_BASE = 'https://codecov.io'

/**
 * Build the badge URLs and Markdown for a repository.
 *
 * The token query-param is required for private repos; omit for public ones.
 */
export function buildBadge(
  config: Pick<CodecovConfig, 'owner' | 'repo'>,
  opts: { token?: string; format?: BadgeFormat; flag?: CodecovFlag } = {},
): CodecovBadge {
  const { owner, repo } = config
  const format = opts.format ?? 'svg'
  const slug = `gh/${owner}/${repo}`

  const params = new URLSearchParams()
  if (opts.token) params.set('token', opts.token)
  if (opts.flag) params.set('flag', opts.flag)
  const query = params.size > 0 ? `?${params.toString()}` : ''

  const imageUrl = `${CODECOV_BASE}/${slug}/graph/badge.${format}${query}`
  const linkUrl = `${CODECOV_BASE}/${slug}`
  const markdown = `[![codecov](${imageUrl})](${linkUrl})`

  return { imageUrl, linkUrl, markdown }
}

/**
 * Validate a CodecovConfig object.
 *
 * Returns `null` when valid, or a human-readable error string on failure.
 */
export function validateConfig(config: CodecovConfig): string | null {
  if (!config.owner || config.owner.trim() === '') {
    return 'owner must be a non-empty string'
  }
  if (!config.repo || config.repo.trim() === '') {
    return 'repo must be a non-empty string'
  }
  if (config.thresholds.project < 0 || config.thresholds.project > 100) {
    return `project threshold must be between 0 and 100, got ${config.thresholds.project}`
  }
  if (config.thresholds.patch < 0 || config.thresholds.patch > 100) {
    return `patch threshold must be between 0 and 100, got ${config.thresholds.patch}`
  }
  if (!Array.isArray(config.flags) || config.flags.length === 0) {
    return 'flags must be a non-empty array'
  }
  const hasDuplicates = config.flags.length !== new Set(config.flags).size
  if (hasDuplicates) {
    return 'flags must not contain duplicates'
  }
  return null
}

/**
 * Default Codecov configuration for the boilerplate-testing repo.
 *
 * Mirrors the thresholds declared in .codecov.yml so TypeScript callers
 * have a single source of truth without parsing YAML at runtime.
 */
export const defaultConfig: CodecovConfig = {
  owner: 'Kojo-Brown',
  repo: 'boilerplate-testing',
  thresholds: {
    project: 80,
    patch: 80,
  },
  flags: ['unit', 'e2e'],
  requireCiToPass: true,
}

/**
 * Return the upload command that should run in CI after `pnpm coverage`.
 *
 * Produces a `codecov/codecov-action` step that can be injected into a
 * workflow or used as documentation for manual upload scripts.
 */
export function buildUploadStep(
  config: Pick<CodecovConfig, 'owner' | 'repo'>,
  flag?: CodecovFlag,
): string {
  const name = `${config.owner}/${config.repo}`
  const flagLine = flag ? `\n          flags: ${flag}` : ''
  return [
    '- name: Upload to Codecov',
    '  uses: codecov/codecov-action@v5',
    '  with:',
    '    token: ${{ secrets.CODECOV_TOKEN }}',
    '    files: coverage/lcov.info',
    `    name: ${name}${flagLine}`,
    '    fail_ci_if_error: true',
    '    verbose: true',
  ].join('\n')
}
