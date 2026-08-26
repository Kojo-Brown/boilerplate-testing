/**
 * The example suite this repository is comparing properties against.
 *
 * Written the way a careful person writes one: read the documentation in
 * `availability.ts`, list the behaviours it claims, and write a case for each —
 * empty input, one range, disjoint, unsorted, overlapping, touching, contained,
 * degenerate, negative, fractional, and one worked case per operation. It is a
 * genuinely decent suite, not a straw man, and `detection.test.ts` reports
 * exactly what it catches.
 *
 * ---------------------------------------------------------------------------
 * The circularity, stated up front
 * ---------------------------------------------------------------------------
 * These examples and the faults in `faults.ts` were written by the same person
 * from the same list of ways interval arithmetic goes wrong. A comparison
 * between them is therefore not evidence that example suites are good — it is
 * evidence that a fault corpus and an example corpus drawn from one list agree
 * with each other. `README.md` says so where it reports the result, and the
 * two measurements that *are* independent of that choice are elsewhere: the
 * differences between the three property probes (same predicates, different
 * arbitraries) and the situation-coverage counts in `coverage.ts`.
 *
 * One fault does escape the circle, and it is worth understanding why. The
 * removals in every example below are tidy — sorted, disjoint — because that
 * is what an author writing bookings by hand produces, and what a database
 * returns. `SUBTRACT_TRUSTS_INPUT_ORDER` is invisible to tidy removals. No
 * example here was removed to make that happen; the case simply never occurred
 * to the person writing them, which is the entire argument for generating
 * inputs instead.
 *
 * ---------------------------------------------------------------------------
 * Shape
 * ---------------------------------------------------------------------------
 * Each example is `actual` plus `expected` rather than a body containing an
 * assertion, so `examples.test.ts` can run them through `expect(...).toEqual`
 * with real diffs while `probes.ts` runs the identical cases against a broken
 * system. The reader sees one corpus, and the matrix is measured from it.
 */

import { interval, sameIntervals, type AvailabilityApi, type Interval } from './availability'

/** The three shapes an example asserts on. */
export type ExampleValue = readonly Interval[] | boolean | number

export interface Example {
  readonly id: string
  /** The behaviour, in the same voice as a test title. */
  readonly title: string
  /** Which documented behaviour this case exists for. */
  readonly covers: string
  readonly actual: (api: AvailabilityApi) => ExampleValue
  readonly expected: ExampleValue
}

/** Compare two example values without needing a test runner. */
export function valuesMatch(actual: ExampleValue, expected: ExampleValue): boolean {
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return sameIntervals(actual, expected)
  }

  return actual === expected
}

const at = (start: number, end: number): Interval => interval(start, end)

export const EXAMPLES: readonly Example[] = [
  {
    id: 'normalise/empty-input',
    title: 'normalising nothing gives nothing',
    covers: 'the degenerate case every function needs one of',
    actual: (api) => api.normalise([]),
    expected: [],
  },
  {
    id: 'normalise/single-range',
    title: 'a lone range comes back as itself',
    covers: 'the simplest non-trivial input',
    actual: (api) => api.normalise([at(2, 5)]),
    expected: [at(2, 5)],
  },
  {
    id: 'normalise/disjoint-ranges-kept-apart',
    title: 'two ranges with a gap between them stay two ranges',
    covers: 'merging must not be over-eager',
    actual: (api) => api.normalise([at(0, 2), at(5, 7)]),
    expected: [at(0, 2), at(5, 7)],
  },
  {
    id: 'normalise/unsorted-input-comes-back-sorted',
    title: 'ranges given out of order come back in order',
    covers: 'the output is sorted by start',
    actual: (api) => api.normalise([at(5, 7), at(0, 2)]),
    expected: [at(0, 2), at(5, 7)],
  },
  {
    id: 'normalise/overlapping-ranges-merged',
    title: 'two overlapping ranges become one',
    covers: 'the merging branch',
    actual: (api) => api.normalise([at(0, 5), at(3, 8)]),
    expected: [at(0, 8)],
  },
  {
    id: 'normalise/touching-ranges-merged',
    title: 'a range ending where the next begins becomes one uninterrupted range',
    covers: 'half-open ranges that touch describe one stretch',
    actual: (api) => api.normalise([at(0, 5), at(5, 9)]),
    expected: [at(0, 9)],
  },
  {
    id: 'normalise/contained-range-absorbed',
    title: 'a range inside another leaves the outer one intact',
    covers: 'merging keeps whichever end is further out',
    actual: (api) => api.normalise([at(0, 10), at(3, 4)]),
    expected: [at(0, 10)],
  },
  {
    id: 'normalise/empty-range-dropped',
    title: 'a range covering no time is discarded',
    covers: 'empty ranges are dropped',
    actual: (api) => api.normalise([at(3, 3), at(6, 8)]),
    expected: [at(6, 8)],
  },
  {
    id: 'normalise/negative-coordinates-kept',
    title: 'ranges before the origin survive unchanged',
    covers: 'coordinates are ordinary numbers, not offsets into an array',
    actual: (api) => api.normalise([at(-5, -1), at(0, 2)]),
    expected: [at(-5, -1), at(0, 2)],
  },
  {
    id: 'normalise/fractional-coordinates-kept',
    title: 'a range that starts halfway through a unit keeps its endpoints',
    covers: 'coordinates are not required to be whole numbers',
    actual: (api) => api.normalise([at(0.5, 1.5)]),
    expected: [at(0.5, 1.5)],
  },
  {
    id: 'union/disjoint-operands',
    title: 'the union of two separate ranges holds both',
    covers: 'union delegates to normalise over the concatenation',
    actual: (api) => api.union([at(0, 4)], [at(6, 9)]),
    expected: [at(0, 4), at(6, 9)],
  },
  {
    id: 'union/overlapping-operands',
    title: 'the union of two overlapping ranges is one range',
    covers: 'union merges across its operands, not only within them',
    actual: (api) => api.union([at(0, 6)], [at(4, 9)]),
    expected: [at(0, 9)],
  },
  {
    id: 'intersect/overlap-only',
    title: 'the intersection of two overlapping ranges is the overlap',
    covers: 'the two-pointer sweep, in its simplest form',
    actual: (api) => api.intersect([at(0, 10)], [at(4, 20)]),
    expected: [at(4, 10)],
  },
  {
    id: 'intersect/disjoint-operands',
    title: 'ranges that never meet intersect to nothing',
    covers: 'an empty result is a legitimate answer',
    actual: (api) => api.intersect([at(0, 3)], [at(5, 9)]),
    expected: [],
  },
  {
    id: 'intersect/one-range-over-two',
    title: 'a long range overlapping two short ones keeps both overlaps',
    covers: 'the sweep advances only the side that ends first',
    actual: (api) => api.intersect([at(0, 10)], [at(1, 3), at(5, 7)]),
    expected: [at(1, 3), at(5, 7)],
  },
  {
    id: 'subtract/removes-the-middle',
    title: 'removing a range from the middle of another splits it in two',
    covers: 'the cursor walk, in its simplest form',
    actual: (api) => api.subtract([at(0, 10)], [at(4, 6)]),
    expected: [at(0, 4), at(6, 10)],
  },
  {
    id: 'subtract/removes-two-bookings',
    title: 'two bookings in one day leave three free stretches',
    covers: 'every range of the second operand is applied',
    actual: (api) => api.subtract([at(0, 10)], [at(2, 3), at(6, 7)]),
    expected: [at(0, 2), at(3, 6), at(7, 10)],
  },
  {
    id: 'subtract/removes-from-the-start',
    title: 'a booking at the start of the day leaves exactly the rest of it',
    covers: 'the removal is half-open — the instant it ends is free again',
    actual: (api) => api.subtract([at(0, 10)], [at(0, 4)]),
    expected: [at(4, 10)],
  },
  {
    id: 'subtract/removes-everything',
    title: 'removing a range from itself leaves nothing',
    covers: 'an empty result is a legitimate answer',
    actual: (api) => api.subtract([at(0, 5)], [at(0, 5)]),
    expected: [],
  },
  {
    id: 'subtract/removal-outside-the-range',
    title: 'a booking on another day changes nothing',
    covers: 'removals that do not intersect are skipped',
    actual: (api) => api.subtract([at(0, 5)], [at(20, 25)]),
    expected: [at(0, 5)],
  },
  {
    id: 'covers/start-is-inside',
    title: 'a range covers the instant it begins',
    covers: 'the range is closed on the left',
    actual: (api) => api.covers([at(2, 5)], 2),
    expected: true,
  },
  {
    id: 'covers/end-is-outside',
    title: 'a range does not cover the instant it ends',
    covers: 'the range is open on the right',
    actual: (api) => api.covers([at(2, 5)], 5),
    expected: false,
  },
  {
    id: 'duration/counts-overlap-once',
    title: 'overlapping ranges are counted once, not twice',
    covers: 'duration is measured over the normalised set',
    actual: (api) => api.duration([at(0, 5), at(3, 8)]),
    expected: 8,
  },
  {
    id: 'duration/of-nothing-is-zero',
    title: 'an empty availability lasts no time',
    covers: 'the degenerate case',
    actual: (api) => api.duration([]),
    expected: 0,
  },
]

export function exampleNamed(id: string): Example {
  const example = EXAMPLES.find((candidate) => candidate.id === id)

  if (example === undefined) {
    throw new Error(`no example named ${id}`)
  }

  return example
}
