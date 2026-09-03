/**
 * The subject: an access-token issuer with a jittered background refresh.
 *
 * Chosen because it is the smallest realistic thing that touches every source
 * of nondeterminism at once, and because each source decides something the
 * others cannot see:
 *
 *   - the **wall clock** stamps an expiry, so a client can be told when to
 *     stop trusting the token;
 *   - the **monotonic clock** measures how long an operation took, which is a
 *     different question and — as `ELAPSED_FROM_WALL_CLOCK` in `faults.ts`
 *     shows — a different clock;
 *   - **randomness** jitters the refresh, so ten thousand clients holding
 *     tokens issued in the same second do not all come back in the same
 *     millisecond;
 *   - the **scheduler** runs that refresh later;
 *   - **identity** names the session.
 *
 * Everything is read through the {@link Environment} passed in, never off a
 * global. That is not the usual shape and it is not being recommended as such:
 * `probes.ts` drives four of its six strategies through
 * `ambientEnvironment`, whose members are one-line calls to the real globals,
 * precisely so the measurements apply to code that never had a seam.
 *
 * ---------------------------------------------------------------------------
 * Why the numbers are milliseconds and tiny
 * ---------------------------------------------------------------------------
 * A real TTL is fifteen minutes. This one is 64 milliseconds because the whole
 * point of the ambient probe is that it waits for real time to pass, and a
 * suite that waits fifteen real minutes is a suite nobody runs. The constants
 * are scaled, not faked: the relationships between them — the refresh sits at
 * half the lifetime, the jitter span is wider than the base so that clamping
 * has something to do — are the ones a real configuration has, and every
 * result in `README.md` is a property of these values, which is why they are
 * exported and quoted rather than inlined.
 */

import type { Cancel, Environment } from './environment.ts'

/** How long a session stays valid, in milliseconds. */
export const TTL_MS = 64

/** Where in the lifetime the refresh is aimed, before jitter. */
export const REFRESH_FRACTION = 0.5

/**
 * Total width of the jitter window, in milliseconds.
 *
 * Deliberately wider than the base delay of `TTL_MS * REFRESH_FRACTION`. A
 * span narrower than the base can never produce a delay outside the valid
 * range, which would make the clamp below dead code and two of the faults in
 * `faults.ts` unobservable by construction — the corpus would then be
 * measuring the constants rather than the probes. Real jitter configurations
 * are usually stated as a fraction of the base and are usually narrower; the
 * cost of that, and it is the ordinary case, is that the tail faults simply
 * never happen and nobody learns whether their suite would have caught them.
 */
export const JITTER_SPAN_MS = 80

/**
 * The refresh is never scheduled sooner than this.
 *
 * Eight milliseconds rather than one, and the reason is a measurement artefact
 * worth stating rather than hiding. `SCHEDULE_DELAY_IN_SECONDS` divides the
 * delay by a thousand, and a probe can only see that by asserting the refresh
 * did not fire early — which it cannot do when the correct delay is itself
 * about a millisecond. With a floor of 1 the fault survived roughly one run in
 * seven purely because the draw happened to be extreme, so the matrix would
 * have been reporting the draw rather than the probe. A floor comfortably
 * above timer resolution is also what a real configuration has, for the same
 * underlying reason: a delay a scheduler cannot honour is not a delay.
 */
export const MIN_REFRESH_DELAY_MS = 8

/** …nor later than this, which keeps it strictly inside the lifetime. */
export const MAX_REFRESH_DELAY_MS = TTL_MS - 1

/** An issued session. */
export interface Session {
  readonly id: string
  readonly userId: string
  /** Wall-clock instant the session was issued. */
  readonly issuedAt: number
  /** Wall-clock instant from which the session is no longer valid. */
  readonly expiresAt: number
}

/** A scheduled refresh, and the delay it was actually scheduled for. */
export interface ScheduledRefresh {
  /** The delay handed to the scheduler, in milliseconds. */
  readonly delayMs: number
  readonly cancel: Cancel
}

/** The result of {@link timed}. */
export interface Timed<T> {
  readonly value: T
  readonly durationMs: number
}

export function issue(env: Environment, userId: string): Session {
  const issuedAt = env.now()

  return {
    id: env.uuid(),
    userId,
    issuedAt,
    expiresAt: issuedAt + TTL_MS,
  }
}

/**
 * Whether the session is past its expiry.
 *
 * `>=` and not `>`: `expiresAt` is the first instant at which the session is
 * *not* valid, which is the convention every half-open interval in this
 * repository uses (`property/availability.ts` argues it at length). The
 * difference is one millisecond a year and it is the whole of
 * `EXPIRY_BOUNDARY_EXCLUSIVE`.
 */
export function isExpired(env: Environment, session: Session): boolean {
  return env.now() >= session.expiresAt
}

/**
 * How long to wait before refreshing, for one draw.
 *
 * The draw is taken here rather than passed in because that is where it is
 * taken in the code this is a model of. A caller that could pass the draw in
 * would already have solved the problem the directory is about.
 */
export function refreshDelayMs(env: Environment): number {
  const base = TTL_MS * REFRESH_FRACTION
  const jitter = (env.random() - 0.5) * JITTER_SPAN_MS

  return clampDelay(base + jitter)
}

function clampDelay(delayMs: number): number {
  if (delayMs < MIN_REFRESH_DELAY_MS) {
    return MIN_REFRESH_DELAY_MS
  }

  return delayMs > MAX_REFRESH_DELAY_MS ? MAX_REFRESH_DELAY_MS : delayMs
}

/** Schedules `onRefresh` for one jittered delay inside the session's life. */
export function scheduleRefresh(
  env: Environment,
  session: Session,
  onRefresh: (session: Session) => void,
): ScheduledRefresh {
  const delayMs = refreshDelayMs(env)

  const cancel = env.schedule(() => {
    onRefresh(session)
  }, delayMs)

  return { delayMs, cancel }
}

/** A fresh session for the same user, starting a full lifetime from now. */
export function renew(env: Environment, session: Session): Session {
  return issue(env, session.userId)
}

/**
 * Runs `fn` and reports how long it took, by the monotonic clock.
 *
 * The two readings are deliberately written out as named constants rather
 * than inlined into the subtraction. That is not style: `faults.ts` needs to
 * change each of them independently and an edit has to match exactly once.
 */
export function timed<T>(env: Environment, fn: () => T): Timed<T> {
  const startedAt = env.elapsed()
  const value = fn()
  const finishedAt = env.elapsed()

  return { value, durationMs: finishedAt - startedAt }
}
