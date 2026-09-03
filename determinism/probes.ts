/**
 * The thirteen behaviours of `contract.ts`, written as checks.
 *
 * One implementation per behaviour, shared by all six worlds. That is the
 * fairness constraint: a probe's result must be a property of the world it was
 * given and nothing else, so no behaviour is allowed to know which world it is
 * running in. Where a check needs something a world may not have — an exact
 * instant, a chosen draw, a skewed clock — it takes it off {@link Instance}
 * and would crash without it, which is exactly why `contract.ts` derives
 * reach from capabilities: the behaviour is never run in a world that cannot
 * support it.
 *
 * Each check answers a single question — did this claim hold — and reports
 * nothing else. A check that threw is a failed claim, not a crashed harness:
 * a faulted subject is allowed to throw, and treating that as an error rather
 * than a detection would credit the fault with hiding.
 */

import {
  MAX_REFRESH_DELAY_MS,
  MIN_REFRESH_DELAY_MS,
  REFRESH_FRACTION,
  TTL_MS,
} from './session.ts'
import { BEHAVIOUR_IDS, reachableBehaviours, type BehaviourId } from './contract.ts'
import { EARLY_TOLERANCE_MS, type Instance, type World } from './worlds.ts'
import type { Subject } from './load.ts'

/**
 * How many draws a `many-draws` check takes before deciding.
 *
 * Five hundred and twelve rather than a handful, and the number is chosen from
 * `sensitivity.ts` rather than picked. The narrowest fault in the corpus
 * changes the delay on 10.0% of the draw space; at 512 draws the chance of a
 * band check missing it is under one in ten thousand billion, so every cell in
 * the matrix that depends on a tail is decided rather than sampled. At the
 * dozen draws a hand-written suite would use it would be a coin toss, and the
 * matrix would report the seed.
 */
export const BAND_DRAWS = 512

/**
 * The draws a `chosen-draws` world is handed before its seeded stream takes
 * over.
 *
 * Both ends, both clamp thresholds and the midpoint. This is the enumeration
 * that a seed cannot give you: not repeatable values, but the *particular*
 * values at which the code changes its mind.
 */
export const ENUMERATED_DRAWS: readonly number[] = [
  0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5, 0.75, 0.85, 0.8875, 0.95, 0.999_999,
]

/** Sessions issued back to back by the identity check. */
export const ID_SAMPLE_SIZE = 8

/** How far the clock is jumped under the subject's feet by the skew check. */
export const SKEW_MS = 5_000

/** Real time allowed to pass before a renewal, so the two stamps differ. */
export const RENEWAL_GAP_MS = 2

type Check = (subject: Subject, instance: Instance) => Promise<boolean>

const settled = (): Promise<void> => new Promise((resolve) => { queueMicrotask(resolve) })

const CHECKS: Readonly<Record<BehaviourId, Check>> = {
  'lifetime-is-one-ttl': async (subject, instance) => {
    const session = subject.issue(instance.env, 'user-1')

    return session.expiresAt - session.issuedAt === TTL_MS
  },

  'live-when-issued': async (subject, instance) => {
    const session = subject.issue(instance.env, 'user-1')

    return !subject.isExpired(instance.env, session)
  },

  'expired-at-the-expiry-instant': async (subject, instance) => {
    const session = subject.issue(instance.env, 'user-1')

    instance.setInstant?.(session.expiresAt)

    return subject.isExpired(instance.env, session)
  },

  'live-one-millisecond-before-expiry': async (subject, instance) => {
    const session = subject.issue(instance.env, 'user-1')

    instance.setInstant?.(session.expiresAt - 1)

    return !subject.isExpired(instance.env, session)
  },

  'duration-comes-from-the-monotonic-clock': async (subject, instance) => {
    const { durationMs } = subject.timed(instance.env, () => {
      instance.skew?.(SKEW_MS)

      return 'done'
    })

    return durationMs === 0
  },

  'delay-stays-inside-the-clamped-band': async (subject, instance) => {
    for (let draw = 0; draw < BAND_DRAWS; draw += 1) {
      const delay = subject.refreshDelayMs(instance.env)

      if (!(delay >= MIN_REFRESH_DELAY_MS && delay <= MAX_REFRESH_DELAY_MS)) {
        return false
      }
    }

    return true
  },

  'delay-centres-on-half-the-lifetime-at-the-median-draw': async (subject, instance) =>
    subject.refreshDelayMs(instance.env) === TTL_MS * REFRESH_FRACTION,

  'a-low-draw-refreshes-earlier-than-a-high-draw': async (subject, instance) => {
    const low = subject.refreshDelayMs(instance.env)
    const high = subject.refreshDelayMs(instance.env)

    return low < high
  },

  'the-jitter-band-is-reached-at-both-ends': async (subject, instance) => {
    let lowest = Number.POSITIVE_INFINITY
    let highest = Number.NEGATIVE_INFINITY

    for (let draw = 0; draw < BAND_DRAWS; draw += 1) {
      const delay = subject.refreshDelayMs(instance.env)

      lowest = Math.min(lowest, delay)
      highest = Math.max(highest, delay)
    }

    return lowest === MIN_REFRESH_DELAY_MS && highest === MAX_REFRESH_DELAY_MS
  },

  'the-refresh-fires-no-earlier-than-its-delay': async (subject, instance) => {
    const session = subject.issue(instance.env, 'user-1')
    const startedAt = instance.env.elapsed()

    let firedAt: number | null = null

    const { delayMs, cancel } = subject.scheduleRefresh(instance.env, session, () => {
      firedAt = instance.env.elapsed()
    })

    await instance.advance(Math.max(0, delayMs) + instance.grace)
    await settled()
    cancel()

    if (firedAt === null) {
      return false
    }

    return firedAt - startedAt >= delayMs - EARLY_TOLERANCE_MS
  },

  'a-cancelled-refresh-never-fires': async (subject, instance) => {
    const session = subject.issue(instance.env, 'user-1')

    let fired = false

    const { delayMs, cancel } = subject.scheduleRefresh(instance.env, session, () => {
      fired = true
    })

    cancel()

    await instance.advance(Math.max(0, delayMs) + instance.grace)
    await settled()

    return !fired
  },

  'sessions-issued-together-have-different-ids': async (subject, instance) => {
    const ids = new Set<string>()

    for (let index = 0; index < ID_SAMPLE_SIZE; index += 1) {
      ids.add(subject.issue(instance.env, 'user-1').id)
    }

    return ids.size === ID_SAMPLE_SIZE
  },

  'renewal-restarts-the-full-lifetime': async (subject, instance) => {
    const original = subject.issue(instance.env, 'user-1')

    await instance.advance(RENEWAL_GAP_MS)

    const renewed = subject.renew(instance.env, original)

    return renewed.expiresAt - renewed.issuedAt === TTL_MS
  },
}

/** Which behaviours need a world that honours a requested draw sequence. */
const SCRIPTED: Readonly<Partial<Record<BehaviourId, readonly number[]>>> = {
  'delay-centres-on-half-the-lifetime-at-the-median-draw': [0.5],
  'a-low-draw-refreshes-earlier-than-a-high-draw': [0.1, 0.9],
  'delay-stays-inside-the-clamped-band': ENUMERATED_DRAWS,
  'the-jitter-band-is-reached-at-both-ends': ENUMERATED_DRAWS,
}

/** One behaviour's verdict in one world. */
export interface CheckResult {
  readonly behaviour: BehaviourId
  readonly held: boolean
  /** Set when the check threw; the claim is failed either way. */
  readonly threw: string | null
}

/** Every behaviour a world can state, run once against one subject. */
export async function runWorld(world: World, subject: Subject): Promise<readonly CheckResult[]> {
  const reachable = reachableBehaviours(world.capabilities)
  const results: CheckResult[] = []

  for (const behaviour of BEHAVIOUR_IDS) {
    if (!reachable.includes(behaviour)) {
      continue
    }

    const instance = world.create(SCRIPTED[behaviour])

    try {
      results.push({ behaviour, held: await CHECKS[behaviour](subject, instance), threw: null })
    } catch (error) {
      results.push({
        behaviour,
        held: false,
        threw: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return results
}
