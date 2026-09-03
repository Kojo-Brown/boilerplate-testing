/**
 * The five sources of nondeterminism a service reaches for, behind one seam.
 *
 * ---------------------------------------------------------------------------
 * Why five and not one
 * ---------------------------------------------------------------------------
 * "Make the test deterministic" is usually said as though nondeterminism were
 * a single thing with a single fix. It is not. A session issuer reads the wall
 * clock to stamp an expiry, a monotonic clock to measure how long something
 * took, a random source to jitter a refresh, a scheduler to run that refresh
 * later, and an identity source to name the thing — and every one of those is
 * a different global, controlled by a different technique, failing in a
 * different way when it is not controlled.
 *
 * They are gathered here rather than read inline because the experiment in
 * `README.md` needs to substitute them one at a time. That is already a small
 * dishonesty and it is stated rather than hidden: most code does *not* have
 * this seam, which is exactly why fake timers are popular — they replace the
 * globals themselves and need no seam at all. `probes.ts` keeps that honest by
 * driving three of its five strategies through {@link ambientEnvironment},
 * whose implementations are one-line calls to the real globals, so those
 * probes are measuring what happens to code that never had a port.
 *
 * ---------------------------------------------------------------------------
 * Why the wall clock and the monotonic clock are separate members
 * ---------------------------------------------------------------------------
 * This is the distinction the advice almost always drops, and it is the one
 * fault in `faults.ts` that no amount of faking can reach. `now()` answers
 * "what time is it", which is a fact about the world and can jump backwards
 * when NTP or a DST change says so. `elapsed()` answers "how long has this
 * been running", which is a fact about the process and cannot. Code that
 * measures a duration by subtracting two `Date.now()` readings is wrong, and
 * it is wrong in a way no test can see while the two clocks are locked
 * together — which is precisely what `vi.useFakeTimers()` does to them.
 *
 * Keeping them apart in the interface means a deterministic environment can
 * advance one without the other, and `ELAPSED_FROM_WALL_CLOCK` becomes
 * statable. See `README.md` for the measurement.
 */

import { createRng, type Rng } from '../fuzz/random.ts'

/** Undoes a scheduled callback. Idempotent. */
export type Cancel = () => void

/**
 * Everything `session.ts` is allowed to know about the outside world.
 *
 * Deliberately five plain functions rather than a class or an injected
 * container: the point of the comparison is what each *source* costs to
 * control, and bundling them would hide that some are far cheaper than others.
 */
export interface Environment {
  /** Wall-clock time, milliseconds since the Unix epoch. */
  readonly now: () => number
  /**
   * Monotonic time in milliseconds, from an unspecified origin.
   *
   * Only differences between two readings are meaningful. The origin is
   * deliberately not the epoch so that code cannot quietly use this as a
   * timestamp.
   */
  readonly elapsed: () => number
  /** A float in [0, 1). */
  readonly random: () => number
  /** A fresh identifier. */
  readonly uuid: () => string
  /** Runs `fn` after at least `delayMs`, and returns a way to stop it. */
  readonly schedule: (fn: () => void, delayMs: number) => Cancel
}

/**
 * The real globals, one line each.
 *
 * `now` and `schedule` are read through the global object at call time rather
 * than captured at module load, which is what makes `vi.useFakeTimers()` work
 * through this seam at all: the fake replaces `globalThis.Date` and
 * `globalThis.setTimeout` after this module has already been imported, so a
 * captured reference would still point at the real ones.
 */
export const ambientEnvironment: Environment = {
  now: () => Date.now(),
  elapsed: () => performance.now(),
  random: () => Math.random(),
  uuid: () => crypto.randomUUID(),
  schedule: (fn, delayMs) => {
    const handle = setTimeout(fn, delayMs)

    return () => {
      clearTimeout(handle)
    }
  },
}

/**
 * A clock that can be moved by hand, with the two readings independent.
 *
 * `advance` moves both, which is what the passage of time does. `skew` moves
 * only the wall clock, which is what an NTP correction or a DST transition
 * does, and it is the operation that makes `ELAPSED_FROM_WALL_CLOCK` visible.
 * Nothing here is reachable through `vi.useFakeTimers()`, whose whole design
 * is that the two move together.
 */
export interface ManualClock {
  readonly now: () => number
  readonly elapsed: () => number
  /** Moves wall and monotonic time forward together. */
  readonly advance: (ms: number) => void
  /** Moves the wall clock only. May be negative. */
  readonly skew: (ms: number) => void
}

/** The instant every fixed clock in this directory starts from. */
export const EPOCH = Date.UTC(2026, 0, 1, 12, 0, 0)

/** Where {@link createManualClock} starts its monotonic reading. */
export const MONOTONIC_ORIGIN = 1_000

export function createManualClock(startedAt: number = EPOCH): ManualClock {
  let wall = startedAt
  let monotonic = MONOTONIC_ORIGIN

  return {
    now: () => wall,
    elapsed: () => monotonic,
    advance: (ms) => {
      wall += ms
      monotonic += ms
    },
    skew: (ms) => {
      wall += ms
    },
  }
}

/** A scheduler whose queue only moves when a test says so. */
export interface ManualScheduler {
  readonly schedule: (fn: () => void, delayMs: number) => Cancel
  /** Runs everything due within `ms` of now, in due order, then advances. */
  readonly tick: (ms: number) => void
  /** Callbacks still pending. */
  readonly pending: () => number
}

/**
 * A scheduler that keeps its own timeline rather than borrowing the clock's.
 *
 * It takes the clock it should stay in step with, because a refresh scheduled
 * for `delay` milliseconds from now must fire at the instant `now() + delay`,
 * and a test that advances one without the other is testing a system that
 * cannot exist. `tick` therefore drives the clock as well as the queue.
 */
export function createManualScheduler(clock: ManualClock): ManualScheduler {
  interface Entry {
    readonly dueAt: number
    readonly fn: () => void
    cancelled: boolean
    readonly seq: number
  }

  let entries: Entry[] = []
  let seq = 0

  return {
    schedule: (fn, delayMs) => {
      const entry: Entry = {
        // A negative delay is not an error for `setTimeout` either — it fires
        // on the next turn. Clamping here rather than throwing keeps the
        // scheduler faithful, which matters: `JITTER_NOT_CLAMPED` produces
        // negative delays and a throwing scheduler would report it as a crash
        // rather than as the early refresh it really is.
        dueAt: clock.now() + Math.max(0, delayMs),
        fn,
        cancelled: false,
        seq: seq++,
      }

      entries.push(entry)

      return () => {
        entry.cancelled = true
      }
    },
    // The clock is moved *to each callback's due time before running it*,
    // rather than to the end of the window and then draining the queue. The
    // difference is invisible to a test that only asks whether something
    // fired, and it is the whole of `SCHEDULE_DELAY_IN_SECONDS`: a refresh
    // scheduled a thousand times too early still fires inside the window, and
    // the only way to see the fault is to ask *when*. A scheduler that ran
    // every callback at the end of the tick would report the right time for
    // every one of them.
    tick: (ms) => {
      const until = clock.now() + ms

      for (;;) {
        const next = entries
          .filter((entry) => !entry.cancelled && entry.dueAt <= until)
          .sort((left, right) => left.dueAt - right.dueAt || left.seq - right.seq)[0]

        if (next === undefined) {
          break
        }

        entries = entries.filter((entry) => entry !== next)
        clock.advance(Math.max(0, next.dueAt - clock.now()))
        next.fn()
      }

      clock.advance(Math.max(0, until - clock.now()))
    },
    pending: () => entries.filter((entry) => !entry.cancelled).length,
  }
}

/**
 * A deterministic environment: manual clock, manual scheduler, seeded draws,
 * counted identifiers.
 *
 * The RNG is `fuzz/random.ts`'s mulberry32 rather than a second copy of the
 * same four operations. Two seeded PRNGs in one repository is one PRNG and one
 * liability — the day they diverge, every recorded seed in whichever directory
 * lost the coin toss stops reproducing, and nothing says so.
 *
 * Identifiers are `session-0`, `session-1`, … rather than seeded UUIDs on
 * purpose. A UUID's only contract is uniqueness, so the deterministic version
 * only has to be distinguishable; making it *readable* means a failing
 * assertion prints `session-2` instead of thirty-six hex characters, and the
 * counter is a stronger uniqueness oracle than a draw, which can repeat.
 */
export interface DeterministicEnvironment extends Environment {
  readonly clock: ManualClock
  readonly scheduler: ManualScheduler
  readonly rng: Rng
  /** Identifiers handed out so far. */
  readonly issued: () => number
}

export interface DeterministicOptions {
  readonly seed?: number
  readonly startedAt?: number
  /**
   * Draws to hand out, in order, before falling back to the seeded stream.
   *
   * This is the whole argument of `README.md` in one option. A seed makes a
   * test repeatable; it does not make it *thorough*, because it pins the draw
   * to one sample of a distribution. Enumerating the draws that decide
   * something — 0, the midpoint, just under 1 — is what turns a random input
   * into a set of cases, and it is the only reason the injected probe catches
   * the tail faults at all.
   */
  readonly draws?: readonly number[]
}

/**
 * The seed every deterministic environment uses unless told otherwise.
 *
 * Written down as a constant for the reason `fuzz/settings.ts` gives at
 * length: a seed drawn from the clock is a suite that fails on a different
 * night each week, which is the failure mode the whole directory is about.
 */
export const DEFAULT_SEED = 0xde7e_4d1c

export function createDeterministicEnvironment(
  options: DeterministicOptions = {},
): DeterministicEnvironment {
  const clock = createManualClock(options.startedAt)
  const scheduler = createManualScheduler(clock)
  const rng = createRng(options.seed ?? DEFAULT_SEED)
  const scripted = [...(options.draws ?? [])]

  let count = 0

  return {
    clock,
    scheduler,
    rng,
    now: clock.now,
    elapsed: clock.elapsed,
    random: () => (scripted.length > 0 ? (scripted.shift() as number) : rng.next()),
    uuid: () => `session-${count++}`,
    schedule: scheduler.schedule,
    issued: () => count,
  }
}
