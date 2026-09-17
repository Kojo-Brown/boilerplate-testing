/**
 * The clock the whole harness reads.
 *
 * Every age in this directory — how long an environment has existed, whether a
 * TTL has passed — is a difference between two readings of this, and the only
 * way it ever advances is a `tick` step in a timeline. Nothing sleeps, nothing
 * polls and nothing calls `Date.now()`, so a hazard that turns on a TTL
 * boundary lands on the same side of it on every machine and in every CI leg.
 *
 * Minutes rather than milliseconds because that is the unit the decision is
 * actually made in: preview-environment TTLs are written in hours, and a
 * harness whose numbers are 7_200_000 obscures the one comparison it exists to
 * make.
 */

/** A manual clock reading whole minutes since the run began. */
export class Clock {
  #minutes = 0

  /** The current reading, in minutes since zero. */
  now = (): number => this.#minutes

  /** Advance. Refuses to go backwards, which is always a bug in a timeline. */
  advance(minutes: number): void {
    if (minutes < 0) throw new Error(`cannot advance the clock by ${String(minutes)} minutes`)

    this.#minutes += minutes
  }
}

/** Minutes in an hour, so TTLs read as hours where they are declared. */
export const HOUR = 60
