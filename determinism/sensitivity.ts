/**
 * How much of the draw space each randomness fault is visible on.
 *
 * ---------------------------------------------------------------------------
 * Why this exists separately from the matrix
 * ---------------------------------------------------------------------------
 * `matrix.ts` answers "did this probe catch this fault", which is the question
 * everybody asks and the less useful of the two. A probe that draws randomly
 * catches a fault with some probability, and reporting the outcome of one run
 * as though it were a property of the technique is how a comparison of this
 * kind turns into folklore: run it again on a Tuesday and the table is
 * different.
 *
 * So the underlying quantity is computed instead of sampled. For each fault,
 * `refreshDelayMs` is evaluated at every draw on a fixed grid, for the control
 * and for the faulted copy, and the fraction of the grid on which they differ
 * is the fault's **visibility**. From that one number the probability that a
 * suite taking *n* random draws sees the fault is arithmetic rather than an
 * experiment, and it is the number that decides how many draws a band check
 * needs.
 *
 * The measurement is over a grid rather than over random samples for the
 * obvious reason: a random estimate of how often a random test fails would
 * itself need error bars, and the whole point is to stop reporting numbers
 * that move.
 *
 * ---------------------------------------------------------------------------
 * What a grid cannot see
 * ---------------------------------------------------------------------------
 * A fault visible only on a set of draws narrower than the grid spacing is
 * invisible here and would be recorded as 0.0%. That is a real limitation and
 * not a hypothetical one — it is exactly what happens to a fault that only
 * fires at a single draw — so `sensitivity.test.ts` checks the two thresholds
 * the subject actually has (`MIN_REFRESH_DELAY_MS` and
 * `MAX_REFRESH_DELAY_MS`) against the grid directly, rather than trusting that
 * a fine enough grid finds everything.
 */

import { loadControl, loadFaulted } from './load.ts'
import { ambientEnvironment } from './environment.ts'
import { FAULT_IDS, faultNamed, type FaultId } from './faults.ts'
import type { Subject } from './load.ts'

/**
 * Draws examined, evenly spaced across [0, 1).
 *
 * Ten thousand points at a spacing of 1e-4. Fine enough that every threshold in
 * `session.ts` is straddled by adjacent samples, coarse enough that the whole
 * sweep over sixteen compiled subjects is milliseconds.
 *
 * A round ten thousand rather than 10,001 for one reason that matters: the
 * midpoint has to be *on* the grid. `Math.random` returns 0.5 about as often as
 * it returns any other double, which is to say never, but a suite that stubs it
 * returns 0.5 every time — so whether a fault is visible at exactly 0.5 is the
 * single most consequential point in the whole space, and an off-by-one in the
 * grid size would have quietly removed it.
 */
export const GRID_POINTS = 10_000

/** The draw values examined, in order. */
export const grid = (): readonly number[] =>
  Array.from({ length: GRID_POINTS }, (_, index) => index / GRID_POINTS)

/** An environment that returns exactly one draw, and nothing else varies. */
const drawing = (value: number) => ({ ...ambientEnvironment, random: () => value })

export interface Sensitivity {
  readonly fault: FaultId
  /** Fraction of the grid on which the delay differs from the control. */
  readonly visibility: number
  /** True when the fault changes nothing about the delay at any draw. */
  readonly invisibleToDelay: boolean
  /** True when the midpoint draw shows the fault. */
  readonly visibleAtMedian: boolean
  /** The lowest draw at which the fault shows, or `null`. */
  readonly firstVisibleDraw: number | null
}

function measureOne(
  fault: FaultId,
  control: Subject,
  faulted: Subject,
  draws: readonly number[],
): Sensitivity {
  let differing = 0
  let firstVisibleDraw: number | null = null
  let visibleAtMedian = false

  for (const draw of draws) {
    const expected = control.refreshDelayMs(drawing(draw))
    const actual = faulted.refreshDelayMs(drawing(draw))

    if (expected !== actual) {
      differing += 1
      firstVisibleDraw ??= draw

      if (draw === 0.5) {
        visibleAtMedian = true
      }
    }
  }

  return {
    fault,
    visibility: differing / draws.length,
    invisibleToDelay: differing === 0,
    visibleAtMedian,
    firstVisibleDraw,
  }
}

let pending: Promise<readonly Sensitivity[]> | null = null

/**
 * Every fault's visibility, including the ones that touch no draw.
 *
 * The faults that do not live in `refreshDelayMs` at all come back at 0.0%,
 * and that is information rather than noise: a fault invisible to every draw
 * is a fault no amount of random input will ever find, however many samples
 * are taken. Half the corpus is in that position, which is the quiet argument
 * against treating "seed it and run it a lot" as a strategy.
 */
export function sensitivities(): Promise<readonly Sensitivity[]> {
  pending ??= (async (): Promise<readonly Sensitivity[]> => {
    const control = await loadControl()
    const draws = grid()

    return Promise.all(
      FAULT_IDS.map(async (fault) => measureOne(fault, control, await loadFaulted(fault), draws)),
    )
  })()

  return pending
}

export const sensitivityOf = (
  all: readonly Sensitivity[],
  fault: FaultId,
): Sensitivity => {
  const found = all.find((entry) => entry.fault === fault)

  if (found === undefined) {
    throw new Error(`no sensitivity measured for ${faultNamed(fault).id}`)
  }

  return found
}

/**
 * The chance a suite taking `samples` independent draws sees a fault of this
 * visibility.
 *
 * Plain arithmetic, deliberately: `1 - (1 - v)^n`. It is quoted in `README.md`
 * for the handful of sample counts a real suite uses, and it is the whole
 * justification for `BAND_DRAWS`.
 */
export const chanceOfSeeing = (visibility: number, samples: number): number =>
  1 - (1 - visibility) ** samples
