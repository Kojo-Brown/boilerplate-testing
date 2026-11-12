/**
 * What a suite's run-to-run noise actually is — the pure half.
 *
 * No Node imports, so Vitest can reach it: `shape/` classifies every module a
 * test can reach, and a `node:process` import in here is what sent the first
 * version of this file to the unclassified list. The CLI that reads reports
 * off disk and prints the table is `calibrate.ts`, which is the same split
 * `bundlesize/config.ts` and `bundlesize/check.ts` use.
 *
 * This is the measurement that decides every threshold in `budget.json`.
 * Hand it several reports of the *same* unchanged suite and it answers with
 * the worst relative and absolute disagreement any file showed against its own
 * median, and the same for the total. Those are the floor under any threshold:
 * a gate set below its suite's noise floor does not police the suite, it
 * samples the scheduler.
 *
 * It exists because the fixture lied, and it is worth being precise about how.
 * `corpus.json` says a file's spread is a function of its duration and that
 * the total is stable to about a per cent, and both are true *of a five-file
 * suite run serially with nothing else on the machine*. Run against this
 * repository's own 228 files, in parallel workers, several of which spawn
 * Vitest or Playwright as a subprocess, the same measurement comes back an
 * order of magnitude worse — and the thresholds the matrix was scored with
 * would have failed a pull request that changed nothing, nine files over, on
 * the first run.
 */

import { files, median, total, type Run } from './durations.ts'

export interface FileNoise {
  readonly file: string
  readonly medianMs: number
  readonly worstMs: number
  readonly bestMs: number
  /** Worst run against the median. */
  readonly relative: number
  /** Worst run against the median, in ms. */
  readonly absolute: number
  /**
   * Worst run against the *best* run — the file's full range.
   *
   * This is the number that matters and the first version of this file did not
   * have it, which is how a gate shipped that failed a documentation-only pull
   * request. CI compares one base run against one head run, so what the gate
   * is exposed to is the distance between any two draws, not the distance from
   * a draw to the middle. `flake/identity.test.ts` reads +9% by the median
   * metric over six runs and +41% by this one, because it is slow in about
   * half of them; on a GitHub runner the same file moved +63% between the two
   * runs of one job and tripped a 50% threshold that the median metric had
   * declared safe with room to spare.
   */
  readonly rangeRelative: number
  /** The same quantity in ms. */
  readonly rangeAbsoluteMs: number
}

export interface Calibration {
  readonly runs: number
  readonly files: number
  readonly totalMedianMs: number
  /** Worst total disagreement with the median total, as a ratio. */
  readonly totalRelative: number
  /** The files, worst absolute disagreement first. */
  readonly noisiest: readonly FileNoise[]
  /** Worst relative disagreement any file showed, among files above the floor. */
  readonly worstRelative: number
  /** Worst absolute disagreement any file showed, in ms. */
  readonly worstAbsoluteMs: number
  /** Worst full range any file above the floor showed, as a ratio. */
  readonly worstRangeRelative: number
  /** Worst full range any file showed, in ms. */
  readonly worstRangeAbsoluteMs: number
}

/**
 * Measure the noise in a set of runs of one unchanged suite.
 *
 * Only files every run measured are considered: a file present in some runs
 * and not others is a different suite, not a noisy one, and averaging it in
 * would understate its median and overstate its spread.
 */
export function calibrate(runs: readonly Run[], floorMs: number): Calibration {
  if (runs.length < 2) throw new Error('calibration needs at least two runs')

  const everywhere = files(runs[0] ?? {}).filter((file) =>
    runs.every((run) => Object.hasOwn(run, file)),
  )

  const noise: FileNoise[] = everywhere.map((file) => {
    const values = runs.map((run) => run[file] ?? 0)
    const mid = median(values)
    const worst = Math.max(...values)

    const best = Math.min(...values)

    return {
      file,
      medianMs: mid,
      worstMs: worst,
      bestMs: best,
      relative: mid > 0 ? worst / mid - 1 : 0,
      absolute: worst - mid,
      rangeRelative: best > 0 ? worst / best - 1 : 0,
      rangeAbsoluteMs: worst - best,
    }
  })

  // The totals are taken over the files every run measured, not over each
  // run's own file list. Runs of a tree that gained four test files between
  // them differ in their totals because the suite grew, which is not noise;
  // mixing the two reported this repository's total floor as 6.0% when the
  // files common to every run disagreed by less than half that.
  const totals = runs.map((run) =>
    total(Object.fromEntries(everywhere.map((file) => [file, run[file] ?? 0]))),
  )
  const totalMedian = median(totals)
  const aboveFloor = noise.filter((entry) => entry.medianMs >= floorMs)

  return {
    runs: runs.length,
    files: everywhere.length,
    totalMedianMs: totalMedian,
    totalRelative: Math.max(...totals) / totalMedian - 1,
    noisiest: [...noise].sort((a, b) => b.absolute - a.absolute),
    worstRelative: Math.max(0, ...aboveFloor.map((entry) => entry.relative)),
    worstAbsoluteMs: Math.max(0, ...noise.map((entry) => entry.absolute)),
    worstRangeRelative: Math.max(0, ...aboveFloor.map((entry) => entry.rangeRelative)),
    worstRangeAbsoluteMs: Math.max(0, ...noise.map((entry) => entry.rangeAbsoluteMs)),
  }
}

/**
 * The files a candidate pair of thresholds would wrongly accuse.
 *
 * Scored against each file's full range rather than against its median, for
 * the reason `FileNoise.rangeRelative` gives: CI holds one base run against
 * one head run, so the gate is exposed to the distance between two draws. The
 * first version of this function compared the worst run to the median, found
 * no false alarm at 50% and 250ms, and was wrong — `snapshot/check.test.ts`
 * ranges 6440ms to 10009ms over six runs of unchanged code, which is +55% and
 * +3569ms, and trips both clauses on its own.
 */
export function falseAlarms(
  calibration: Calibration,
  tolerance: number,
  deltaMs: number,
  floorMs: number,
): readonly FileNoise[] {
  return calibration.noisiest.filter(
    (entry) =>
      entry.medianMs >= floorMs &&
      entry.worstMs > entry.bestMs * (1 + tolerance) &&
      entry.worstMs > entry.bestMs + deltaMs,
  )
}
