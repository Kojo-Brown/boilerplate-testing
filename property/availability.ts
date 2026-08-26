/**
 * The system the properties are stated about: a set of half-open time ranges.
 *
 * Every property-based testing example has to pick a subject, and the choice
 * decides whether the exercise teaches anything. A reversed string round-trips
 * in one line and nobody has ever shipped that bug. Interval arithmetic is the
 * opposite: it is genuinely everywhere — calendar availability, rate-limit
 * windows, feature-flag schedules, retention ranges — the invariants are easy
 * to state and hard to satisfy, and the bugs live at boundaries a person
 * writing examples by hand tends not to type.
 *
 * ---------------------------------------------------------------------------
 * Half-open, on purpose
 * ---------------------------------------------------------------------------
 * An interval is `[start, end)`: `start` is inside, `end` is not. This is the
 * convention that makes `[0, 5)` and `[5, 9)` *touch* without overlapping, so
 * they can be merged into `[0, 9)` without double-counting the minute at 5.
 * It is also where the subtlest fault in `faults.ts` lives: merging on `<`
 * instead of `<=` leaves two ranges that describe exactly the same set of
 * points as one, which no point-set comparison can see. Structure and
 * extension are different claims, and `invariants.ts` states both.
 *
 * ---------------------------------------------------------------------------
 * Why there is a factory
 * ---------------------------------------------------------------------------
 * `buildAvailability` exists so `faults.ts` can replace exactly one primitive
 * and get a system that behaves as this one would with that bug written into
 * it — `union`, `intersect` and `subtract` all route through whichever
 * `normalise` they were built with, so a merging bug propagates the way a real
 * one would. The alternative is keeping mutated copies of the whole module
 * around, which rot the moment the real one changes.
 *
 * Nothing else needs the seam: the module-level exports at the bottom are the
 * ordinary way to use this, and read like ordinary functions.
 */

/** A half-open range `[start, end)`. Empty when `end <= start`. */
export interface Interval {
  readonly start: number
  readonly end: number
}

/** The operations a fault may replace. */
export interface Primitives {
  /** Sort, drop empties, and merge everything that overlaps or touches. */
  readonly normalise: (intervals: readonly Interval[]) => Interval[]
  /** The ranges covered by both operands. */
  readonly intersect: (a: readonly Interval[], b: readonly Interval[]) => Interval[]
  /** The ranges covered by `a` and not by `b`. */
  readonly subtract: (a: readonly Interval[], b: readonly Interval[]) => Interval[]
}

/** The whole surface the invariants and the examples are stated over. */
export interface AvailabilityApi extends Primitives {
  /** The ranges covered by either operand. */
  readonly union: (a: readonly Interval[], b: readonly Interval[]) => Interval[]
  /** Whether `point` falls inside any range. */
  readonly covers: (intervals: readonly Interval[], point: number) => boolean
  /** Total covered length, counting overlaps once. */
  readonly duration: (intervals: readonly Interval[]) => number
}

/** Build an interval, so a caller cannot accidentally write `{end, start}`. */
export const interval = (start: number, end: number): Interval => ({ start, end })

/** Whether a range contains anything at all. */
export const isEmpty = (candidate: Interval): boolean => candidate.end <= candidate.start

/**
 * Sort by start, then by end; drop empties; merge overlapping and touching.
 *
 * The comparator tie-breaks on `end` so the order is total rather than merely
 * stable — `[0, 9)` and `[0, 3)` have the same start, and leaving their order
 * to the input would make `normalise` depend on how the caller happened to
 * build the array, which is exactly the class of bug the "same set of points
 * in, same output out" invariant exists to catch.
 */
function defaultNormalise(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    // `filter` already returns a fresh array, which is what keeps the sort off
    // the caller's — `normalise/does-not-mutate-input` is a property here, and
    // an in-place sort is the bug it exists to catch.
    .filter((candidate) => !isEmpty(candidate))
    .sort((left, right) => left.start - right.start || left.end - right.end)

  const merged: Interval[] = []

  for (const candidate of sorted) {
    const last = merged[merged.length - 1]

    // `<=` rather than `<`: half-open ranges that touch describe one
    // uninterrupted stretch, so `[0, 5)` and `[5, 9)` merge.
    if (last !== undefined && candidate.start <= last.end) {
      if (candidate.end > last.end) {
        merged[merged.length - 1] = interval(last.start, candidate.end)
      }
    } else {
      merged.push(candidate)
    }
  }

  return merged
}

/**
 * Two-pointer sweep over both normalised sets.
 *
 * Advancing whichever side ends first is what makes this linear rather than
 * quadratic, and it is the line `INTERSECT_ADVANCES_BOTH` breaks: advancing
 * both pointers looks symmetrical and silently skips every range that overlaps
 * two on the other side.
 */
const makeIntersect =
  (normalise: Primitives['normalise']) =>
  (a: readonly Interval[], b: readonly Interval[]): Interval[] => {
    const left = normalise(a)
    const right = normalise(b)
    const overlaps: Interval[] = []

    let i = 0
    let j = 0

    while (i < left.length && j < right.length) {
      const x = left[i]
      const y = right[j]

      if (x === undefined || y === undefined) {
        break
      }

      const start = Math.max(x.start, y.start)
      const end = Math.min(x.end, y.end)

      if (end > start) {
        overlaps.push(interval(start, end))
      }

      if (x.end < y.end) {
        i += 1
      } else {
        j += 1
      }
    }

    return overlaps
  }

/**
 * Walk each range of `a`, carrying a cursor past everything `b` removes.
 *
 * The output is already normalised — the pieces come out in order, and any two
 * pieces from the same range are separated by the range of `b` that split them
 * — which is why nothing here calls `normalise` on the way out. That is a
 * claim, so `invariants.ts` states it as one rather than trusting this comment.
 */
const makeSubtract =
  (normalise: Primitives['normalise']) =>
  (a: readonly Interval[], b: readonly Interval[]): Interval[] => {
    const left = normalise(a)
    const right = normalise(b)
    const remaining: Interval[] = []

    for (const range of left) {
      let cursor = range.start

      for (const removed of right) {
        if (removed.end <= cursor) {
          continue
        }

        if (removed.start >= range.end) {
          break
        }

        if (removed.start > cursor) {
          remaining.push(interval(cursor, removed.start))
        }

        cursor = removed.end

        if (cursor >= range.end) {
          break
        }
      }

      if (cursor < range.end) {
        remaining.push(interval(cursor, range.end))
      }
    }

    return remaining
  }

/**
 * Assemble an API, optionally with one primitive replaced.
 *
 * `union`, `covers` and `duration` are derived rather than replaceable: each
 * is a one-liner over a primitive, so a bug in one of them is a bug in the
 * primitive it delegates to, and offering them as override points would invite
 * faults that cannot happen.
 */
export function buildAvailability(overrides: Partial<Primitives> = {}): AvailabilityApi {
  const normalise = overrides.normalise ?? defaultNormalise
  const intersect = overrides.intersect ?? makeIntersect(normalise)
  const subtract = overrides.subtract ?? makeSubtract(normalise)

  const union = (a: readonly Interval[], b: readonly Interval[]): Interval[] =>
    normalise([...a, ...b])

  const covers = (intervals: readonly Interval[], point: number): boolean =>
    intervals.some((candidate) => point >= candidate.start && point < candidate.end)

  const duration = (intervals: readonly Interval[]): number =>
    normalise(intervals).reduce((total, candidate) => total + (candidate.end - candidate.start), 0)

  return { normalise, intersect, subtract, union, covers, duration }
}

/**
 * Structural equality over range sets: same length, same endpoints, same order.
 *
 * Deliberately exact on the numbers rather than tolerant. None of the
 * operations here does arithmetic on a coordinate — they compare, copy and
 * take minima and maxima of values the caller supplied — so two runs that
 * agree should agree bit for bit, and a tolerance would only hide the one
 * fault (`FRACTIONAL_ROUNDED`) that invents coordinates of its own. `duration`
 * does subtract, which is why the invariants that use it are stated over the
 * integer domain only.
 */
export function sameIntervals(a: readonly Interval[], b: readonly Interval[]): boolean {
  if (a.length !== b.length) {
    return false
  }

  return a.every((candidate, index) => {
    const other = b[index]

    return other !== undefined && candidate.start === other.start && candidate.end === other.end
  })
}

/** Render a set the way every failure message in this directory renders it. */
export const showIntervals = (intervals: readonly Interval[]): string =>
  `[${intervals.map((candidate) => `[${candidate.start}, ${candidate.end})`).join(', ')}]`

/** The real system. Everything below is this object, unpacked. */
export const availability: AvailabilityApi = buildAvailability()

export const { normalise, intersect, subtract, union, covers, duration } = availability
