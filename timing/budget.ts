/**
 * The budget this repository's CI actually enforces.
 *
 * `gates.ts` decides the rule *shape* by measurement; this file supplies the
 * four numbers, and they are not the four numbers the matrix was scored with.
 * That gap is the most useful thing in this directory, so it is written down
 * here rather than explained away:
 *
 *   | threshold        | fixture (gates.ts) | this suite (here) |
 *   | ---------------- | ------------------ | ----------------- |
 *   | file tolerance   | 25%                | 50%               |
 *   | file delta       | 25ms               | 250ms             |
 *   | file floor       | 25ms               | 100ms             |
 *   | total tolerance  | 3%                 | 15%               |
 *
 * The fixture's numbers were safe on the fixture: zero false alarms over
 * sixteen runs, and zero even against a one-run baseline. Run against this
 * repository's own 228 files they accuse **seven to nine files per run** of
 * regressions that did not happen. The difference is not a bug in either set
 * of numbers, it is what a five-file suite run serially cannot tell you about
 * a 228-file suite run in parallel workers, several of which spawn Vitest or
 * Playwright as a subprocess.
 *
 * `calibration` in `budget.json` records what was measured and when, because
 * a threshold with no measurement behind it is a guess that looks like a
 * policy. Re-run `node timing/calibrate.ts` against several runs of the
 * unchanged suite when the suite or the runner changes, and raise these to
 * clear the floor it reports. Lowering one to make a red build green is the
 * one change this file must not take: it converts a measured budget back into
 * a guess, and `budget.test.ts` holds each of these above the measured floor
 * so that doing it fails the suite.
 */

import { type Alarm, type Thresholds, evaluateRecommended } from './gates.ts'
import { type Baseline } from './baseline.ts'
import { type Run } from './durations.ts'
import budgetJson from './budget.json' with { type: 'json' }

export interface Calibration {
  readonly command: string
  readonly runs: number
  readonly files: number
  readonly medianTotalMs: number
  /** Worst total disagreement seen between runs of the unchanged suite. */
  readonly totalNoiseFloor: number
  readonly worstFileRelative: number
  readonly worstFileAbsoluteMs: number
  readonly machine: string
  readonly recordedAt: string
  /** Files a doubling of which the thresholds would catch. */
  readonly policedFiles: number
  /** Those files' share of the suite's wall clock. */
  readonly policedShareOfWallClock: number
}

export interface Budget {
  readonly thresholds: Thresholds
  readonly calibration: Calibration
}

function validate(raw: unknown): Budget {
  if (typeof raw !== 'object' || raw === null) throw new Error('budget is not an object')

  const { thresholds, calibration } = raw as Record<string, unknown>

  if (typeof thresholds !== 'object' || thresholds === null) {
    throw new Error('budget has no thresholds')
  }

  if (typeof calibration !== 'object' || calibration === null) {
    throw new Error('budget has no calibration — a threshold with no measurement is a guess')
  }

  const t = thresholds as Record<string, unknown>

  for (const key of ['fileTolerance', 'fileDeltaMs', 'fileFloorMs', 'totalTolerance']) {
    const value = t[key]

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`budget threshold ${key} is not a non-negative number`)
    }
  }

  return {
    thresholds: thresholds as unknown as Thresholds,
    calibration: calibration as unknown as Calibration,
  }
}

export const BUDGET: Budget = validate(budgetJson)

/** The shipped gate: the matrix's rule shape at the calibrated thresholds. */
export function evaluate(baseline: Baseline, run: Run): readonly Alarm[] {
  return evaluateRecommended(baseline, run, BUDGET.thresholds)
}

export interface Coverage {
  readonly files: number
  /** Files a doubling of which this budget would catch. */
  readonly policed: number
  /** Those files' share of the suite's wall clock. */
  readonly shareOfWallClock: number
}

/**
 * What fraction of a suite this budget actually polices.
 *
 * A file's doubling clears the percentage clause at any tolerance below 100%,
 * so for the thresholds here a doubling is caught exactly when the file's
 * baseline is at or above the floor *and* above the delta — which is the
 * honest statement of what a calibrated wall-clock budget can see.
 *
 * It is worth computing rather than asserting, because the answer is the one
 * genuinely encouraging number in this directory. By file count the budget
 * polices a small minority; by wall clock it polices nearly all of it, because
 * test time is concentrated. A suite of 232 files where 173 are under 25ms
 * does not need a gate that can see a 25ms file.
 */
export function coverage(baseline: Baseline, budget: Budget = BUDGET): Coverage {
  const { fileFloorMs, fileDeltaMs } = budget.thresholds
  const all = Object.entries(baseline.files)
  const policed = all.filter(([, ms]) => ms >= fileFloorMs && ms > fileDeltaMs)
  const policedMs = policed.reduce((sum, [, ms]) => sum + ms, 0)
  const totalMs = all.reduce((sum, [, ms]) => sum + ms, 0)

  return {
    files: all.length,
    policed: policed.length,
    shareOfWallClock: totalMs > 0 ? policedMs / totalMs : 0,
  }
}
