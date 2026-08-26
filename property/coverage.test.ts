/**
 * The measurement with no circularity in it.
 *
 * `detection.test.ts` compares a fault corpus against an example corpus that
 * came from the same list, and says so. This file compares nothing to anything
 * a person wrote: it takes the inputs each probe actually puts in front of the
 * system, classifies each one by which of eight structural situations it is
 * in, and counts how many of the twenty-eight *pairs* of situations any single
 * input ever reaches.
 *
 * The result is the honest case for generating inputs, and it is a factor of
 * twenty-eight rather than a matter of taste: the example corpus reaches six of
 * the eight situations — a good score, and the reason it catches nine faults —
 * and exactly one pair. Every other case tests its situation alone. That is
 * not a criticism of whoever wrote them; it is what writing examples by hand
 * *is*. You write down the case you thought of, and the case you thought of
 * has one thing wrong with it at a time.
 *
 * Bugs that survive review are usually not in the case somebody thought of.
 */

import { describe, expect, it } from 'vitest'
import { interval } from './availability'
import {
  ALL_PAIRS,
  coverageOf,
  pairKey,
  SITUATIONS,
  SITUATION_LABELS,
  situationsOf,
} from './coverage'
import { PROBES, probeNamed } from './probes'

const at = interval

const situations = (a: ReturnType<typeof at>[], b: ReturnType<typeof at>[] = []): string[] =>
  [...situationsOf({ a, b })].sort()

describe('classifying a single input', () => {
  it('sees two ranges that share time as an overlap', () => {
    expect(situations([at(0, 5), at(3, 8)])).toContain('overlap')
  })

  it('separates touching from overlapping, because half-open ranges do', () => {
    expect(situations([at(0, 5), at(5, 9)])).toContain('touch')
    expect(situations([at(0, 5), at(5, 9)])).not.toContain('overlap')
  })

  it('sees a range wholly inside another as containment as well as overlap', () => {
    expect(situations([at(0, 10), at(3, 4)])).toEqual(
      expect.arrayContaining(['containment', 'overlap']),
    )
  })

  it('does not call two identical ranges containment, since neither is inside the other', () => {
    expect(situations([at(0, 10), at(0, 10)])).not.toContain('containment')
  })

  it('sees a range of zero length as degenerate', () => {
    expect(situations([at(3, 3)])).toEqual(['degenerate'])
  })

  it('ignores a degenerate range when looking for overlaps, because it covers nothing', () => {
    expect(situations([at(0, 10), at(3, 3)])).not.toContain('overlap')
  })

  it('sees coordinates below zero and between integers', () => {
    expect(situations([at(-4, -1)])).toContain('negative')
    expect(situations([at(0.5, 1.5)])).toContain('fractional')
  })

  it('sees removals that are not already sorted and disjoint', () => {
    expect(situations([at(0, 10)], [at(6, 7), at(2, 3)])).toContain('unordered-removals')
    expect(situations([at(0, 10)], [at(2, 3), at(6, 7)])).not.toContain('unordered-removals')
  })

  it('needs two removals before their order can be wrong', () => {
    expect(situations([at(0, 10)], [at(6, 7)])).not.toContain('unordered-removals')
  })

  it('counts ranges across both operands when deciding whether many are involved', () => {
    expect(situations([at(0, 1), at(2, 3)], [at(4, 5), at(6, 7)])).toContain('many-ranges')
    expect(situations([at(0, 1), at(2, 3)], [at(4, 5)])).not.toContain('many-ranges')
  })

  it('finds nothing at all in a single ordinary range', () => {
    expect(situations([at(0, 5)])).toEqual([])
  })
})

describe('pairs', () => {
  it('collapses the two orders of a pair onto one key', () => {
    expect(pairKey('touch', 'overlap')).toBe(pairKey('overlap', 'touch'))
  })

  it('enumerates every unordered pair of the eight situations', () => {
    expect(ALL_PAIRS).toHaveLength((SITUATIONS.length * (SITUATIONS.length - 1)) / 2)
    expect(new Set(ALL_PAIRS).size).toBe(ALL_PAIRS.length)
  })

  it('records a pair only when both situations hold in the same input', () => {
    // Two calls that are each in one situation are not a call in two, which is
    // the whole distinction this measurement rests on.
    const together = coverageOf([{ a: [at(0, 10), at(3, 4), at(-2, -1)], b: [] }])
    const apart = coverageOf([
      { a: [at(0, 10), at(3, 4)], b: [] },
      { a: [at(-2, -1)], b: [] },
    ])

    expect(together.pairs).toContain(pairKey('containment', 'negative'))
    expect(apart.pairs).not.toContain(pairKey('containment', 'negative'))
  })
})

describe('what each probe’s inputs reach', () => {
  const report = (id: Parameters<typeof probeNamed>[0]) => coverageOf(probeNamed(id).inputs())

  it('reaches six of the eight situations from twenty-four hand-written cases', () => {
    const examples = report('examples')

    expect(examples.calls).toBe(24)
    expect(examples.situations.size).toBe(6)
  })

  it('reaches exactly one of the twenty-eight pairs from those same cases', () => {
    // The finding. Each example was written to exercise one thing, and does.
    const examples = report('examples')

    expect([...examples.pairs]).toEqual([pairKey('overlap', 'containment')])
  })

  it('reaches ten pairs from two hundred bounded scenarios', () => {
    expect(report('bounded').pairs.size).toBe(10)
  })

  it('reaches seven from the sparse arbitrary, which collides too rarely to combine much', () => {
    expect(report('sparse').pairs.size).toBe(7)
  })

  it('reaches fifteen from the wide arbitrary, which never touches and never degenerates', () => {
    expect(report('wide').pairs.size).toBe(15)
  })

  it('reaches every situation and every pair from the clustered arbitrary', () => {
    const clustered = report('clustered')

    expect(clustered.situations.size).toBe(SITUATIONS.length)
    expect(clustered.pairs.size).toBe(ALL_PAIRS.length)
  })

  it('grows pair coverage faster than situation coverage, which is the argument', () => {
    // The examples reach more *situations* than the bounded arbitrary does and
    // a tenth as many pairs. Situations are what you can write down; pairs are
    // what you cannot.
    const examples = report('examples')
    const bounded = report('bounded')

    expect(examples.situations.size).toBeGreaterThan(bounded.situations.size)
    expect(examples.pairs.size).toBeLessThan(bounded.pairs.size)
  })

  it('draws one input per run for every generated probe', () => {
    for (const probe of PROBES.filter((candidate) => candidate.kind === 'properties')) {
      expect(probe.inputs()).toHaveLength(200)
    }
  })
})

describe('the situation catalogue', () => {
  it('labels every situation for the README', () => {
    for (const situation of SITUATIONS) {
      expect(SITUATION_LABELS[situation].length, situation).toBeGreaterThan(10)
    }
  })
})
