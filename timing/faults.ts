/**
 * The regressions, as a table.
 *
 * Each entry is a transformation of a measured run: what the suite's durations
 * would look like if that regression had landed. The matrix in `README.md`
 * applies every one of them to all sixteen recorded runs and scores every gate
 * design in `gates.ts` on how many of those runs it fired in.
 *
 * `none` is the control and the most important row. It changes nothing, so a
 * gate that fires on it is failing a pull request that did not slow anything
 * down — and a timing gate that does that twice gets deleted. Every other row
 * is a slowdown a gate ought to catch, and the rows are deliberately spread
 * across the two dimensions a slowdown has: how much *longer* a file got, and
 * how much *of the suite's wall clock* that is. Those come apart completely —
 * `tiny-doubled` is a 100% regression worth one millisecond, and
 * `large-tenth` is a 10% regression worth twenty-four — and a gate design can
 * only be judged on whether it separates them the way a person would.
 */

import { total, type Run } from './durations.ts'

export const FAULT_IDS = [
  'none',
  'tiny-doubled',
  'small-tripled',
  'medium-doubled',
  'large-tenth',
  'creep',
  'new-file',
] as const

export type FaultId = (typeof FAULT_IDS)[number]

/** Whether a gate firing on this fault is the right answer. */
export type Verdict = 'quiet' | 'fire'

/**
 * How the fault's cost behaves as the suite grows.
 *
 * This is the property that decides whether a total-only gate can ever see
 * it, and leaving it out of the model was a mistake worth recording: the
 * dilution arithmetic in `score.ts` originally divided every fault's
 * fixture-sized cost by the real suite's total, which reports `creep` as
 * 0.016% of a two-minute suite. It is nothing of the kind. "Every file 5%
 * slower" costs 5% of whatever the suite is, at five files or at five
 * thousand, so the total rule sees it at any scale — while a single file
 * taking 21ms longer is 5.1% of this fixture and 0.016% of the real suite,
 * and is diluted out of the total by the suite's own growth.
 *
 *   - `local`        — a fixed number of milliseconds, wherever it lands.
 *   - `proportional` — a fraction of the suite, whatever the suite is.
 */
export type Scaling = 'local' | 'proportional'

export interface Fault {
  readonly id: FaultId
  /** What landed. */
  readonly change: string
  /** What a gate is supposed to do about it, and why. */
  readonly want: Verdict
  /** Whether its cost is fixed or grows with the suite. */
  readonly scaling: Scaling
  readonly note: string
  readonly apply: (run: Run) => Run
}

const TINY = 'fixture/tiny.test.ts'
const SMALL = 'fixture/small.test.ts'
const MEDIUM = 'fixture/medium.test.ts'
const LARGE = 'fixture/large.test.ts'

/** Multiply one file's duration, leaving the rest of the run alone. */
function scaleFile(run: Run, file: string, by: number): Run {
  if (!Object.hasOwn(run, file)) throw new Error(`run has no ${file}`)

  return { ...run, [file]: (run[file] ?? 0) * by }
}

/** Multiply every file's duration. */
function scaleAll(run: Run, by: number): Run {
  return Object.fromEntries(Object.entries(run).map(([file, ms]) => [file, ms * by]))
}

export const FAULTS: readonly Fault[] = [
  {
    id: 'none',
    change: 'nothing — the run as recorded',
    want: 'quiet',
    scaling: 'local',
    note: 'The control, and the row that decides whether a design is usable at all. Sixteen identical suites measured sixteen times; a gate with a count above zero here fails pull requests for having been scheduled unluckily.',
    apply: (run) => run,
  },
  {
    id: 'tiny-doubled',
    change: `${TINY} takes twice as long (+1ms)`,
    want: 'quiet',
    scaling: 'local',
    note: 'A 100% regression that costs a millisecond. The one fault here whose right answer is silence, and it is in the table to catch a design that confuses a large ratio with a large cost: this is indistinguishable from scheduling noise because at this duration it *is* the size of scheduling noise.',
    apply: (run) => scaleFile(run, TINY, 2),
  },
  {
    id: 'small-tripled',
    change: `${SMALL} takes three times as long (+21ms)`,
    want: 'fire',
    scaling: 'local',
    note: 'The smallest regression in the table that is unambiguously real: three times the work, and far enough above this file\'s measured spread that no run of it is innocent. A design that misses this one is tuned for the total and blind to a file.',
    apply: (run) => scaleFile(run, SMALL, 3),
  },
  {
    id: 'medium-doubled',
    change: `${MEDIUM} takes twice as long (+51ms)`,
    want: 'fire',
    scaling: 'local',
    note: 'The textbook regression: a mid-sized file doubled. Every design in the table should catch this, and the ones that do not are reporting a problem with their own thresholds rather than with the suite.',
    apply: (run) => scaleFile(run, MEDIUM, 2),
  },
  {
    id: 'large-tenth',
    change: `${LARGE} takes 10% longer (+24ms)`,
    want: 'fire',
    scaling: 'local',
    note: 'The regression a percentage gate is worst at and a budget cares about most: 10% of the file that dominates the suite is more wall clock than tripling the small one, and it is below every per-file percentage threshold anybody sets.',
    apply: (run) => scaleFile(run, LARGE, 1.1),
  },
  {
    id: 'creep',
    change: 'every file takes 5% longer (+18ms)',
    want: 'fire',
    scaling: 'proportional',
    note: 'The regression that has no culprit — a slower transform, a heavier setup file, a dependency upgrade. No single file moved enough to accuse, which is why a design built only out of per-file rules cannot see it however it is tuned.',
    apply: (run) => scaleAll(run, 1.05),
  },
  {
    id: 'new-file',
    change: 'a new 150ms test file appears',
    want: 'fire',
    scaling: 'local',
    note: 'Not a regression in anything that existed, which is the point: the baseline has no entry to compare against, so every per-file rule in the table has nothing to say and says nothing. Whether that is acceptable is a policy question, and it is one a gate should be made to answer out loud.',
    apply: (run) => ({ ...run, 'fixture/added.test.ts': 150 }),
  },
]

const BY_ID = new Map(FAULTS.map((fault) => [fault.id, fault]))

export function fault(id: FaultId): Fault {
  const found = BY_ID.get(id)

  if (found === undefined) throw new Error(`unknown fault: ${id}`)

  return found
}

/** What the fault costs the suite's wall clock, in ms, for a given run. */
export function cost(id: FaultId, run: Run): number {
  return total(fault(id).apply(run)) - total(run)
}
