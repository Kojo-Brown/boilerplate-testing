/**
 * The eleven rerun wirings, and the plan they are all measured against.
 *
 * ---------------------------------------------------------------------------
 * What a wiring is
 * ---------------------------------------------------------------------------
 * A retry count, a reporter, and — for two of them — a second run. Those are
 * the knobs a project actually turns when it decides what to do about flaky
 * tests, and the question this directory exists to answer is what each
 * combination leaves behind for somebody trying to find out which tests are
 * flaky and how often.
 *
 * Every wiring runs the same subject against the same plan, so the rows are
 * comparable. The plan is three cases:
 *
 *   `intermittent`      fails its first attempt ever, passes after that
 *   `soft-intermittent` the same, but its failing attempt files two errors
 *   `stable`            always passes
 *
 * Nothing in the plan fails permanently, which is deliberate: it makes the
 * exit code a measurement of the *flake* rather than of a broken test sitting
 * next to it, and a wiring with any retries at all therefore ends green.
 *
 * `soft-intermittent` is in the plan for one reason. It is the case that breaks
 * counting attempts by counting a report's error messages — the only count a
 * Vitest JSON report offers — and without it that inference looks sound.
 */

import type { FlakeCase } from './fixture/plan.ts'

/** The subject's instruction sheet, shared by every wiring. */
export const PLAN: { readonly cases: readonly FlakeCase[] } = {
  cases: [
    { id: 'intermittent', failOn: [1] },
    { id: 'soft-intermittent', failOn: [1], errorsPerAttempt: 2 },
    { id: 'stable', failOn: [] },
  ],
}

/** The case every probe is asked about. */
export const SUBJECT = 'intermittent'

/**
 * How an artifact is read back. One parser per value, in `read.ts`.
 *
 * `stdout` is a kind of artifact here rather than an absence of one: a CI log
 * is what most people actually read after a rerun, and two of Vitest's
 * reporters differ in what they put in it.
 */
export type ArtifactKind =
  | 'vitest-json'
  | 'vitest-junit'
  | 'vitest-stdout'
  | 'vitest-attempts'
  | 'playwright-json'
  | 'playwright-junit'

/** One row of the matrix. */
export interface Wiring {
  readonly id: string
  /** Which runner, and therefore which CLI and which config. */
  readonly runner: 'vitest' | 'playwright'
  /** Retries *after* the first attempt, as the runner's flag means it. */
  readonly retries: number
  /** The reporter under test, and how to read what it wrote. */
  readonly artifact: ArtifactKind
  /**
   * A second run over the same ledger, which is what the "re-run failed jobs"
   * button does. `failures-only` adds the runner's own flag for rerunning just
   * the failures.
   */
  readonly rerun?: 'whole-suite' | 'failures-only'
  /** One line for the README table. */
  readonly note: string
}

export const WIRINGS: readonly Wiring[] = [
  {
    id: 'vitest-json',
    runner: 'vitest',
    retries: 0,
    artifact: 'vitest-json',
    note: 'No retries. The baseline: a flake is simply a failure.',
  },
  {
    id: 'vitest-json-retry',
    runner: 'vitest',
    retries: 2,
    artifact: 'vitest-json',
    note: 'The usual advice. `retry: 2` plus the JSON reporter.',
  },
  {
    id: 'vitest-junit-retry',
    runner: 'vitest',
    retries: 2,
    artifact: 'vitest-junit',
    note: 'The same run read as JUnit XML — what test analytics services ingest.',
  },
  {
    id: 'vitest-default-retry',
    runner: 'vitest',
    retries: 2,
    artifact: 'vitest-stdout',
    note: 'The default reporter, read the way a human reads a CI log.',
  },
  {
    id: 'vitest-verbose-retry',
    runner: 'vitest',
    retries: 2,
    artifact: 'vitest-stdout',
    note: 'The verbose reporter, chosen by `vitest/quarantine.config.ts` to make retries visible.',
  },
  {
    id: 'vitest-attempts-retry',
    runner: 'vitest',
    retries: 2,
    artifact: 'vitest-attempts',
    note: 'The same run through `reporter.ts`.',
  },
  {
    id: 'vitest-rerun',
    runner: 'vitest',
    retries: 0,
    artifact: 'vitest-json',
    rerun: 'whole-suite',
    note: 'No retries, run twice — the "re-run failed jobs" button. Both reports are read.',
  },
  {
    id: 'playwright-json',
    runner: 'playwright',
    retries: 0,
    artifact: 'playwright-json',
    note: 'No retries. The baseline for the other runner.',
  },
  {
    id: 'playwright-json-retry',
    runner: 'playwright',
    retries: 2,
    artifact: 'playwright-json',
    note: '`retries: 2` plus the JSON reporter.',
  },
  {
    id: 'playwright-junit-retry',
    runner: 'playwright',
    retries: 2,
    artifact: 'playwright-junit',
    note: 'The same run read as JUnit XML.',
  },
  {
    id: 'playwright-last-failed',
    runner: 'playwright',
    retries: 0,
    artifact: 'playwright-json',
    rerun: 'failures-only',
    note: 'No retries, then `--last-failed`. Both reports are read.',
  },
]

export const wiringById = (id: string): Wiring => {
  const wiring = WIRINGS.find((candidate) => candidate.id === id)

  if (wiring === undefined) throw new Error(`no such wiring: ${id}`)

  return wiring
}
