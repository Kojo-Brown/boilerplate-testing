// CI matrix configuration helpers.
//
// Provides typed definitions for the parallel test matrix used in ci.yml.
// Import this in scripts that dynamically generate or validate workflow config.

export type TestSuite = 'unit' | 'coverage' | 'e2e'

export type E2EBrowser = 'chromium' | 'firefox' | 'webkit'

export interface MatrixEntry {
  /** Human-readable job name shown in GitHub Actions UI */
  name: string
  suite: TestSuite
  /** pnpm script to execute for this matrix cell */
  run: string
  /** Browser filter; only set for e2e suite entries */
  browser?: E2EBrowser
  /** Number of times the job retries on failure (not counting first attempt) */
  retries: number
  /** Artifact name prefix; uniquely identifies uploads from this job */
  artifactPrefix: string
}

/** Ordered list of all matrix entries that run in parallel on every CI invocation. */
export const matrix: readonly MatrixEntry[] = [
  {
    name: 'Unit',
    suite: 'unit',
    run: 'pnpm test',
    retries: 0,
    artifactPrefix: 'unit',
  },
  {
    name: 'Coverage',
    suite: 'coverage',
    run: 'pnpm coverage',
    retries: 0,
    artifactPrefix: 'coverage',
  },
  {
    name: 'E2E (Chromium)',
    suite: 'e2e',
    browser: 'chromium',
    run: 'pnpm test:e2e --project=chromium',
    retries: 2,
    artifactPrefix: 'e2e-chromium',
  },
  {
    name: 'E2E (Firefox)',
    suite: 'e2e',
    browser: 'firefox',
    run: 'pnpm test:e2e --project=firefox',
    retries: 2,
    artifactPrefix: 'e2e-firefox',
  },
  {
    name: 'E2E (WebKit)',
    suite: 'e2e',
    browser: 'webkit',
    run: 'pnpm test:e2e --project=webkit',
    retries: 2,
    artifactPrefix: 'e2e-webkit',
  },
] as const

/** Return all entries belonging to the given suite. */
export function filterBySuite(suite: TestSuite): MatrixEntry[] {
  return matrix.filter((e) => e.suite === suite)
}

/** Return all e2e entries for the given browser. */
export function filterByBrowser(browser: E2EBrowser): MatrixEntry[] {
  return matrix.filter((e) => e.browser === browser)
}

/**
 * Validate a matrix: every suite must appear at least once and every
 * artifact prefix must be unique.  Returns `null` on success or a
 * descriptive error string on failure.
 */
export function validateMatrix(entries: readonly MatrixEntry[]): string | null {
  const requiredSuites: TestSuite[] = ['unit', 'coverage', 'e2e']
  for (const suite of requiredSuites) {
    if (!entries.some((e) => e.suite === suite)) {
      return `Missing required suite: "${suite}"`
    }
  }

  const prefixes = entries.map((e) => e.artifactPrefix)
  const seen = new Set<string>()
  for (const prefix of prefixes) {
    if (seen.has(prefix)) return `Duplicate artifactPrefix: "${prefix}"`
    seen.add(prefix)
  }

  return null
}

/** Total number of parallel jobs the matrix produces. */
export function parallelJobCount(entries: readonly MatrixEntry[] = matrix): number {
  return entries.length
}
