/**
 * The seven ways to write a test-time regression gate, as a table.
 *
 * They are ordered by how much they know. `none` is the floor and every row
 * below it is a claim about which slowdowns are worth failing a build over.
 * The matrix in `README.md` scores all seven against every fault in
 * `faults.ts`, over all sixteen recorded runs, and the ordering is not a
 * ranking: three of the seven are the designs people reach for first, and the
 * measurement is that they do not work.
 */

import { expected, type Baseline } from './baseline.ts'
import { entries, total, type Run } from './durations.ts'

/**
 * ---------------------------------------------------------------------------
 * The thresholds
 * ---------------------------------------------------------------------------
 * Round numbers, chosen before the matrix was computed and left alone
 * afterwards. That ordering matters: thresholds fitted to the corpus would
 * make every design look as good as its best tuning, and the finding here is
 * about designs rather than tunings. `thresholds.test.ts` pins each one
 * against the published tables, so changing a number fails the suite that
 * depends on it instead of silently restating the result.
 */

/** A file more than this fraction above its baseline has regressed. */
export const FILE_TOLERANCE = 0.25

/** A file more than this many ms above its baseline has regressed. */
export const FILE_DELTA_MS = 25

/** Floored designs ignore files whose baseline is below this. */
export const FILE_FLOOR_MS = 25

/** A suite more than this fraction above its baseline total has regressed. */
export const TOTAL_TOLERANCE = 0.03

/** The four numbers a rule shape needs. */
export interface Thresholds {
  readonly fileTolerance: number
  readonly fileDeltaMs: number
  readonly fileFloorMs: number
  readonly totalTolerance: number
}

/**
 * The thresholds the design comparison is scored with.
 *
 * Fixed, because the matrix compares rule *shapes* and a shape fitted to the
 * corpus would score as well as its best tuning. The gate this repository
 * actually runs is the same shape with different numbers, calibrated against
 * the suite it polices — see `budget.ts`, and the section of README.md about
 * why those numbers are not these ones.
 */
export const FIXTURE_THRESHOLDS: Thresholds = {
  fileTolerance: FILE_TOLERANCE,
  fileDeltaMs: FILE_DELTA_MS,
  fileFloorMs: FILE_FLOOR_MS,
  totalTolerance: TOTAL_TOLERANCE,
}

export const GATE_IDS = [
  'none',
  'file-percent',
  'file-percent-floored',
  'file-absolute',
  'file-both',
  'total-percent',
  'recommended',
] as const

export type GateId = (typeof GATE_IDS)[number]

/** One reason a gate failed a run. */
export interface Alarm {
  /** The file it is about, or `TOTAL`, or the policy that raised it. */
  readonly scope: string
  readonly reason: string
}

export interface Gate {
  readonly id: GateId
  /** The one-line rule. */
  readonly rule: string
  /** Where it comes from, and what it is worth knowing about. */
  readonly note: string
  readonly evaluate: (baseline: Baseline, run: Run) => readonly Alarm[]
}

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

/** Per-file alarms from a predicate over (measured, baseline) durations. */
function perFile(
  baseline: Baseline,
  run: Run,
  predicate: (ms: number, was: number) => string | undefined,
): readonly Alarm[] {
  const alarms: Alarm[] = []

  for (const { file, ms } of entries(run)) {
    const was = expected(baseline, file)

    if (was === undefined || was <= 0) continue

    const reason = predicate(ms, was)

    if (reason !== undefined) alarms.push({ scope: file, reason })
  }

  return alarms
}

function totalAlarm(
  baseline: Baseline,
  run: Run,
  tolerance: number = TOTAL_TOLERANCE,
): readonly Alarm[] {
  const measured = total(run)
  const limit = baseline.totalMs * (1 + tolerance)

  if (measured <= limit) return []

  return [
    {
      scope: 'TOTAL',
      reason: `${measured.toFixed(0)}ms is ${pct(measured / baseline.totalMs - 1)} over the ${baseline.totalMs.toFixed(0)}ms baseline`,
    },
  ]
}

const overPercent =
  (tolerance: number = FILE_TOLERANCE) =>
  (ms: number, was: number): string | undefined =>
    ms > was * (1 + tolerance)
      ? `${ms.toFixed(1)}ms is ${pct(ms / was - 1)} over the ${was.toFixed(1)}ms baseline`
      : undefined

const overDelta =
  (deltaMs: number = FILE_DELTA_MS) =>
  (ms: number, was: number): string | undefined =>
    ms > was + deltaMs
      ? `${ms.toFixed(1)}ms is ${(ms - was).toFixed(1)}ms over the ${was.toFixed(1)}ms baseline`
      : undefined

/**
 * The shipped rule shape, at whatever thresholds it is handed.
 *
 * `GATES['recommended']` is this at `FIXTURE_THRESHOLDS` and `budget.ts` is
 * this at the calibrated ones, so the design the matrix scores and the gate
 * CI runs cannot drift apart: there is one implementation of both clauses and
 * the difference between them is four numbers.
 *
 * ---------------------------------------------------------------------------
 * Why a file with no baseline entry is reported and not failed
 * ---------------------------------------------------------------------------
 * There was a third clause here, and wiring the gate into CI is what showed it
 * to be wrong. It failed any run containing a file the baseline had no entry
 * for, on the reasoning that a new test file should not arrive unmeasured —
 * which sounds right until you notice what it does in the design CI actually
 * uses. The baseline is the merge base, so *every test file a pull request
 * adds* has no entry, and the clause fails the build for adding tests. This
 * very pull request would have tripped it twelve times.
 *
 * The case it was reaching for is real: a new test file that costs thirty
 * seconds should not land quietly. But that case is already the total clause's
 * — thirty seconds is a budget breach however it arrived, and a legitimate
 * 800ms suite is 0.6% of this repository's total and should pass. So the
 * clause is gone and `baseline.ts`'s `unbudgeted` is reporting only:
 * `check.ts` prints those files with a `?` and no verdict.
 *
 * It costs the matrix nothing, which is the part worth checking rather than
 * asserting: `recommended` still fires on all sixteen runs of the `new-file`
 * fault, because a 150ms file added to a 369ms fixture is a 40.6% total
 * regression and the total clause sees it.
 */
export function evaluateRecommended(
  baseline: Baseline,
  run: Run,
  thresholds: Thresholds,
): readonly Alarm[] {
  const percent = overPercent(thresholds.fileTolerance)
  const delta = overDelta(thresholds.fileDeltaMs)

  return [
    ...perFile(baseline, run, (ms, was) => {
      if (was < thresholds.fileFloorMs) return undefined

      const reason = percent(ms, was)

      return reason !== undefined && delta(ms, was) !== undefined ? reason : undefined
    }),
    ...totalAlarm(baseline, run, thresholds.totalTolerance),
  ]
}

export const GATES: readonly Gate[] = [
  {
    id: 'none',
    rule: 'never fail',
    note: 'The baseline, and the only design that is correct by construction about the control row. Every row below is a claim that some slowdown is worth a red build, and this row is what the claim costs nothing to beat.',
    evaluate: () => [],
  },
  {
    id: 'file-percent',
    rule: `any file more than ${pct(FILE_TOLERANCE)} over its baseline`,
    note: 'What almost everybody writes first, and the one design in the table that is unusable at any tuning. A file\'s run-to-run spread is a function of its duration, not of its code, so one threshold cannot serve a 1ms file and a 242ms one — see the noise profile above the matrix.',
    evaluate: (baseline, run) => perFile(baseline, run, overPercent()),
  },
  {
    id: 'file-percent-floored',
    rule: `any file with a baseline of at least ${String(FILE_FLOOR_MS)}ms, more than ${pct(FILE_TOLERANCE)} over it`,
    note: 'The repair people reach for second: keep the percentage, ignore the files too short to measure. It does fix the false alarms, and it does so by declaring that nothing under the floor is ever a regression — which is most of a real suite\'s files.',
    evaluate: (baseline, run) =>
      perFile(baseline, run, (ms, was) =>
        was < FILE_FLOOR_MS ? undefined : overPercent()(ms, was),
      ),
  },
  {
    id: 'file-absolute',
    rule: `any file more than ${String(FILE_DELTA_MS)}ms over its baseline`,
    note: 'Percentages replaced by wall clock. Immune to the noise profile, because the noise is milliseconds and so is the threshold — and blind to anything cheap, including a file that tripled.',
    evaluate: (baseline, run) => perFile(baseline, run, overDelta()),
  },
  {
    id: 'file-both',
    rule: `any file over its baseline by both ${pct(FILE_TOLERANCE)} and ${String(FILE_DELTA_MS)}ms`,
    note: 'The conjunction, which is the per-file rule worth shipping: the percentage keeps it from accusing a large file of a rounding error, the absolute keeps it from accusing a small one of being small. What it cannot do is notice a slowdown that no single file owns.',
    evaluate: (baseline, run) =>
      perFile(baseline, run, (ms, was) => {
        const percent = overPercent()(ms, was)
        return percent !== undefined && overDelta()(ms, was) !== undefined ? percent : undefined
      }),
  },
  {
    id: 'total-percent',
    rule: `the suite total more than ${pct(TOTAL_TOLERANCE)} over the baseline total`,
    note: 'The aggregate, and the only design that sees creep. Its score in this matrix is the best in the table and is also the most misleading number in this directory: it is a function of how much of the suite one file is, and this fixture has five files. See "What the total column is worth" in README.md.',
    evaluate: (baseline, run) => totalAlarm(baseline, run),
  },
  {
    id: 'recommended',
    rule: 'file-both above the floor, or the total rule',
    note: 'The disjunction this directory ships, and `check.ts` implements. Both clauses are there because the matrix shows the other cannot cover it: the per-file rule localises a regression whatever the suite\'s size, where the total rule dilutes it away, and the total rule catches the slowdown no single file owns, which no per-file rule sees at any tuning. A file with no baseline entry is reported rather than failed — see `evaluateRecommended`.',
    evaluate: (baseline, run) => evaluateRecommended(baseline, run, FIXTURE_THRESHOLDS),
  },
]

const BY_ID = new Map(GATES.map((gate) => [gate.id, gate]))

export function gate(id: GateId): Gate {
  const found = BY_ID.get(id)

  if (found === undefined) throw new Error(`unknown gate: ${id}`)

  return found
}

/** Whether a gate fails this run against this baseline. */
export function fires(id: GateId, baseline: Baseline, run: Run): boolean {
  return gate(id).evaluate(baseline, run).length > 0
}
