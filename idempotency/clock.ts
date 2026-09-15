/**
 * The clock, as a value.
 *
 * One hazard in this directory — `key-expired` — is entirely about time, and
 * there are exactly two ways to pose it. Sleep past a real TTL, which makes the
 * suite as slow as the TTL is long and the TTL as short as the suite can bear
 * (so the thing under test is a five-millisecond expiry nobody would deploy);
 * or hand the subject a clock and move it. This directory does the second,
 * which is `CLAUDE.md`'s "deterministic by construction: injected clocks,
 * seeded RNG, no sleeps" applied to the one hazard that needs it.
 *
 * The secondary reason is `determinism/registry.ts`. That gate is closed in
 * both directions — every ambient read of a clock, a random source or an
 * identity source in this repository needs a row stating why it is allowed to
 * stay. A `Date.now()` here would need one, and the honest row would have to
 * say "because the subject was written to read the clock instead of being
 * given one", which is a confession rather than a reason.
 *
 * `IdentitySource` is here for the same reason and is the less obvious of the
 * two. A charge needs an id, and `crypto.randomUUID()` is what a service would
 * call — but the matrix reports *which charge the client was told about*, and
 * a random id makes every cell's detail line different on every run, so a
 * failing cell cannot be diffed against a passing one. A counter per run makes
 * the whole eighty-eight cell table byte-identical between runs, which is what
 * lets `matrix.test.ts` compare it to a README written by hand.
 */

/** A clock that only moves when somebody moves it. */
export interface Clock {
  now(): number
  advance(milliseconds: number): void
}

/** Ids that are unique within a run and identical between runs. */
export interface IdentitySource {
  next(prefix: string): string
}

export const START_TIME = 1_700_000_000_000

/**
 * A clock starting at a fixed epoch.
 *
 * The epoch is a real one (2023-11-14T22:13:20Z) rather than 0 so that a
 * timestamp appearing in a failure message reads as a date and not as a bug in
 * the formatting.
 */
export function createClock(start: number = START_TIME): Clock {
  let current = start

  return {
    now: () => current,
    advance: (milliseconds: number) => {
      current += milliseconds
    },
  }
}

/** Ids of the form `ch_1`, `ch_2`, … — stable across runs by construction. */
export function createIdentitySource(): IdentitySource {
  const counters = new Map<string, number>()

  return {
    next: (prefix: string) => {
      const count = (counters.get(prefix) ?? 0) + 1

      counters.set(prefix, count)

      return `${prefix}_${count}`
    },
  }
}
