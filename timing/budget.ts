/**
 * The budget this repository's CI actually enforces.
 *
 * ---------------------------------------------------------------------------
 * Why only the total clause is enforced
 * ---------------------------------------------------------------------------
 * `gates.ts` measures rule *shapes* on a quiet five-file fixture and the
 * disjunction wins there on the evidence. `enforce` in `budget.json` is
 * narrower than that, and the reason is a second measurement rather than a
 * loss of nerve.
 *
 * The per-file clause shipped first and failed a pull request that changed one
 * line of `SPEC.md`. Nothing could have slowed anything: the suite total came
 * in 7.8% *faster* and nearly every file with it, while
 * `flake/identity.test.ts` went 17807ms → 29126ms — +63.6% between two runs of
 * identical code on one GitHub runner, inside one job.
 *
 * The local calibration had declared that safe, and the mistake was in the
 * metric rather than the data. It measured each file's worst run against its
 * *median*, which reads +9% for that file over six runs. CI holds one base run
 * against one head run, so what the clause is exposed to is the distance
 * between any two draws — the full range — which is +41% for the same file in
 * the same six runs. `noise.ts` now reports both, and on that metric
 * `snapshot/check.test.ts` (6440ms → 10009ms, +55% and +3569ms) trips the
 * shipped thresholds on its own, locally, with nothing changed.
 *
 * Thresholds that clear that floor are about +100% and +12s, which polices
 * nothing worth policing: the volatile files are the suites that spawn Vitest
 * or Playwright as subprocesses, and they are also the large ones. A per-file
 * wall-clock clause is unreliable at both ends — small files have enormous
 * relative range, subprocess-spawning files enormous absolute range — and the
 * band where it works is too narrow to be worth a red build.
 *
 * The total survived both machines: ±6% across local batches and −7.8% on the
 * runner, against a 15% tolerance. So the total is enforced and the per-file
 * comparison is printed as a diagnostic, which is where the localisation value
 * actually lands — somebody reading a slow build wants the ranked table, and
 * `check.ts` prints it whether or not the gate failed.
 *
 * To enforce the per-file clause, calibrate it on the runner it will run on
 * with `node timing/calibrate.ts` over several runs, raise the thresholds
 * above the *range* it reports, and add `"file"` to `enforce`. Do not add it
 * without that measurement.
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
  /** Worst full range any policed file showed, as a ratio. */
  readonly worstFileRangeRelative: number
  /** Worst full range any file showed, in ms. */
  readonly worstFileRangeAbsoluteMs: number
}

/** Which clauses fail a build, as opposed to being reported. */
export type Clause = 'file' | 'total'

export interface RunnerEvidence {
  readonly where: string
  readonly totalMovedBy: number
  readonly perFileFalseAlarms: number
  readonly worstFile: string
  readonly worstFileFromMs: number
  readonly worstFileToMs: number
  readonly recordedAt: string
}

export interface Budget {
  readonly enforce: readonly Clause[]
  readonly thresholds: Thresholds
  readonly calibration: Calibration
  readonly runnerEvidence: RunnerEvidence
}

function validate(raw: unknown): Budget {
  if (typeof raw !== 'object' || raw === null) throw new Error('budget is not an object')

  const { thresholds, calibration, enforce, runnerEvidence } = raw as Record<string, unknown>

  if (!Array.isArray(enforce) || enforce.length === 0) {
    throw new Error('budget enforces nothing — a gate that fails on no clause is not a gate')
  }

  for (const clause of enforce as readonly unknown[]) {
    if (clause !== 'file' && clause !== 'total') {
      throw new Error(`budget enforces an unknown clause: ${String(clause)}`)
    }
  }

  if (typeof runnerEvidence !== 'object' || runnerEvidence === null) {
    throw new Error('budget has no runnerEvidence — what the gate did on a real runner')
  }

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
    enforce: enforce as readonly Clause[],
    thresholds: thresholds as unknown as Thresholds,
    calibration: calibration as unknown as Calibration,
    runnerEvidence: runnerEvidence as unknown as RunnerEvidence,
  }
}

export const BUDGET: Budget = validate(budgetJson)

/**
 * The shipped gate: the matrix's rule shape, at the calibrated thresholds,
 * restricted to the clauses `budget.json` says to enforce.
 *
 * Every clause is still evaluated — `diagnose` returns the lot — and this
 * function is what decides the exit code.
 */
export function evaluate(
  baseline: Baseline,
  run: Run,
  budget: Budget = BUDGET,
): readonly Alarm[] {
  return diagnose(baseline, run, budget).filter((alarm) =>
    budget.enforce.includes(alarm.scope === 'TOTAL' ? 'total' : 'file'),
  )
}

/**
 * Everything both clauses have to say, enforced or not.
 *
 * `check.ts` prints this and fails on `evaluate`, so a per-file regression is
 * visible in the log and in the job summary even while the clause that would
 * fail on it is switched off.
 */
export function diagnose(
  baseline: Baseline,
  run: Run,
  budget: Budget = BUDGET,
): readonly Alarm[] {
  return evaluateRecommended(baseline, run, budget.thresholds)
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
