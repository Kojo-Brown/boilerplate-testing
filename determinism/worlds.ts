/**
 * The six ways a test can get a clock, a random source, a scheduler and an
 * identity source — from "whatever the process has" to "all four chosen".
 *
 * ---------------------------------------------------------------------------
 * Why the fake-timer world is modelled rather than installed
 * ---------------------------------------------------------------------------
 * `fakeTimers` and `standard` below do not call `vi.useFakeTimers()`. They
 * build a locked clock — one where the wall and monotonic readings move
 * together and cannot be separated — plus a queue drained by hand, which is
 * exactly what `vi.useFakeTimers()` provides.
 *
 * Two reasons, and the second is the one that matters. The first is
 * mechanical: `vi.useFakeTimers()` replaces globals for the whole process, so
 * no two worlds could run at the same time, and the ambient world would be
 * measuring a fake clock. The second is that a model is only worth anything if
 * it is checked against the thing it models, so `fidelity.test.ts` does that
 * directly, with the real `vi.useFakeTimers()` driving the real
 * `ambientEnvironment`: the wall and monotonic clocks advance by the same
 * amount, a scheduled callback fires when and only when the timers are
 * advanced, and the model agrees with the tool on every behaviour in the
 * contract. If Vitest's fake timers ever gain a way to skew the wall clock
 * against the monotonic one, that test fails and this comment is wrong.
 *
 * ---------------------------------------------------------------------------
 * Why `ambient` is allowed to sleep
 * ---------------------------------------------------------------------------
 * `CLAUDE.md` says this repository is deterministic by construction: injected
 * clocks, seeded RNG, no sleeps. The ambient world breaks all three on
 * purpose, because the cost of *not* controlling time is one of the two things
 * being measured, and it cannot be measured by a probe that has already been
 * fixed. The sleeps are confined to this file and to the worlds built on
 * `ambientEnvironment`; `registry.ts` records them as the deliberate exception
 * they are, so the repository-wide audit still fails on an accidental one.
 */

import {
  ambientEnvironment,
  createDeterministicEnvironment,
  createManualClock,
  createManualScheduler,
  DEFAULT_SEED,
  EPOCH,
  type Environment,
} from './environment.ts'
import { createRng } from '../fuzz/random.ts'
import type { Capability } from './contract.ts'

export const PROBE_IDS = [
  'ambient',
  'constant-random',
  'seeded-random',
  'fake-timers',
  'standard',
  'injected',
] as const

export type ProbeId = (typeof PROBE_IDS)[number]

/**
 * How long a real-clock world waits past a deadline before calling a callback
 * missing.
 *
 * Deliberately far more than a timer needs. A `setTimeout` in a loaded CI
 * runner can be tens of milliseconds late, and a grace period tuned to a quiet
 * laptop turns "the machine was busy" into "the refresh never fired" — the
 * exact false alarm that teaches a team to re-run the job rather than read it.
 * The cost is that a real-clock world is slow; that cost is the measurement.
 *
 * Note what this asymmetry does to what a real-clock test may assert. Late is
 * indistinguishable from busy, so an upper bound on when a callback runs is
 * never safe. A lower bound is: nothing makes a timer fire *early*. Every
 * timing assertion in `probes.ts` is therefore one-sided.
 */
export const REAL_GRACE_MS = 200

/** Tolerance on the earliness assertion, for timer-resolution rounding. */
export const EARLY_TOLERANCE_MS = 2

/** One world, instantiated for one behaviour check. */
export interface Instance {
  readonly env: Environment
  /**
   * Lets exactly `ms` of time pass, however this world does that.
   *
   * Exactly, with no grace built in: a probe waiting for a callback adds
   * {@link Instance.grace} itself, so the two are visible separately. A world
   * that hides its slack inside `advance` makes a slow test look like a
   * careful one.
   */
  readonly advance: (ms: number) => Promise<void>
  /**
   * Slack a probe must add before concluding a callback never ran.
   *
   * Zero for every world with a hand-driven queue, because a callback that has
   * not run after the queue is drained is never going to. Non-zero only where
   * the runtime owns the timer.
   */
  readonly grace: number
  /** Puts the wall clock exactly at `instant`; `null` when impossible. */
  readonly setInstant: ((instant: number) => void) | null
  /** Moves the wall clock without moving the monotonic one; `null` when impossible. */
  readonly skew: ((ms: number) => void) | null
}

export interface World {
  readonly id: ProbeId
  /** What somebody would actually type to get this world. */
  readonly technique: string
  readonly capabilities: readonly Capability[]
  readonly why: string
  /** True when the world waits for real time, and is therefore slow. */
  readonly realTime: boolean
  /**
   * A fresh instance.
   *
   * `draws` is honoured only by worlds holding `chosen-draws`; the others
   * ignore it, which is the point — a seed cannot be asked for a particular
   * value.
   */
  readonly create: (draws?: readonly number[]) => Instance
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * A world built on the real globals, with `random` optionally replaced.
 *
 * The replacement stands in for `vi.spyOn(Math, 'random')`, which is what a
 * test would really write; substituting the member rather than the global
 * keeps worlds independent so they can run concurrently, and changes nothing
 * about what the subject sees.
 */
function realTimeWorld(
  id: ProbeId,
  technique: string,
  capabilities: readonly Capability[],
  why: string,
  makeRandom: (() => () => number) | null,
): World {
  return {
    id,
    technique,
    capabilities,
    why,
    realTime: true,
    create: () => ({
      env: makeRandom === null ? ambientEnvironment : { ...ambientEnvironment, random: makeRandom() },
      advance: sleep,
      grace: REAL_GRACE_MS,
      setInstant: null,
      skew: null,
    }),
  }
}

/**
 * A world whose two clocks move together and whose queue is drained by hand.
 *
 * This is the shape of `vi.useFakeTimers()`. `skew` is `null` not because it
 * was inconvenient to write but because the tool has no equivalent: one tick
 * moves `Date.now()` and `performance.now()` by the same amount, always.
 */
function fakeTimerWorld(
  id: ProbeId,
  technique: string,
  capabilities: readonly Capability[],
  why: string,
  makeRandom: (() => () => number) | null,
): World {
  return {
    id,
    technique,
    capabilities,
    why,
    realTime: false,
    create: () => {
      const clock = createManualClock(EPOCH)
      const scheduler = createManualScheduler(clock)

      return {
        env: {
          now: clock.now,
          elapsed: clock.elapsed,
          random: makeRandom === null ? ambientEnvironment.random : makeRandom(),
          uuid: ambientEnvironment.uuid,
          schedule: scheduler.schedule,
        },
        advance: async (ms) => {
          scheduler.tick(ms)
        },
        grace: 0,
        setInstant: (instant) => {
          scheduler.tick(Math.max(0, instant - clock.now()))
        },
        skew: null,
      }
    },
  }
}

export const WORLDS: readonly World[] = [
  realTimeWorld(
    'ambient',
    'nothing — the test runs against the process it happens to be in',
    ['many-draws'],
    'The control group. Every source is whatever the runtime provides, so the ' +
      'test can only observe what happens to pass in front of it: real draws in ' +
      'real order, and real milliseconds it has to wait for. Two of the four ' +
      'capabilities are impossible here by definition rather than by omission.',
    null,
  ),
  realTimeWorld(
    'constant-random',
    "vi.spyOn(Math, 'random').mockReturnValue(0.5)",
    ['median-draw'],
    'The single most common line written about randomness in a test suite, and ' +
      'the only cheap way to reach the midpoint draw — a seeded stream will ' +
      'essentially never produce exactly 0.5. It buys that one draw by giving ' +
      'up every claim about the band, which is a trade nobody makes on purpose.',
    () => () => 0.5,
  ),
  realTimeWorld(
    'seeded-random',
    'Math.random replaced by a seeded mulberry32 stream',
    ['many-draws'],
    'Repeatable draws, in a repeatable order, from a written-down seed. Note ' +
      'what this does and does not buy: the suite now fails the same way twice, ' +
      'which is the whole of what "deterministic" usually means, and it still ' +
      'cannot ask for any particular value.',
    () => createRng(DEFAULT_SEED).next,
  ),
  fakeTimerWorld(
    'fake-timers',
    'vi.useFakeTimers({ now: EPOCH })',
    ['exact-instant', 'many-draws'],
    'Time stops being something the test waits for and becomes something it ' +
      'moves. Boundaries become reachable and the suite stops taking real ' +
      'seconds. Randomness is untouched, so the draws are still whatever the ' +
      'process produced.',
    null,
  ),
  fakeTimerWorld(
    'standard',
    'vi.useFakeTimers() + a seeded Math.random',
    ['exact-instant', 'many-draws'],
    'The advice as it is usually given, fully applied: fake the timers, seed ' +
      'the generator. Everything is now repeatable. `README.md` is mostly about ' +
      'what this still cannot see.',
    () => createRng(DEFAULT_SEED).next,
  ),
  {
    id: 'injected',
    technique: 'every source passed in: manual clock, manual scheduler, chosen draws, counted ids',
    capabilities: ['exact-instant', 'separable-clocks', 'chosen-draws', 'median-draw', 'many-draws'],
    why:
      'The refactor the advice usually skips. It costs a parameter on six ' +
      'functions and it is the only world in which the wall clock can move ' +
      'while the monotonic clock stands still, and the only one that can be ' +
      'asked for a specific draw rather than a repeatable one.',
    realTime: false,
    create: (draws) => {
      // `exactOptionalPropertyTypes` in this repository's tsconfig treats
      // `{ draws: undefined }` as different from an omitted `draws`, so the
      // absent case is passed as an empty object rather than as an explicit
      // undefined.
      const env = createDeterministicEnvironment(draws === undefined ? {} : { draws })

      return {
        env,
        advance: async (ms) => {
          env.scheduler.tick(ms)
        },
        grace: 0,
        setInstant: (instant) => {
          env.scheduler.tick(Math.max(0, instant - env.clock.now()))
        },
        skew: env.clock.skew,
      }
    },
  },
]

export const worldNamed = (id: ProbeId): World => {
  const found = WORLDS.find((world) => world.id === id)

  if (found === undefined) {
    throw new Error(`no world named ${id}`)
  }

  return found
}
