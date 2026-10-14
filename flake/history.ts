/**
 * Rerun analytics: arithmetic over attempts, and the classification it feeds.
 *
 * ---------------------------------------------------------------------------
 * Why a rate is not enough
 * ---------------------------------------------------------------------------
 * "Flakiest tests, by failure rate" is the dashboard everybody builds, and it
 * ranks a test that fails 4 attempts in 40 below one that fails 30 in 40 — so
 * the top of the list is the broken test somebody has not fixed yet, and the
 * flake that is actually eroding trust in the suite is five rows down. The
 * two need opposite treatment: a test that always fails is a bug report, and a
 * test that usually passes is a quarantine candidate.
 *
 * So the classification here is two-dimensional. `failureRate` says how often
 * a test fails, and `flipped` says how often consecutive attempts *disagreed*
 * — which is the thing that makes a test flaky rather than merely failing.
 * A test that failed its first twenty attempts and passed its last twenty has
 * a failure rate of 0.5 and one flip: it is not flaky, it was fixed.
 *
 * ---------------------------------------------------------------------------
 * Why Laplace rather than the raw rate
 * ---------------------------------------------------------------------------
 * A test with one attempt that failed has a raw failure rate of 1.0, which puts
 * it above a test with 200 attempts and 150 failures. Add-one smoothing is the
 * cheapest correction that orders those sensibly and needs no interval
 * machinery to explain to whoever is reading the dashboard: `(failures + 1) /
 * (attempts + 2)`. The raw rate is kept alongside it, because the smoothed one
 * is the wrong number to put in a sentence like "fails one run in ten".
 */

import type { Attempt } from './attempts.ts'

/** What a test has been doing. */
export interface TestHistory {
  readonly name: string
  readonly module: string
  readonly attempts: number
  readonly failures: number
  /** Runs the test was attempted in, however many attempts each took. */
  readonly runs: number
  /** Runs in which the test ended up passing. */
  readonly passedRuns: number
  /** Runs in which at least one attempt failed and the test still ended up passing. */
  readonly flakyRuns: number
  /** Consecutive attempts, in order, that disagreed with each other. */
  readonly flips: number
  /** Attempts since the last failure. */
  readonly passStreak: number
  readonly failureRate: number
  /** `(failures + 1) / (attempts + 2)`, for ranking. */
  readonly smoothedRate: number
  /**
   * One entry per run, in the order the attempts were given.
   *
   * Three states rather than two — passed, passed-after-retry, failed — because
   * collapsing the middle one is how a flaky suite comes to look green. The
   * dashboard draws it as a sparkline.
   */
  readonly timeline: readonly RunOutcome[]
  /** The most recent failure's message, when one was recorded. */
  readonly lastError?: string
  readonly classification: Classification
}

/** How one run of one test ended. */
export interface RunOutcome {
  readonly run: string
  readonly ended: 'passed' | 'failed'
  /** Did it take more than one attempt? */
  readonly retried: boolean
}

/**
 * What to do about a test, in one word.
 *
 * `stable` — never failed.
 * `flaky` — fails sometimes and passes sometimes, and flips between the two.
 * `broken` — fails every attempt. Not a flake; a failure nobody has fixed.
 * `fixed` — failed in the past, has not failed since, and the pass streak is
 *   long enough to say so. The classification quarantine automation needs in
 *   order to let a test out again.
 */
export type Classification = 'stable' | 'flaky' | 'broken' | 'fixed'

/** The thresholds, in one object, because every one of them is a judgement call. */
export interface Policy {
  /**
   * Attempts a test must have before it can be called anything but `stable`.
   * Below this there is no evidence, and a dashboard that ranks on one attempt
   * ranks on noise.
   */
  readonly minimumAttempts: number
  /** Consecutive passes after which a previously failing test is `fixed`. */
  readonly fixedAfter: number
  /** At or above this failure rate, with no flips, a test is `broken`. */
  readonly brokenRate: number
}

export const DEFAULT_POLICY: Policy = {
  minimumAttempts: 5,
  fixedAfter: 10,
  brokenRate: 1,
}

const keyOf = (attempt: Attempt): string => `${attempt.module}::${attempt.name}`

/**
 * Fold attempts into one history per test.
 *
 * Attempts are taken in the order given, and the order is the caller's
 * business: `collect.ts` sorts by run so that `passStreak` and `flips` mean
 * what they say. Out-of-order attempts do not corrupt the counts, only the two
 * order-sensitive fields, which is why the parameter is a list rather than a set.
 */
export function summarise(
  attempts: readonly Attempt[],
  policy: Policy = DEFAULT_POLICY,
): readonly TestHistory[] {
  interface Accumulator {
    name: string
    module: string
    attempts: number
    failures: number
    flips: number
    passStreak: number
    previous: 'passed' | 'failed' | undefined
    lastError: string | undefined
    runs: Map<string, { failed: number; attempts: number; ended: 'passed' | 'failed' }>
  }

  const accumulators = new Map<string, Accumulator>()

  for (const attempt of attempts) {
    const key = keyOf(attempt)
    const entry: Accumulator = accumulators.get(key) ?? {
      name: attempt.name,
      module: attempt.module,
      attempts: 0,
      failures: 0,
      flips: 0,
      passStreak: 0,
      previous: undefined,
      lastError: undefined,
      runs: new Map(),
    }

    entry.attempts += 1

    if (attempt.outcome === 'failed') {
      entry.failures += 1
      entry.passStreak = 0
      if (attempt.error !== undefined) entry.lastError = attempt.error
    } else {
      entry.passStreak += 1
    }

    if (entry.previous !== undefined && entry.previous !== attempt.outcome) entry.flips += 1
    entry.previous = attempt.outcome

    const run = entry.runs.get(attempt.run) ?? { failed: 0, attempts: 0, ended: 'passed' as const }

    run.failed += attempt.outcome === 'failed' ? 1 : 0
    run.attempts += 1
    // The last attempt filed for a run is how that run ended, which is why the
    // caller's ordering matters.
    run.ended = attempt.outcome
    entry.runs.set(attempt.run, run)

    accumulators.set(key, entry)
  }

  return [...accumulators.values()].map((entry) => {
    const runs = [...entry.runs.values()]
    const timeline: readonly RunOutcome[] = [...entry.runs].map(([run, outcome]) => ({
      run,
      ended: outcome.ended,
      retried: outcome.attempts > 1,
    }))
    const failureRate = entry.attempts === 0 ? 0 : entry.failures / entry.attempts

    return {
      name: entry.name,
      module: entry.module,
      attempts: entry.attempts,
      failures: entry.failures,
      runs: runs.length,
      passedRuns: runs.filter((run) => run.ended === 'passed').length,
      flakyRuns: runs.filter((run) => run.ended === 'passed' && run.failed > 0).length,
      flips: entry.flips,
      passStreak: entry.passStreak,
      failureRate,
      timeline,
      smoothedRate: (entry.failures + 1) / (entry.attempts + 2),
      ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
      classification: classify(
        {
          attempts: entry.attempts,
          failures: entry.failures,
          flips: entry.flips,
          passStreak: entry.passStreak,
          failureRate,
        },
        policy,
      ),
    }
  })
}

/**
 * The classifier, over the five numbers it needs and nothing else.
 *
 * Separated from the fold so that `history.test.ts` can put it in front of
 * counts no real run produces — a test with more flips than failures, a
 * 100% failure rate with a pass streak — which is the only way to find out
 * whether a branch fires for the reason it claims to.
 */
export function classify(
  counts: {
    readonly attempts: number
    readonly failures: number
    readonly flips: number
    readonly passStreak: number
    readonly failureRate: number
  },
  policy: Policy = DEFAULT_POLICY,
): Classification {
  if (counts.failures === 0) return 'stable'

  // Order matters: a test can satisfy both `fixed` and `flaky`, and `fixed` has
  // to win or nothing ever leaves quarantine. It is the stricter claim — a
  // whole unbroken streak — so letting it win costs nothing in the other
  // direction.
  if (counts.passStreak >= policy.fixedAfter) return 'fixed'

  if (counts.attempts < policy.minimumAttempts) {
    // Not enough evidence to distinguish a flake from a failure. `broken` is
    // the safer of the two to guess: it keeps a test out of the quarantine
    // registry, where the automation would start waiting for it to go green.
    return counts.flips > 0 ? 'flaky' : 'broken'
  }

  if (counts.failureRate >= policy.brokenRate) return 'broken'

  return counts.flips > 0 ? 'flaky' : 'broken'
}

/** Rank for a dashboard: flakes first, by smoothed rate, then everything else. */
export function rank(histories: readonly TestHistory[]): readonly TestHistory[] {
  const order: Readonly<Record<Classification, number>> = { flaky: 0, broken: 1, fixed: 2, stable: 3 }

  return [...histories].sort((left, right) => {
    const byClass = (order[left.classification] ?? 9) - (order[right.classification] ?? 9)

    if (byClass !== 0) return byClass
    if (right.smoothedRate !== left.smoothedRate) return right.smoothedRate - left.smoothedRate

    return left.name.localeCompare(right.name)
  })
}
