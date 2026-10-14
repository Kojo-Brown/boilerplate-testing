/**
 * The published table: what each of the eleven wirings leaves behind.
 *
 * Every cell here was measured, and `runs.test.ts` measures all 77 of them
 * again on every `pnpm test` — eleven real runs of the subject, thirteen
 * processes in all, no browser among them. A row that stops being true fails
 * the suite rather than quietly becoming a wrong sentence in a README.
 *
 * ---------------------------------------------------------------------------
 * What the table says
 * ---------------------------------------------------------------------------
 * **Retrying a test and recording that you retried it are unrelated
 * features.** All seven wirings with retries in them turn the flake green, and
 * two of those seven leave behind a record a flake rate could soundly be
 * computed from — one of which is a reporter this directory had to write.
 *
 * **JUnit XML cannot see a flake, in either runner.** It is also the format
 * every third-party test-analytics service ingests. Vitest writes a bare
 * `<testcase>` for a test that passed on a retry, identical to one that passed
 * first time; Playwright writes the same, and puts unexpected failures in
 * `<error>` rather than `<failure>`, so even the plain failure is missed by a
 * consumer reading the `failures` attribute.
 *
 * **Vitest's JSON report is the one place a Vitest flake is visible, and it is
 * visible only as an inconsistency**: `status: "passed"` with a non-empty
 * `failureMessages`. There is no retry count in the file, so attempts have to
 * be inferred from the number of messages — and `soft-intermittent` files two
 * messages in one attempt, which is why the counting column reads `unsound`.
 * Playwright, by contrast, keeps one `results` entry per attempt and says
 * `flaky` out loud.
 *
 * **A rerun is not a record.** Both rerun wirings end green, and in both the
 * flake is recoverable only by holding two artifacts side by side and noticing
 * that they disagree. `--last-failed` goes further and writes an artifact
 * containing only the tests that failed before, so a dashboard fed on it loses
 * the denominator it needs.
 */

import type { Answers } from './probes.ts'

/** The measured row for each wiring, keyed by wiring id. */
export const EXPECTED: Readonly<Record<string, Answers>> = {
  'vitest-json': {
    gate: 'red',
    verdict: 'failed',
    attempts: 1,
    evidence: 'kept',
    naming: 'silent',
    counting: 'unsound',
    coverage: 'whole-suite',
  },
  'vitest-json-retry': {
    gate: 'green',
    verdict: 'passed',
    attempts: 2,
    evidence: 'kept',
    naming: 'silent',
    counting: 'unsound',
    coverage: 'whole-suite',
  },
  'vitest-junit-retry': {
    gate: 'green',
    verdict: 'passed',
    attempts: undefined,
    evidence: 'lost',
    naming: 'silent',
    counting: 'blind',
    coverage: 'whole-suite',
  },
  'vitest-default-retry': {
    gate: 'green',
    verdict: 'absent',
    attempts: undefined,
    evidence: 'lost',
    naming: 'silent',
    counting: 'blind',
    coverage: 'nothing',
  },
  'vitest-verbose-retry': {
    gate: 'green',
    verdict: 'passed',
    attempts: undefined,
    evidence: 'lost',
    naming: 'silent',
    counting: 'blind',
    coverage: 'whole-suite',
  },
  'vitest-attempts-retry': {
    gate: 'green',
    verdict: 'flaky',
    attempts: 2,
    evidence: 'kept',
    naming: 'named',
    counting: 'sound',
    coverage: 'whole-suite',
  },
  'vitest-rerun': {
    gate: 'green',
    verdict: 'flaky',
    attempts: 2,
    evidence: 'kept',
    naming: 'silent',
    counting: 'unsound',
    coverage: 'whole-suite',
  },
  'playwright-json': {
    gate: 'red',
    verdict: 'failed',
    attempts: 1,
    evidence: 'kept',
    naming: 'silent',
    counting: 'sound',
    coverage: 'whole-suite',
  },
  'playwright-json-retry': {
    gate: 'green',
    verdict: 'flaky',
    attempts: 2,
    evidence: 'kept',
    naming: 'named',
    counting: 'sound',
    coverage: 'whole-suite',
  },
  'playwright-junit-retry': {
    gate: 'green',
    verdict: 'passed',
    attempts: undefined,
    evidence: 'lost',
    naming: 'silent',
    counting: 'blind',
    coverage: 'whole-suite',
  },
  'playwright-last-failed': {
    gate: 'green',
    verdict: 'flaky',
    attempts: 2,
    evidence: 'kept',
    naming: 'silent',
    counting: 'sound',
    coverage: 'failures-only',
  },
}

/**
 * Where the `(retry x1)` marker shows up, and where it does not.
 *
 * `alone` is a suite whose only problem is the flake; `beside` adds a
 * permanently failing test in the same file. Measured by
 * `measureRetryMarker()` and the reason `vitest-default-retry` reads `silent`
 * in the table above rather than `named`: the marker exists, and a green run
 * never prints it.
 */
export const RETRY_MARKER: Readonly<Record<string, { readonly alone: boolean; readonly beside: boolean }>> = {
  'vitest-default-retry': { alone: false, beside: true },
  'vitest-verbose-retry': { alone: false, beside: false },
}

/** The three wirings a flake rate can be computed from at all. */
export const COUNTABLE = Object.entries(EXPECTED)
  .filter(([, answers]) => answers.counting === 'sound')
  .map(([id]) => id)
