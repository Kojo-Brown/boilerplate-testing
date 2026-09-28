/**
 * The other half of the guide, and the half that decides whether the first half
 * matters: given a `trace` mode and what a test did, is there a trace on disk?
 *
 * A debugging guide that starts at "open the trace" has skipped the step that
 * fails most often. The trace modes are not a quality dial — they disagree about
 * *which attempt* they keep, and two of them keep the attempt that passed. A
 * team that picked one from its name, hit a flake in CI, downloaded the artefact
 * and found a recording of the run that worked has not been let down by the
 * viewer. They were let down by a config line.
 *
 * ---------------------------------------------------------------------------
 * This table is measured end to end
 * ---------------------------------------------------------------------------
 * Unlike `evidence.ts`, there is no judgement in a cell here. `check.ts` runs
 * `attempts/attempts.spec.ts` once per mode with `retries: 1`, and then asks the
 * filesystem which `trace.zip` files exist. The cells are still written by hand
 * — same reason as ever, a generated table cannot fail — but each one is a fact
 * with one right answer rather than an argument.
 */

/** The `trace` values a Playwright config accepts, as of 1.62.1. */
export const RETENTION_MODES = [
  'off',
  'on',
  'retain-on-failure',
  'on-first-retry',
  'on-all-retries',
  'retain-on-first-failure',
] as const

export type RetentionMode = (typeof RETENTION_MODES)[number]

export function isRetentionMode(value: string): value is RetentionMode {
  return (RETENTION_MODES as readonly string[]).includes(value)
}

/** What a test did across its two attempts. */
export const OUTCOMES = ['passing', 'failing', 'flaky'] as const

export type Outcome = (typeof OUTCOMES)[number]

/** What each outcome means in terms of attempts, for the README's legend. */
export const OUTCOME_MEANINGS: Readonly<Record<Outcome, string>> = {
  passing: 'passed first time; no retry',
  failing: 'failed both attempts',
  flaky: 'failed, then passed on the retry',
}

/** Which attempts left a trace behind. */
export const KEPT = ['none', 'first', 'retry', 'both'] as const

export type Kept = (typeof KEPT)[number]

export type Row = Readonly<Record<Outcome, Kept>>

export type Retention = Readonly<Record<RetentionMode, Row>>

/**
 * Filled in from a real run. See `check.ts`, which re-measures all eighteen.
 *
 * The `flaky` column is the one worth reading twice.
 */
export const RETENTION: Retention = {
  off: { passing: 'none', failing: 'none', flaky: 'none' },
  on: { passing: 'first', failing: 'both', flaky: 'both' },
  'retain-on-failure': { passing: 'none', failing: 'both', flaky: 'first' },
  'on-first-retry': { passing: 'none', failing: 'retry', flaky: 'retry' },
  'on-all-retries': { passing: 'none', failing: 'retry', flaky: 'retry' },
  'retain-on-first-failure': { passing: 'none', failing: 'first', flaky: 'first' },
}

export function kept(mode: RetentionMode, outcome: Outcome): Kept {
  return RETENTION[mode][outcome]
}

/**
 * Whether a mode's recording of this outcome includes an attempt that failed.
 *
 * The distinction the `flaky` column exists for: its failure is the first
 * attempt and its retry passed, so a mode that kept only the retry has recorded
 * a green run and answered no question.
 */
export function keepsAFailedAttempt(mode: RetentionMode, outcome: Outcome): boolean {
  const attempts = kept(mode, outcome)

  if (outcome === 'passing') {
    return false
  }

  if (outcome === 'flaky') {
    return attempts === 'first' || attempts === 'both'
  }

  return attempts !== 'none'
}

/**
 * Whether a mode keeps *every* attempt that failed.
 *
 * Stricter than {@link keepsAFailedAttempt}, and the difference is
 * `retain-on-first-failure`: a test that fails twice failed twice, and a mode
 * that keeps only the first recording has dropped the attempt whose output the
 * CI log is showing.
 */
export function keepsEveryFailedAttempt(mode: RetentionMode): boolean {
  return kept(mode, 'failing') === 'both' && keepsAFailedAttempt(mode, 'flaky')
}

/** Modes that leave no usable recording of a flake. */
export function uselessForFlakes(): readonly RetentionMode[] {
  return RETENTION_MODES.filter((mode) => !keepsAFailedAttempt(mode, 'flaky'))
}

/** Modes whose only recording of a flake is the attempt that passed. */
export function recordTheWrongAttempt(): readonly RetentionMode[] {
  return RETENTION_MODES.filter((mode) => kept(mode, 'flaky') === 'retry')
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`

  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n')
}

export function renderRetentionTable(): string {
  return table(
    ['`trace`', ...OUTCOMES],
    RETENTION_MODES.map((mode) => [`\`${mode}\``, ...OUTCOMES.map((outcome) => kept(mode, outcome))]),
  )
}

/**
 * The claims `README.md` makes about retention, as functions over the table.
 */
export const FINDINGS: readonly { readonly heading: string; readonly holds: () => boolean }[] = [
  {
    heading: '## Two modes record the attempt that worked',
    holds: () => recordTheWrongAttempt().length === 2,
  },
  {
    heading: '## Half the modes cannot help you with a flake',
    holds: () => uselessForFlakes().length === RETENTION_MODES.length / 2,
  },
  {
    heading: '## `retain-on-failure` is the only mode that keeps every failed attempt and no passing one',
    holds: () => {
      const qualifying = RETENTION_MODES.filter(
        (mode) => keepsEveryFailedAttempt(mode) && kept(mode, 'passing') === 'none',
      )

      return qualifying.length === 1 && qualifying[0] === 'retain-on-failure'
    },
  },
  {
    heading: '## `on` is the only mode that keeps a trace of a green test',
    holds: () =>
      RETENTION_MODES.filter((mode) => kept(mode, 'passing') !== 'none').length === 1 &&
      kept('on', 'passing') !== 'none',
  },
  {
    heading: '## Two names, one behaviour',
    // `on-first-retry` and `on-all-retries` cannot be told apart at one retry,
    // and one retry is what most CI configs use.
    holds: () =>
      OUTCOMES.every(
        (outcome) => kept('on-first-retry', outcome) === kept('on-all-retries', outcome),
      ),
  },
]
