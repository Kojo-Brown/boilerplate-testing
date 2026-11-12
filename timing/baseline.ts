/**
 * The baseline a regression gate compares against.
 *
 * A baseline is per-file medians plus the median total, derived from a set of
 * runs. Two decisions in that sentence are the whole file.
 *
 * **Medians, not single observations.** The obvious baseline is "the durations
 * from the last green run on main", and it is the one that makes a timing gate
 * unusable: that run's `tiny.test.ts` number is one draw from a distribution
 * whose maximum is more than twice its median (`corpus.json`), so a baseline
 * taken from a lucky run makes the next honest run look like a regression, and
 * one taken from an unlucky run hides a real one. A median over several runs
 * costs several runs and removes that entirely.
 *
 * **The total is stored, not summed.** `totalMs` is the median of the runs'
 * totals, which is *not* the sum of the per-file medians: different files have
 * their bad luck in different runs, so the sum of medians sits below the
 * median of sums. The difference is small here and the distinction is not —
 * summing the medians would build a total budget that no single run can meet
 * and that is tightest exactly when the suite is noisiest.
 */

import { files, median, total, type Run } from './durations.ts'

export interface Baseline {
  /** Per-file median duration, in ms. */
  readonly files: Readonly<Record<string, number>>
  /** Median of the runs' totals, in ms. */
  readonly totalMs: number
  /** How many runs it was derived from. */
  readonly runs: number
}

/**
 * Derive a baseline from runs of an unchanged suite.
 *
 * Throws unless every run measured the same files: a baseline averaging a run
 * that collected four files with one that collected five would understate
 * every per-file median it touched and is the kind of input that produces a
 * budget nobody can explain.
 */
export function baselineFrom(measured: readonly Run[]): Baseline {
  if (measured.length === 0) throw new Error('a baseline needs at least one run')

  const first = measured[0]

  if (first === undefined) throw new Error('a baseline needs at least one run')

  const order = files(first)

  for (const [index, run] of measured.entries()) {
    if (files(run).join('\n') !== order.join('\n')) {
      throw new Error(`run ${String(index)} measured a different set of files than run 0`)
    }
  }

  return {
    files: Object.fromEntries(
      order.map((file) => [file, median(measured.map((run) => run[file] ?? 0))]),
    ),
    totalMs: median(measured.map((run) => total(run))),
    runs: measured.length,
  }
}

/** A file's baseline duration, or `undefined` when the baseline has no entry. */
export function expected(baseline: Baseline, file: string): number | undefined {
  return Object.hasOwn(baseline.files, file) ? baseline.files[file] : undefined
}

/** Files the run measured that the baseline does not know about. */
export function unbudgeted(baseline: Baseline, run: Run): readonly string[] {
  return files(run).filter((file) => expected(baseline, file) === undefined)
}

/** Files the baseline knows about that the run did not measure. */
export function missing(baseline: Baseline, run: Run): readonly string[] {
  return files(baseline.files as Run).filter((file) => !Object.hasOwn(run, file))
}
