/**
 * A seeded pseudo-random source, written down rather than imported.
 *
 * `Math.random` is unusable here for the reason `settings.ts` gives: a
 * campaign that cannot be replayed is a campaign whose failures cannot be
 * reproduced, and the first thing anybody wants from a fuzzer's find is the
 * input that caused it. Nothing here needs statistical quality — mulberry32 is
 * thirty-two bits of state and four operations, it passes gjrand's smallcrush,
 * and it is reproducible on every engine because every operation is integer
 * arithmetic through `Math.imul` and `>>>`.
 *
 * Kept apart from the generators so that "the same seed produces the same
 * campaign" is a property of one small function that `generators.test.ts` can
 * check directly.
 */

export interface Rng {
  /** A float in [0, 1). */
  next: () => number
  /** An integer in [0, bound). Returns 0 for a bound of 0 or less. */
  int: (bound: number) => number
  /** An element of a non-empty array. */
  pick: <T>(values: readonly T[]) => T
  /** True with the given probability. */
  chance: (probability: number) => boolean
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b_79f5) >>> 0

    let t = state

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  const int = (bound: number): number => (bound <= 0 ? 0 : Math.floor(next() * bound))

  return {
    next,
    int,
    pick: <T,>(values: readonly T[]): T => {
      if (values.length === 0) {
        throw new Error('cannot pick from an empty array')
      }

      return values[int(values.length)] as T
    },
    chance: (probability: number): boolean => next() < probability,
  }
}
