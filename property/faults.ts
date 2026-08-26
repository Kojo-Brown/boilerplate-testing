/**
 * Ten broken availability systems, one per way this code can plausibly go
 * wrong.
 *
 * `README.md` makes a claim that is easy to state and easy to get wrong: a
 * property suite sees a different class of defect than an example suite, and
 * *which* class depends on the arbitrary far more than on the predicate.
 * `detection.test.ts` settles it by running every probe against every system
 * below and deriving the README's matrix from the result. Nothing in the guide
 * is believed on the strength of sounding right.
 *
 * ---------------------------------------------------------------------------
 * Faults as flags, not as copies
 * ---------------------------------------------------------------------------
 * The obvious way to build a broken `normalise` is to copy the real one and
 * change a character. It works and it rots: the copy drifts from the original,
 * and one day the fault is no longer the bug it claims to be — or is no longer
 * a bug at all — with nothing to say so.
 *
 * So `normaliseWith` is a *single* implementation carrying one flag per way it
 * can be broken, and the correct setting of every flag is `CORRECT_NORMALISE`.
 * Two things then become checkable rather than promised, and `faults.test.ts`
 * checks both:
 *
 *   - `normaliseWith(CORRECT_NORMALISE)` agrees with the real `normalise` on
 *     every input either arbitrary can produce. That pins the copy to the
 *     original: change `availability.ts` and this file fails until it follows.
 *   - Every fault below differs from `CORRECT_NORMALISE` in exactly one flag.
 *     "Single behaviour change" is the whole basis of the matrix — a fault
 *     that broke two things at once would be caught by more probes for
 *     uninteresting reasons.
 *
 * Two of the three `subtract` faults need no flag at all: each is a wrapper
 * that hands the real implementation a slightly wrong second operand, which is
 * a faithful model of the bug — a loop that returns on its first iteration, an
 * off-by-one on a boundary — and cannot drift from the original in any
 * direction. Where a wrapper can express the bug, it is the better tool.
 */

import {
  availability,
  buildAvailability,
  interval,
  type AvailabilityApi,
  type Interval,
} from './availability'

// ---------------------------------------------------------------------------
// normalise, with a flag per way it breaks
// ---------------------------------------------------------------------------

export interface NormaliseFlags {
  /** Discard ranges that cover nothing. Correct: `true`. */
  readonly dropEmpty: boolean
  /** Merge ranges that touch as well as those that overlap. Correct: `true`. */
  readonly mergeTouching: boolean
  /** When merging, keep whichever end is further out. Correct: `true`. */
  readonly extendToFurthestEnd: boolean
  /** Return the whole merged set. Correct: `true`. */
  readonly keepLast: boolean
  /** Pull negative coordinates up to zero. Correct: `false`. */
  readonly clampNegative: boolean
  /** Round fractional coordinates to whole units. Correct: `false`. */
  readonly roundEndpoints: boolean
}

export const CORRECT_NORMALISE: NormaliseFlags = {
  dropEmpty: true,
  mergeTouching: true,
  extendToFurthestEnd: true,
  keepLast: true,
  clampNegative: false,
  roundEndpoints: false,
}

/** The keys a fault may flip, in a stable order for reporting. */
export const NORMALISE_FLAGS = Object.keys(CORRECT_NORMALISE) as (keyof NormaliseFlags)[]

export function normaliseWith(
  flags: NormaliseFlags,
): (intervals: readonly Interval[]) => Interval[] {
  return (intervals: readonly Interval[]): Interval[] => {
    const prepared = intervals.map((candidate) => {
      let { start, end } = candidate

      if (flags.clampNegative) {
        start = Math.max(0, start)
        end = Math.max(0, end)
      }

      if (flags.roundEndpoints) {
        start = Math.round(start)
        end = Math.round(end)
      }

      return interval(start, end)
    })

    const sorted = prepared
      .filter((candidate) => !flags.dropEmpty || candidate.end > candidate.start)
      .sort((left, right) => left.start - right.start || left.end - right.end)

    const merged: Interval[] = []

    for (const candidate of sorted) {
      const last = merged[merged.length - 1]
      const continues =
        last !== undefined &&
        (flags.mergeTouching ? candidate.start <= last.end : candidate.start < last.end)

      if (last !== undefined && continues) {
        if (!flags.extendToFurthestEnd || candidate.end > last.end) {
          merged[merged.length - 1] = interval(last.start, candidate.end)
        }
      } else {
        merged.push(candidate)
      }
    }

    return flags.keepLast ? merged : merged.slice(0, -1)
  }
}

/** The flagged implementation with every flag set correctly. */
export const BASELINE_NORMALISE = normaliseWith(CORRECT_NORMALISE)

// ---------------------------------------------------------------------------
// intersect, likewise
// ---------------------------------------------------------------------------

export interface IntersectFlags {
  /**
   * Advance both cursors after every comparison instead of only the side that
   * ends first. Correct: `false`.
   *
   * This is the one that looks symmetrical and therefore right. It skips every
   * range that overlaps two on the other side, which needs three ranges in a
   * particular arrangement to show up at all.
   */
  readonly advanceBoth: boolean
}

export const CORRECT_INTERSECT: IntersectFlags = { advanceBoth: false }

export function intersectWith(
  flags: IntersectFlags,
  normalise: (intervals: readonly Interval[]) => Interval[],
): (a: readonly Interval[], b: readonly Interval[]) => Interval[] {
  return (a: readonly Interval[], b: readonly Interval[]): Interval[] => {
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

      if (flags.advanceBoth) {
        i += 1
        j += 1
      } else if (x.end < y.end) {
        i += 1
      } else {
        j += 1
      }
    }

    return overlaps
  }
}

export const BASELINE_INTERSECT = intersectWith(CORRECT_INTERSECT, availability.normalise)

// ---------------------------------------------------------------------------
// subtract, likewise
// ---------------------------------------------------------------------------

export interface SubtractFlags {
  /**
   * Normalise the set being removed before walking it. Correct: `true`.
   *
   * The realistic version of this bug is not a typo — it is an assumption. The
   * caller's bookings arrive sorted and disjoint because that is what the
   * database returns, so normalising them looks like wasted work, and the code
   * is correct for as long as that stays true. It is also the one fault in
   * this corpus the example suite misses, for the same reason: an example
   * author writing removals by hand writes them tidy.
   */
  readonly normaliseRemovals: boolean
}

export const CORRECT_SUBTRACT: SubtractFlags = { normaliseRemovals: true }

export function subtractWith(
  flags: SubtractFlags,
  normalise: (intervals: readonly Interval[]) => Interval[],
): (a: readonly Interval[], b: readonly Interval[]) => Interval[] {
  return (a: readonly Interval[], b: readonly Interval[]): Interval[] => {
    const left = normalise(a)
    const right = flags.normaliseRemovals ? normalise(b) : [...b]
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
}

export const BASELINE_SUBTRACT = subtractWith(CORRECT_SUBTRACT, availability.normalise)

// ---------------------------------------------------------------------------
// The faults themselves
// ---------------------------------------------------------------------------

export const FAULT_IDS = [
  'TOUCHING_NOT_MERGED',
  'KEEPS_EMPTY_RANGES',
  'MERGE_LOSES_FURTHEST_END',
  'DROPS_LAST_RANGE',
  'NEGATIVE_START_CLAMPED',
  'FRACTIONAL_ENDPOINTS_ROUNDED',
  'INTERSECT_ADVANCES_BOTH',
  'SUBTRACT_APPLIES_FIRST_ONLY',
  'SUBTRACT_OVERSHOOTS_BY_ONE',
  'SUBTRACT_TRUSTS_INPUT_ORDER',
] as const

export type FaultId = (typeof FAULT_IDS)[number]

export interface Fault {
  readonly id: FaultId
  /** One line, in the README's table, describing the bug as a user meets it. */
  readonly description: string
  /** The operation whose implementation was changed. */
  readonly operation: 'normalise' | 'intersect' | 'subtract'
  /** The flag that was flipped, or `null` for the wrapper faults. */
  readonly flag: keyof NormaliseFlags | keyof IntersectFlags | keyof SubtractFlags | null
  readonly build: () => AvailabilityApi
}

const withNormaliseFlag = (flag: keyof NormaliseFlags): (() => AvailabilityApi) => {
  const flags: NormaliseFlags = { ...CORRECT_NORMALISE, [flag]: !CORRECT_NORMALISE[flag] }

  return () => buildAvailability({ normalise: normaliseWith(flags) })
}

export const FAULTS: readonly Fault[] = [
  {
    id: 'TOUCHING_NOT_MERGED',
    description:
      'two ranges that meet exactly — 09:00–10:00 and 10:00–11:00 — are reported as two ' +
      'separate slots instead of one two-hour slot',
    operation: 'normalise',
    flag: 'mergeTouching',
    build: withNormaliseFlag('mergeTouching'),
  },
  {
    id: 'KEEPS_EMPTY_RANGES',
    description: 'a slot that starts and ends at the same instant survives into the output',
    operation: 'normalise',
    flag: 'dropEmpty',
    build: withNormaliseFlag('dropEmpty'),
  },
  {
    id: 'MERGE_LOSES_FURTHEST_END',
    description:
      'merging an all-day slot with a short one inside it shortens the day to the short one’s end',
    operation: 'normalise',
    flag: 'extendToFurthestEnd',
    build: withNormaliseFlag('extendToFurthestEnd'),
  },
  {
    id: 'DROPS_LAST_RANGE',
    description: 'the last slot of the day is silently missing from every answer',
    operation: 'normalise',
    flag: 'keepLast',
    build: withNormaliseFlag('keepLast'),
  },
  {
    id: 'NEGATIVE_START_CLAMPED',
    description:
      'a slot that starts before the origin — yesterday, in an offset-from-midnight calendar — ' +
      'is pulled forward to the origin',
    operation: 'normalise',
    flag: 'clampNegative',
    build: withNormaliseFlag('clampNegative'),
  },
  {
    id: 'FRACTIONAL_ENDPOINTS_ROUNDED',
    description: 'a slot that starts at 09:30 is rounded to the nearest whole unit',
    operation: 'normalise',
    flag: 'roundEndpoints',
    build: withNormaliseFlag('roundEndpoints'),
  },
  {
    id: 'INTERSECT_ADVANCES_BOTH',
    description:
      'when one long slot overlaps two shorter ones, the second overlap is dropped from the ' +
      'intersection',
    operation: 'intersect',
    flag: 'advanceBoth',
    build: () =>
      buildAvailability({
        intersect: intersectWith({ advanceBoth: true }, availability.normalise),
      }),
  },
  {
    id: 'SUBTRACT_APPLIES_FIRST_ONLY',
    description: 'only the first booking is removed from the day; the rest stay bookable',
    operation: 'subtract',
    flag: null,
    build: () =>
      buildAvailability({
        // A wrapper rather than a copy: handing the real implementation a
        // truncated second operand is exactly what a loop that returns on its
        // first iteration does, and it cannot drift from the original.
        subtract: (a, b) => availability.subtract(a, b.slice(0, 1)),
      }),
  },
  {
    id: 'SUBTRACT_OVERSHOOTS_BY_ONE',
    description:
      'a booking removes one unit more than it occupies, so the minute after every meeting is ' +
      'unbookable',
    operation: 'subtract',
    flag: null,
    build: () =>
      buildAvailability({
        subtract: (a, b) =>
          availability.subtract(
            a,
            b.map((candidate) => interval(candidate.start, candidate.end + 1)),
          ),
      }),
  },
  {
    id: 'SUBTRACT_TRUSTS_INPUT_ORDER',
    description:
      'bookings that arrive out of order are partly ignored, so a slot stays bookable after it ' +
      'has been booked',
    operation: 'subtract',
    flag: 'normaliseRemovals',
    build: () =>
      buildAvailability({
        subtract: subtractWith({ normaliseRemovals: false }, availability.normalise),
      }),
  },
]

export function faultNamed(id: FaultId): Fault {
  const fault = FAULTS.find((candidate) => candidate.id === id)

  if (fault === undefined) {
    throw new Error(`no fault named ${id}`)
  }

  return fault
}
