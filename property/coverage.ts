/**
 * What each probe's inputs actually contain — the measurement that does not
 * depend on anyone's fault list.
 *
 * The comparison in `detection.test.ts` has a circularity in it, stated
 * plainly in `examples.ts`: the faults and the examples came from one person's
 * list of ways interval arithmetic goes wrong, so a suite built from that list
 * catching faults built from it is not news. This module measures something
 * that has no such loop in it.
 *
 * The claim being measured is the one property testing actually rests on. Not
 * "generated inputs are better than chosen ones" — a hand-chosen input is
 * usually *better*, because a person chose it for a reason. The claim is about
 * **combinations**: an example exercises the situation it was written for, and
 * the bugs that survive review live where two situations meet. A zero-length
 * range is fine. A pair of touching ranges is fine. A zero-length range
 * sitting exactly where two ranges touch is where a merge loop puts a foot
 * wrong, and nobody writes that example because nobody thinks of it.
 *
 * Situations grow linearly with the effort of writing examples and their pairs
 * grow quadratically, which is the whole argument in one sentence — and it is
 * an argument that can be counted rather than asserted. `coverage.test.ts`
 * counts it: how many of the {@link SITUATIONS} each probe's inputs reach, and
 * how many of the pairs.
 */

import type { Interval } from './availability'
import { isSortedDisjoint } from './arbitraries'

/**
 * The structural situations an input to this system can be in.
 *
 * Chosen before the counting, from the branches `availability.ts` actually
 * has plus the two coordinate classes the model cannot represent. Each one is
 * a yes/no question about a single call's arguments, so a call is a set of
 * situations and a probe is the union over its calls.
 */
export const SITUATIONS = [
  'overlap',
  'touch',
  'containment',
  'degenerate',
  'negative',
  'fractional',
  'unordered-removals',
  'many-ranges',
] as const

export type Situation = (typeof SITUATIONS)[number]

/** How each situation reads in the README's table. */
export const SITUATION_LABELS: Readonly<Record<Situation, string>> = {
  overlap: 'two ranges overlap',
  touch: 'one range ends exactly where another begins',
  containment: 'one range lies wholly inside another',
  degenerate: 'a range covers no time at all',
  negative: 'a coordinate is below zero',
  fractional: 'a coordinate is not a whole number',
  'unordered-removals': 'the set being removed is not already sorted and disjoint',
  'many-ranges': 'four or more ranges are involved at once',
}

/** One call's arguments: a primary set, and a secondary one for binary operations. */
export interface Inputs {
  readonly a: readonly Interval[]
  readonly b: readonly Interval[]
}

const strictlyOverlap = (x: Interval, y: Interval): boolean =>
  x.start < y.end && y.start < x.end && x.end > x.start && y.end > y.start

const touch = (x: Interval, y: Interval): boolean =>
  (x.end === y.start || y.end === x.start) && x.end > x.start && y.end > y.start

const contains = (outer: Interval, inner: Interval): boolean =>
  outer.start <= inner.start &&
  inner.end <= outer.end &&
  inner.end > inner.start &&
  (outer.start < inner.start || inner.end < outer.end)

/** Every situation a single call's arguments are in. */
export function situationsOf({ a, b }: Inputs): ReadonlySet<Situation> {
  const all = [...a, ...b]
  const found = new Set<Situation>()

  for (let i = 0; i < all.length; i += 1) {
    const x = all[i]

    if (x === undefined) {
      continue
    }

    if (x.end <= x.start) {
      found.add('degenerate')
    }

    if (x.start < 0 || x.end < 0) {
      found.add('negative')
    }

    if (!Number.isInteger(x.start) || !Number.isInteger(x.end)) {
      found.add('fractional')
    }

    for (let j = i + 1; j < all.length; j += 1) {
      const y = all[j]

      if (y === undefined) {
        continue
      }

      if (strictlyOverlap(x, y)) {
        found.add('overlap')
      }

      if (touch(x, y)) {
        found.add('touch')
      }

      if (contains(x, y) || contains(y, x)) {
        found.add('containment')
      }
    }
  }

  if (b.length >= 2 && !isSortedDisjoint(b)) {
    found.add('unordered-removals')
  }

  if (all.length >= 4) {
    found.add('many-ranges')
  }

  return found
}

/** A pair key, always in `SITUATIONS` order so the two directions collapse. */
export const pairKey = (left: Situation, right: Situation): string => {
  const [first, second] = [left, right].sort(
    (x, y) => SITUATIONS.indexOf(x) - SITUATIONS.indexOf(y),
  )

  return `${String(first)}+${String(second)}`
}

/** Every unordered pair of distinct situations. There are 28 of them. */
export const ALL_PAIRS: readonly string[] = SITUATIONS.flatMap((left, index) =>
  SITUATIONS.slice(index + 1).map((right) => pairKey(left, right)),
)

export interface CoverageReport {
  /** Situations reached at least once. */
  readonly situations: ReadonlySet<Situation>
  /** Pairs of situations reached together in one call. */
  readonly pairs: ReadonlySet<string>
  /** How many calls were classified. */
  readonly calls: number
}

/** Union the situations and co-occurring pairs over a series of calls. */
export function coverageOf(calls: readonly Inputs[]): CoverageReport {
  const situations = new Set<Situation>()
  const pairs = new Set<string>()

  for (const call of calls) {
    const present = [...situationsOf(call)]

    for (const situation of present) {
      situations.add(situation)
    }

    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        const left = present[i]
        const right = present[j]

        if (left !== undefined && right !== undefined) {
          pairs.add(pairKey(left, right))
        }
      }
    }
  }

  return { situations, pairs, calls: calls.length }
}
