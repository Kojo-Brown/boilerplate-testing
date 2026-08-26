/**
 * An obviously-correct reference implementation, and why it is not the one
 * that ships.
 *
 * Model-based property testing is the strongest of the three families in
 * `invariants.ts`, and the one people skip. The other two ask the system to
 * agree with *itself*: `normalise` is idempotent, `intersect` is commutative,
 * the output is sorted. Those are real constraints, but a system can satisfy
 * every one of them and still compute the wrong answer — an implementation
 * that always returns `[]` is idempotent, commutative and impeccably sorted.
 *
 * A model closes that hole by answering the same question a second time, in a
 * form so simple it can be read for correctness rather than tested: expand
 * every range into the set of integer points it covers, and do set arithmetic.
 * There is no sweep, no cursor, no comparator, and nothing to get wrong at a
 * boundary — which is exactly why it cannot be the production implementation.
 * It is O(covered length) in time and memory, so a calendar spanning a year in
 * seconds would be thirty-one million entries per operand.
 *
 * That cost is not a footnote; it is the constraint that shapes the whole
 * exercise. Because the model has to enumerate points, the arbitrary that
 * feeds it must generate small integers — which means every fault that only
 * shows up at a negative coordinate, or a fractional one, is invisible to the
 * strongest probe in the suite. `detection.test.ts` measures precisely that,
 * and `README.md` states it as the finding rather than the caveat.
 */

import { interval, type Interval } from './availability'

/**
 * The exclusive upper bound on coordinates the model is used over.
 *
 * `arbitraries.ts` generates inside `[0, DOMAIN)`, `model.ts` enumerates over
 * it, and `assertWithinDomain` refuses anything else — a model quietly given
 * an out-of-range input would report a difference that is the model's fault
 * rather than the system's.
 *
 * 64 is small enough that a 200-run property costs microseconds and large
 * enough that random ranges genuinely collide; `arbitraries.test.ts` measures
 * how often, because "large enough" is not a thing to assert on faith.
 */
export const DOMAIN = 64

/** The model's representation: the set of integer points a range set covers. */
export type PointSet = ReadonlySet<number>

/** Anything the model is asked about must be an integer inside the domain. */
export function assertWithinDomain(intervals: readonly Interval[]): void {
  for (const candidate of intervals) {
    const ok =
      Number.isInteger(candidate.start) &&
      Number.isInteger(candidate.end) &&
      candidate.start >= 0 &&
      candidate.end <= DOMAIN

    if (!ok) {
      throw new RangeError(
        `model is only defined on integer ranges inside [0, ${DOMAIN}); got ` +
          `[${candidate.start}, ${candidate.end})`,
      )
    }
  }
}

/** Every integer point the ranges cover, counted once. */
export function toPoints(intervals: readonly Interval[]): PointSet {
  assertWithinDomain(intervals)

  const points = new Set<number>()

  for (const candidate of intervals) {
    for (let point = candidate.start; point < candidate.end; point += 1) {
      points.add(point)
    }
  }

  return points
}

/**
 * The canonical range set covering exactly these points.
 *
 * This is the half of the round-trip that has to make a choice: many range
 * sets cover the same points and only one of them is sorted, non-empty and
 * non-touching. Building it by walking the sorted points and starting a new
 * range wherever the sequence breaks makes that choice the obvious way, which
 * is what lets `normalise(x)` be compared against it directly.
 */
export function fromPoints(points: PointSet): Interval[] {
  const sorted = [...points].sort((left, right) => left - right)
  const intervals: Interval[] = []

  let start: number | null = null
  let previous: number | null = null

  for (const point of sorted) {
    if (start === null || previous === null) {
      start = point
    } else if (point !== previous + 1) {
      intervals.push(interval(start, previous + 1))
      start = point
    }

    previous = point
  }

  if (start !== null && previous !== null) {
    intervals.push(interval(start, previous + 1))
  }

  return intervals
}

/** Set union, which is what `union` has to agree with. */
export const unionPoints = (a: PointSet, b: PointSet): PointSet => new Set([...a, ...b])

/** Set intersection, which is what `intersect` has to agree with. */
export const intersectPoints = (a: PointSet, b: PointSet): PointSet =>
  new Set([...a].filter((point) => b.has(point)))

/** Set difference, which is what `subtract` has to agree with. */
export const subtractPoints = (a: PointSet, b: PointSet): PointSet =>
  new Set([...a].filter((point) => !b.has(point)))

/** Order-insensitive comparison, so a failure is about content not iteration. */
export function samePoints(a: PointSet, b: PointSet): boolean {
  if (a.size !== b.size) {
    return false
  }

  for (const point of a) {
    if (!b.has(point)) {
      return false
    }
  }

  return true
}
