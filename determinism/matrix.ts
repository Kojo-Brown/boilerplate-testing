/**
 * The measurement: every world against every fault, plus the control.
 *
 * Computed once and shared, because a faulted subject is a compiled copy of
 * `session.ts` and the real-clock worlds wait for real milliseconds — running
 * this per test file would be the slowest thing in the repository by an order
 * of magnitude.
 *
 * ---------------------------------------------------------------------------
 * Why the control comes first
 * ---------------------------------------------------------------------------
 * `detection.test.ts` asserts, before it looks at a single fault, that every
 * world states every behaviour it claims and that all of them hold on the
 * unedited source. Without that, a probe that is simply broken — a check
 * asserting something the subject never promised, a world whose clock does not
 * move — reads as a probe that catches everything, and the matrix becomes a
 * measurement of the harness.
 *
 * It also catches the subtler version: a world's own slack. The real-clock
 * worlds wait `REAL_GRACE_MS` past a deadline before calling a callback
 * missing, and if that slack were too small the control would fail
 * intermittently rather than the faults being caught reliably.
 *
 * ---------------------------------------------------------------------------
 * Why variants run concurrently and worlds do not
 * ---------------------------------------------------------------------------
 * Concurrency here is not an optimisation for its own sake: three of the six
 * worlds wait for real time, and run one after another the matrix takes about
 * twenty seconds of pure sleeping. Nothing shared is mutated — each variant is
 * its own compiled module and each check gets its own world instance — so the
 * variants of one world are safe to run together.
 *
 * Worlds are kept sequential all the same. It costs almost nothing, since only
 * the real-clock ones are slow, and it keeps the wall-clock measurements from
 * competing with each other for the event loop, which is precisely the
 * condition under which a timer runs late.
 */

import { FAULT_IDS, type FaultId } from './faults.ts'
import { loadControl, loadFaulted } from './load.ts'
import { runWorld, type CheckResult } from './probes.ts'
import { WORLDS, type ProbeId } from './worlds.ts'
import type { BehaviourId } from './contract.ts'

/** What one world saw of one variant. */
export interface Verdict {
  readonly world: ProbeId
  /** `null` for the unedited source. */
  readonly fault: FaultId | null
  readonly results: readonly CheckResult[]
  /** Behaviours that failed. Empty means the variant went unnoticed. */
  readonly failed: readonly BehaviourId[]
}

export interface Matrix {
  readonly control: readonly Verdict[]
  readonly faulted: readonly Verdict[]
}

const failuresOf = (results: readonly CheckResult[]): readonly BehaviourId[] =>
  results.filter((result) => !result.held).map((result) => result.behaviour)

let pending: Promise<Matrix> | null = null

export function measure(): Promise<Matrix> {
  pending ??= (async (): Promise<Matrix> => {
    const control: Verdict[] = []
    const faulted: Verdict[] = []

    for (const world of WORLDS) {
      const results = await runWorld(world, await loadControl())

      control.push({ world: world.id, fault: null, results, failed: failuresOf(results) })

      const batch = await Promise.all(
        FAULT_IDS.map(async (fault): Promise<Verdict> => {
          const faultResults = await runWorld(world, await loadFaulted(fault))

          return {
            world: world.id,
            fault,
            results: faultResults,
            failed: failuresOf(faultResults),
          }
        }),
      )

      faulted.push(...batch)
    }

    return { control, faulted }
  })()

  return pending
}

export const verdictFor = (matrix: Matrix, world: ProbeId, fault: FaultId): Verdict => {
  const found = matrix.faulted.find((entry) => entry.world === world && entry.fault === fault)

  if (found === undefined) {
    throw new Error(`no verdict for ${world} on ${fault}`)
  }

  return found
}

export const controlFor = (matrix: Matrix, world: ProbeId): Verdict => {
  const found = matrix.control.find((entry) => entry.world === world)

  if (found === undefined) {
    throw new Error(`no control verdict for ${world}`)
  }

  return found
}

/** Whether a world noticed a fault at all. */
export const detected = (matrix: Matrix, world: ProbeId, fault: FaultId): boolean =>
  verdictFor(matrix, world, fault).failed.length > 0

/** The faults a world caught, in corpus order. */
export const caughtBy = (matrix: Matrix, world: ProbeId): readonly FaultId[] =>
  FAULT_IDS.filter((fault) => detected(matrix, world, fault))

/** The faults a world missed, in corpus order. */
export const missedBy = (matrix: Matrix, world: ProbeId): readonly FaultId[] =>
  FAULT_IDS.filter((fault) => !detected(matrix, world, fault))
