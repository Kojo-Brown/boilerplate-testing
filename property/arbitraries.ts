/**
 * Custom arbitraries: the part of a property test that decides what was
 * actually tested.
 *
 * A property is two things — a predicate and a distribution — and only the
 * first one gets read in review. `fc.assert(fc.property(arb, predicate))` looks
 * like it says "this holds for all inputs". It says "this held for two hundred
 * values `arb` felt like producing", and everything outside `arb`'s reach is
 * exactly as untested as it was before the property was written.
 *
 * The four arbitraries below are a sequence, not a menu. Each fixes a blind
 * spot in the one before it, and every claim made about them here is counted
 * by `profile.ts` and asserted in `arbitraries.test.ts` — the percentages are
 * measurements over 1,000 draws at this repository's seed, not estimates.
 *
 *   1. **`bounded`** — small integers in `[0, DOMAIN)`. The obvious choice, and
 *      the only one the point-set model in `model.ts` can run against, because
 *      the model enumerates every covered point. Ranges collide constantly
 *      (79.0% overlap, 32.8% touch), which makes it the best of the four at
 *      the merging logic — and it cannot represent a negative or fractional
 *      coordinate at all, so two of the ten faults are invisible to it.
 *
 *   2. **`sparse`** — the same construction over a realistic coordinate space:
 *      integers across a decade of minutes. Nothing about it is wrong. Every
 *      value is a legal range, the shrinker works, the property passes — and
 *      two ranges drawn from five million minutes overlap in 2.6% of scenarios
 *      and touch in 0.4%, so the merging branch that `availability.ts` mostly
 *      consists of goes essentially unexercised while the report says two
 *      hundred runs passed. It catches four of ten. This is the failure worth
 *      internalising: the arbitrary was not incorrect, it was uninformative,
 *      and nothing in the output distinguishes the two.
 *
 *   3. **`wide`** — doubles across ±1,000,000, so negative and fractional
 *      coordinates finally appear. It fixes what `sparse` could not reach and
 *      breaks something else, in a way that is worth knowing about because it
 *      is a property of `fc.double` rather than of this code: fast-check draws
 *      doubles across the *bit pattern* space, so a "uniform" range yields a
 *      crowd of denormals and tiny magnitudes around zero. Scenarios overlap
 *      93.2% of the time — more than the bounded arbitrary — and two endpoints
 *      are exactly equal 0.0% of the time, because two independently drawn
 *      doubles never are. Six of ten.
 *
 *   4. **`clustered`** — the whole coordinate space *and* informative, by
 *      drawing one origin and one grid spacing for the entire scenario and
 *      placing every range on that grid. Endpoints coincide exactly, because
 *      `origin + k * unit` is the same double computed twice: 49.4% touch,
 *      80.0% overlap, and it reaches every situation and every one of the 28
 *      situation pairs in `coverage.ts`. Ten of ten.
 *
 * ---------------------------------------------------------------------------
 * Making an arbitrary "always valid" can delete a case
 * ---------------------------------------------------------------------------
 * The textbook first lesson of custom arbitraries is to build values rather
 * than filter them, and the arithmetic is stark: `naiveIntervalDraw` is a valid
 * range 46.4% of the time, and asking for a *sorted disjoint set* of them
 * drops that to 0.1% — one draw in a thousand. Expressed with `fc.pre` that is
 * not slow, it is a hard error ("too many pre-condition failures", 10 runs
 * completed against 20,001 skips); expressed with `.filter` it silently costs
 * roughly a thousand draws per value. `boundedInterval` follows the advice — a
 * start and a length, always valid, nothing discarded.
 *
 * The advice has a cost nobody mentions. A generator that cannot produce an
 * invalid value also cannot produce a *degenerate* one, and `normalise` is
 * documented to drop empty ranges — a behaviour `bounded`, `sparse` and `wide`
 * are all structurally incapable of exercising (0.0% each). `clustered` allows
 * a range of zero length for exactly that reason, generates one in 45.6% of
 * scenarios, and is the only probe that catches `KEEPS_EMPTY_RANGES`.
 */

import fc from 'fast-check'
import { interval, type Interval } from './availability'
import { DOMAIN } from './model'

/** Longest range `boundedInterval` produces, before clamping to the domain. */
export const MAX_BOUNDED_LENGTH = 16

/** Largest range set any arbitrary here produces. */
export const MAX_SET_SIZE = 6

/**
 * The coordinate space `sparseInterval` draws from.
 *
 * Chosen to look like something a person would reach for without thinking —
 * "minutes in a decade" — rather than to be unfair. That is the point: it is
 * the reasonable choice, and it is the one that stops the property exercising
 * anything interesting.
 */
export const SPARSE_MAX = 5_256_000

/** How far the wide and clustered arbitraries reach on either side of zero. */
export const WIDE_BOUND = 1_000_000

/** Grid cells a clustered scenario is laid out over. */
export const GRID_CELLS = 20

// ---------------------------------------------------------------------------
// Bounded: integers the model can be run against
// ---------------------------------------------------------------------------

/** A valid range inside the model's domain, built rather than filtered. */
export const boundedInterval: fc.Arbitrary<Interval> = fc
  .tuple(fc.nat({ max: DOMAIN - 1 }), fc.integer({ min: 1, max: MAX_BOUNDED_LENGTH }))
  .map(([start, length]) => interval(start, Math.min(start + length, DOMAIN)))

export const boundedSet: fc.Arbitrary<Interval[]> = fc.array(boundedInterval, {
  maxLength: MAX_SET_SIZE,
})

/** Reaches just outside the domain on both sides, so `covers` is asked about
 * points that are definitely uncovered as well as points that might be. */
export const boundedPoint: fc.Arbitrary<number> = fc.integer({ min: -2, max: DOMAIN + 1 })

// ---------------------------------------------------------------------------
// The naive draw, kept so its yield can be measured
// ---------------------------------------------------------------------------

/**
 * The unfiltered form of the obvious arbitrary.
 *
 * `naiveInterval` is what a person actually writes; this is the same draw with
 * the filter removed, so `arbitraries.test.ts` can count how much of it a
 * filter discards instead of taking a number on trust.
 */
export const naiveIntervalDraw: fc.Arbitrary<Interval> = fc
  .record({ start: fc.nat({ max: DOMAIN }), end: fc.nat({ max: DOMAIN }) })
  .map(({ start, end }) => interval(start, end))

/** The filtered form: correct, and most of a draw is thrown away. */
export const naiveInterval: fc.Arbitrary<Interval> = naiveIntervalDraw.filter(
  (candidate) => candidate.end > candidate.start,
)

/**
 * The same idea one constraint further on: a *sorted, disjoint* set, filtered.
 *
 * Kept to be measured, not used. Each additional constraint multiplies the
 * rejection rate, and `arbitraries.test.ts` reports the yield at which
 * fast-check's default skip limit turns a passing property into an error.
 */
export const naiveDisjointSetDraw: fc.Arbitrary<Interval[]> = fc.array(naiveIntervalDraw, {
  minLength: 3,
  maxLength: MAX_SET_SIZE,
})

/** Whether a set is already sorted, non-empty and pairwise disjoint. */
export function isSortedDisjoint(intervals: readonly Interval[]): boolean {
  for (let i = 0; i < intervals.length; i += 1) {
    const current = intervals[i]

    if (current === undefined || current.end <= current.start) {
      return false
    }

    const previous = intervals[i - 1]

    if (previous !== undefined && current.start < previous.end) {
      return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Wide: realistic coordinates, unrealistic sparsity
// ---------------------------------------------------------------------------

/** Valid ranges over a realistic coordinate space that almost never collide. */
export const sparseInterval: fc.Arbitrary<Interval> = fc
  .tuple(fc.nat({ max: SPARSE_MAX }), fc.integer({ min: 1, max: MAX_BOUNDED_LENGTH }))
  .map(([start, length]) => interval(start, start + length))

export const sparseSet: fc.Arbitrary<Interval[]> = fc.array(sparseInterval, {
  maxLength: MAX_SET_SIZE,
})

export const sparsePoint: fc.Arbitrary<number> = fc.nat({ max: SPARSE_MAX })

/**
 * A range anywhere in the coordinate space, negative and fractional included.
 *
 * The lower bound on length is `0.5` rather than an arbitrarily small number:
 * at `|start| <= 1e6` a double's spacing is about 1.2e-10, so any length above
 * that is guaranteed to produce `end > start` after rounding. Generating
 * degenerate ranges *here* would confuse two separate lessons; `CLUSTERED`
 * does it deliberately and says why.
 */
export const wideInterval: fc.Arbitrary<Interval> = fc
  .tuple(
    fc.double({ min: -WIDE_BOUND, max: WIDE_BOUND, noNaN: true }),
    fc.double({ min: 0.5, max: 10_000, noNaN: true }),
  )
  .map(([start, length]) => interval(start, start + length))

export const wideSet: fc.Arbitrary<Interval[]> = fc.array(wideInterval, {
  maxLength: MAX_SET_SIZE,
})

export const widePoint: fc.Arbitrary<number> = fc.double({
  min: -WIDE_BOUND,
  max: WIDE_BOUND,
  noNaN: true,
})

// ---------------------------------------------------------------------------
// Scenarios: everything one property needs, drawn from one shared context
// ---------------------------------------------------------------------------

/** The inputs every invariant in `invariants.ts` is stated over. */
export interface Scenario {
  readonly a: Interval[]
  readonly b: Interval[]
  /** A coordinate to ask `covers` about. */
  readonly point: number
}

/** A grid cell: an offset from the origin, and a length in cells. */
type Cell = readonly [number, number]

const cellsArb: fc.Arbitrary<Cell[]> = fc.array(
  fc.tuple(
    fc.nat({ max: GRID_CELLS }),
    // `min: 0` on purpose: a zero-length cell is a degenerate range, and it is
    // the only way any arbitrary here reaches `normalise`'s empty-dropping
    // branch. See the module comment.
    fc.integer({ min: 0, max: 8 }),
  ),
  { maxLength: MAX_SET_SIZE },
)

const onGrid = (origin: number, unit: number, cell: number): number => origin + cell * unit

/**
 * A whole scenario laid out on one shared grid.
 *
 * The shared `origin` and `unit` are what make this informative: `a` and `b`
 * are drawn over the same twenty cells, so they collide constantly, and two
 * endpoints computed as `origin + k * unit` for the same `k` are the same
 * double — which is the only way ranges built from floating-point coordinates
 * ever touch exactly. Drawing the origin *inside* the tuple rather than per
 * range is the technique worth stealing: shared context goes in one draw and
 * is distributed by `map`, which keeps the shrinker intact.
 */
export const clusteredScenario: fc.Arbitrary<Scenario> = fc
  .tuple(
    fc.double({ min: -WIDE_BOUND, max: WIDE_BOUND, noNaN: true }),
    fc.double({ min: 0.25, max: 4, noNaN: true }),
    cellsArb,
    cellsArb,
    fc.nat({ max: GRID_CELLS }),
    // Half the probes land exactly on a boundary, which is where the
    // off-by-one faults in `faults.ts` live; the other half land between two.
    fc.constantFrom(0, 0.5),
  )
  .map(([origin, unit, cellsA, cellsB, probeCell, probeOffset]) => ({
    a: cellsA.map(([start, length]) =>
      interval(onGrid(origin, unit, start), onGrid(origin, unit, start + length)),
    ),
    b: cellsB.map(([start, length]) =>
      interval(onGrid(origin, unit, start), onGrid(origin, unit, start + length)),
    ),
    point: onGrid(origin, unit, probeCell + probeOffset),
  }))

export const boundedScenario: fc.Arbitrary<Scenario> = fc.record({
  a: boundedSet,
  b: boundedSet,
  point: boundedPoint,
})

export const sparseScenario: fc.Arbitrary<Scenario> = fc.record({
  a: sparseSet,
  b: sparseSet,
  point: sparsePoint,
})

export const wideScenario: fc.Arbitrary<Scenario> = fc.record({
  a: wideSet,
  b: wideSet,
  point: widePoint,
})

/** Which arbitrary a probe ran under. */
export const SAMPLE_IDS = ['bounded', 'sparse', 'wide', 'clustered'] as const

export type SampleId = (typeof SAMPLE_IDS)[number]

export interface Sample {
  readonly id: SampleId
  /** One line, in the README's table. */
  readonly label: string
  /** Whether `model.ts` can be run against values from this arbitrary. */
  readonly modelled: boolean
  readonly scenario: fc.Arbitrary<Scenario>
}

export const SAMPLES: readonly Sample[] = [
  {
    id: 'bounded',
    label: `integers in [0, ${DOMAIN}), lengths 1–${MAX_BOUNDED_LENGTH}`,
    modelled: true,
    scenario: boundedScenario,
  },
  {
    id: 'sparse',
    label: `integers in [0, ${SPARSE_MAX.toLocaleString('en-US')}), lengths 1–${MAX_BOUNDED_LENGTH}`,
    modelled: false,
    scenario: sparseScenario,
  },
  {
    id: 'wide',
    label: `doubles in ±${WIDE_BOUND.toLocaleString('en-US')}, independently placed`,
    modelled: false,
    scenario: wideScenario,
  },
  {
    id: 'clustered',
    label: `doubles in ±${WIDE_BOUND.toLocaleString('en-US')}, on a shared ${GRID_CELLS}-cell grid, degenerate ranges included`,
    modelled: false,
    scenario: clusteredScenario,
  },
]

/**
 * The arbitraries structurally incapable of producing a zero-length range.
 *
 * Declared rather than derived, because it is a claim about how each one is
 * *built* — a start and a positive length — and not a fact about one sample of
 * its output. `arbitraries.test.ts` checks the claim against a thousand draws
 * each, so adding a fourth entry that is merely unlikely to produce one fails.
 */
export const DEGENERATE_FREE_SAMPLES = [
  'bounded',
  'sparse',
  'wide',
] as const satisfies readonly SampleId[]

export function sampleNamed(id: SampleId): Sample {
  const sample = SAMPLES.find((candidate) => candidate.id === id)

  if (sample === undefined) {
    throw new Error(`no sample named ${id}`)
  }

  return sample
}

// ---------------------------------------------------------------------------
// Observing a system's manners
// ---------------------------------------------------------------------------

/**
 * Freeze a set so a system that writes to its argument is caught rather than
 * trusted.
 *
 * `readonly Interval[]` is erased before anything runs, and "does not mutate
 * its input" is a real invariant with a real failure mode — an in-place `sort`
 * is one `.slice()` away. Modules are strict mode, so a write to a frozen
 * object throws rather than failing silently.
 */
export function frozen(intervals: readonly Interval[]): readonly Interval[] {
  return Object.freeze(intervals.map((candidate) => Object.freeze({ ...candidate })))
}
