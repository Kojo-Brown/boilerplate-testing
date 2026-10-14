/**
 * The seven questions asked of every wiring, and how each is decided.
 *
 * The questions are the ones somebody actually has after a rerun, in the order
 * they come up: did the build go green, what does the report say the test did,
 * how many times was it tried, is the failure still readable, does anything
 * call it a flake, can a flake *rate* be computed, and is the whole suite even
 * in the file.
 *
 * Each is decided from the artifact's own bytes, read by `read.ts`, against
 * the subject's ledger as ground truth. Nothing here knows which wiring it is
 * looking at — which is what stops the matrix from confirming the table it is
 * supposed to be measuring.
 */

import type { AttemptRecord } from './fixture/ledger.ts'
import { viewOf, type Reading } from './read.ts'

/** Did the runner's exit code report the flake? */
export type Gate = 'red' | 'green'

/** What the artifact says the flaky test did. */
export type Verdict = 'failed' | 'passed' | 'flaky' | 'absent'

/** Is the failing attempt's message still in the artifact? */
export type Evidence = 'kept' | 'lost'

/** Does the artifact have a word for a flake? */
export type Naming = 'named' | 'silent'

/**
 * Can a flake rate be computed from this artifact?
 *
 * `sound` — every case's attempt count matches what the subject actually did.
 * `unsound` — counts are available and at least one of them is wrong.
 * `blind` — the artifact carries no attempt count for the flaky test at all.
 */
export type Counting = 'sound' | 'unsound' | 'blind'

/**
 * Does the artifact hold the whole suite, only what was rerun, or no test at
 * all?
 *
 * `nothing` is not a degenerate case to fold into the others. It is what a
 * green Vitest run's console output contains: the default reporter expands a
 * file only when something in it failed, so a suite whose only problem is a
 * flake prints a pass count and names nobody.
 */
export type Coverage = 'whole-suite' | 'failures-only' | 'nothing'

export interface Answers {
  readonly gate: Gate
  readonly verdict: Verdict
  /** Attempts the artifact lets you count for the flaky test; `undefined` is a dash in the table. */
  readonly attempts: number | undefined
  readonly evidence: Evidence
  readonly naming: Naming
  readonly counting: Counting
  readonly coverage: Coverage
}

/** The subject's own account of a run: how many attempts each case really took. */
export function truthByName(ledger: readonly AttemptRecord[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const record of ledger) {
    counts.set(record.id, Math.max(counts.get(record.id) ?? 0, record.attempt))
  }

  return counts
}

export function answer(input: {
  readonly reading: Reading
  /**
   * The artifact of the *last* run, which for a rerun wiring is not the same
   * thing as `reading`. Coverage is asked of this one: what a dashboard
   * ingests after a rerun is the rerun's file, and whether the file before it
   * was complete makes no difference to what the dashboard then believes.
   */
  readonly latest: Reading
  readonly ledger: readonly AttemptRecord[]
  readonly exitCode: number
  readonly subject: string
  readonly plan: readonly string[]
}): Answers {
  const { reading, latest, ledger, exitCode, subject, plan } = input
  const truth = truthByName(ledger)
  const view = viewOf(reading, subject)

  const counting = ((): Counting => {
    if (view === undefined || view.attempts === undefined) return 'blind'

    // Every case the artifact does mention is checked, not just the flaky one:
    // an artifact can count one test's attempts correctly and another's
    // wrongly, and a rate computed over a suite is only as good as its worst
    // row. Cases the artifact leaves out are the `coverage` question, not this
    // one.
    const mentioned = reading.views.filter((candidate) => truth.has(candidate.name))
    const wrong = mentioned.filter((candidate) => candidate.attempts !== truth.get(candidate.name))

    return wrong.length === 0 ? 'sound' : 'unsound'
  })()

  return {
    gate: exitCode === 0 ? 'green' : 'red',
    verdict: view?.status ?? 'absent',
    attempts: view?.attempts,
    // The first attempt's message, specifically: a rerun's whole hazard is
    // that the evidence of the failure is thrown away by the pass that
    // follows it.
    evidence: (view?.errors ?? []).some((error) => error.includes('attempt 1')) ? 'kept' : 'lost',
    naming: reading.namesFlakes ? 'named' : 'silent',
    counting,
    coverage: ((): Coverage => {
      const present = plan.filter((name) => viewOf(latest, name) !== undefined)

      if (present.length === plan.length) return 'whole-suite'

      return present.length === 0 ? 'nothing' : 'failures-only'
    })(),
  }
}
