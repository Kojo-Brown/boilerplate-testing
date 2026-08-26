/**
 * The measurement: every probe against every fault.
 *
 * What this file is *not* is a demonstration that property testing wins. Read
 * the totals and the opposite is closer to true — twenty-four hand-written
 * examples catch nine of ten faults and three of the four property probes
 * catch fewer. `examples.ts` says why that comparison is circular: the faults
 * and the examples were written by one person from one list, so they agree
 * with each other by construction, and no fault corpus assembled that way can
 * settle the question.
 *
 * What the matrix *can* settle is the question this spec item is actually
 * about, because it has no such loop in it. Four of the five columns run the
 * **same twenty invariants**. They differ in nothing but the arbitrary, and
 * they catch four, six, seven and ten faults respectively. Whatever a property
 * suite is worth, essentially all of it is decided by the generator — the part
 * that gets skimmed in review — and not by the predicates, which are the part
 * people argue about.
 *
 * The second thing it settles is that neither approach dominates. The examples
 * miss the one fault whose trigger nobody thought to type; the bounded
 * arbitrary misses the two faults that live outside the coordinate range its
 * oracle requires. Both misses are structural rather than unlucky, and both
 * are named below.
 */

import { describe, expect, it } from 'vitest'
import { NUM_RUNS, SEED } from './config'
import { FAULTS } from './faults'
import { caughtBy, missedByEveryProbe, runControl, runMatrix } from './matrix'
import { PROBES, PROBE_IDS, probeNamed } from './probes'

const rows = runMatrix()

const totals = Object.fromEntries(
  PROBES.map((probe) => [probe.id, caughtBy(rows, probe.id).length]),
)

describe('the control: every probe against the system that is not broken', () => {
  it('reports nothing wrong, so every catch in the matrix is about a fault', () => {
    // Without this the whole table could be a row of ticks produced by a probe
    // that condemns everything, and it would look like an excellent result.
    for (const [id, result] of Object.entries(runControl())) {
      expect(result.caught, `${id} condemned the correct implementation`).toBe(false)
    }
  })
})

describe('the detection matrix', () => {
  it('leaves no fault uncaught by every probe, so the corpus is fully covered', () => {
    expect(missedByEveryProbe(rows)).toEqual([])
  })

  it('measures 9, 7, 4, 6 and 10 of the ten faults', () => {
    expect(totals).toEqual({
      examples: 9,
      bounded: 7,
      sparse: 4,
      wide: 6,
      clustered: 10,
    })
  })

  it('records which check noticed first, for every catch', () => {
    for (const row of rows) {
      for (const id of PROBE_IDS) {
        const result = row.results[id]

        expect(
          result.caught ? result.caughtBy : null,
          `${row.fault.id} / ${id}`,
        ).toStrictEqual(result.caught ? expect.any(String) : null)
      }
    }
  })
})

describe('what the arbitrary decides, holding the predicates still', () => {
  it('catches four faults over a realistic coordinate space that never collides', () => {
    // 2.6% overlap, 0.4% touch. Every value legal, the shrinker working, two
    // hundred runs reported — and the merging logic barely executed.
    expect(caughtBy(rows, 'sparse')).toEqual([
      'TOUCHING_NOT_MERGED',
      'DROPS_LAST_RANGE',
      'SUBTRACT_APPLIES_FIRST_ONLY',
      'SUBTRACT_TRUSTS_INPUT_ORDER',
    ])
  })

  it('catches six once coordinates may be negative and fractional', () => {
    expect(caughtBy(rows, 'wide')).toEqual([
      'DROPS_LAST_RANGE',
      'NEGATIVE_START_CLAMPED',
      'FRACTIONAL_ENDPOINTS_ROUNDED',
      'INTERSECT_ADVANCES_BOTH',
      'SUBTRACT_APPLIES_FIRST_ONLY',
      'SUBTRACT_TRUSTS_INPUT_ORDER',
    ])
  })

  it('catches seven over small integers, where the point-set model can run', () => {
    expect(caughtBy(rows, 'bounded')).toEqual([
      'TOUCHING_NOT_MERGED',
      'MERGE_LOSES_FURTHEST_END',
      'DROPS_LAST_RANGE',
      'INTERSECT_ADVANCES_BOTH',
      'SUBTRACT_APPLIES_FIRST_ONLY',
      'SUBTRACT_OVERSHOOTS_BY_ONE',
      'SUBTRACT_TRUSTS_INPUT_ORDER',
    ])
  })

  it('catches all ten once the coordinates are wide and the ranges share a grid', () => {
    expect(caughtBy(rows, 'clustered')).toEqual(FAULTS.map((fault) => fault.id))
  })

  it('loses the one fault an oracle-shaped domain cannot express', () => {
    // The bounded arbitrary is the only one the model runs against and the
    // only one that can see `MERGE_LOSES_FURTHEST_END` cheaply — and it is
    // structurally blind to a coordinate below zero or between two integers.
    for (const fault of ['NEGATIVE_START_CLAMPED', 'FRACTIONAL_ENDPOINTS_ROUNDED'] as const) {
      expect(caughtBy(rows, 'bounded')).not.toContain(fault)
      expect(caughtBy(rows, 'clustered')).toContain(fault)
    }
  })

  it('loses the degenerate case in every arbitrary that cannot generate one', () => {
    // The cost of "build values, never filter them", made concrete: three
    // arbitraries that always produce a positive length, and a `normalise`
    // whose empty-dropping branch none of them ever reaches.
    for (const id of ['bounded', 'sparse', 'wide'] as const) {
      expect(caughtBy(rows, id)).not.toContain('KEEPS_EMPTY_RANGES')
    }

    expect(caughtBy(rows, 'clustered')).toContain('KEEPS_EMPTY_RANGES')
  })
})

describe('where the example suite stops', () => {
  it('misses the fault whose trigger is an input nobody would type by hand', () => {
    // Every removal in `examples.ts` is sorted and disjoint, because that is
    // what a person writing bookings by hand produces and what a database
    // returns. No example was deleted to arrange this.
    expect(caughtBy(rows, 'examples')).not.toContain('SUBTRACT_TRUSTS_INPUT_ORDER')

    for (const id of ['bounded', 'sparse', 'wide', 'clustered'] as const) {
      expect(caughtBy(rows, id), `${id} missed it too`).toContain('SUBTRACT_TRUSTS_INPUT_ORDER')
    }
  })

  it('catches the other nine, which is why the comparison is reported as circular', () => {
    expect(totals.examples).toBe(FAULTS.length - 1)
  })
})

describe('how many runs are worth paying for', () => {
  // The justification for `NUM_RUNS`. A round number nobody measured is the
  // usual way this constant gets chosen, and it decides how much of the suite
  // is real.
  const clusteredAt = (numRuns: number): number =>
    FAULTS.filter(
      (fault) => probeNamed('clustered').run(fault.build(), { seed: SEED, numRuns }).caught,
    ).length

  it('reaches eight of ten at 25 runs and nine at 50', () => {
    expect(clusteredAt(25)).toBe(8)
    expect(clusteredAt(50)).toBe(9)
  })

  it('stays at nine through 100 runs, so doubling from 50 buys nothing', () => {
    expect(clusteredAt(100)).toBe(9)
  })

  it('reaches ten at the 200 runs this directory is configured for', () => {
    // `SUBTRACT_OVERSHOOTS_BY_ONE` is the last one in: it needs a probe point
    // landing exactly on a removal's end while the range it came from extends
    // past it, which is a grid alignment that takes this many draws to hit.
    expect(NUM_RUNS).toBe(200)
    expect(clusteredAt(NUM_RUNS)).toBe(FAULTS.length)
  })
})
