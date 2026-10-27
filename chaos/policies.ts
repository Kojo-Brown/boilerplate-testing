/**
 * The six resilience wirings, and the one thing each of them claims to do.
 *
 * ---------------------------------------------------------------------------
 * Why these six
 * ---------------------------------------------------------------------------
 * They are the recipes a service actually ships, in the order a codebase
 * acquires them: no policy at all, then a timeout, then a better timeout, then
 * a retry, then a better retry, then a breaker. Every step but the first
 * differs from the row above it in exactly one decision, which is what makes
 * the matrix readable — a cell that moves between two adjacent rows has only
 * one thing it can be about.
 *
 * The first step is the exception and it is unavoidable: `bare` means *no*
 * policy, so `bare` → `race-timeout` adds both a timeout and a status check.
 * Splitting it into two rows would mean publishing a wiring nobody writes — a
 * status check with no timeout — to preserve a property of the table's layout.
 * The two decisions are separable in the readings anyway: the status check is
 * the only thing that moves the `error-500` cell, and the timeout is the only
 * thing that moves the three columns made of waiting.
 *
 * Two of the six are wrong, and neither is wrong in a way that shows up in
 * code review:
 *
 *   - `race-timeout` is the `Promise.race([fetch(url), timeout])` that appears
 *     in every "add a timeout to fetch" answer written before `AbortSignal`
 *     existed. The race resolves when the *headers* arrive; the body is read
 *     afterwards, outside the race, with nothing watching it.
 *   - `retry-5xx` keys its retry decision on `res.status`, which is the only
 *     signal a failing dependency sometimes does not send.
 *
 * ---------------------------------------------------------------------------
 * What a "call" is here
 * ---------------------------------------------------------------------------
 * A *series* of three calls rather than one, and that is not padding either. A
 * circuit breaker's entire job is to stop calling a dependency that is down,
 * which is a property of the second and third call and invisible in the first.
 * Measure one call and the breaker row is identical to `retry-any`, which is
 * the mistake the README's third finding is about.
 *
 * ---------------------------------------------------------------------------
 * Deliberately absent: backoff
 * ---------------------------------------------------------------------------
 * The retry wirings re-attempt immediately. A real one waits, with jitter, and
 * leaving that out is a decision rather than an omission: nothing measured here
 * depends on the gap between attempts, every published cell is an outcome or a
 * request count, and a backoff would add two ambient reads — a timer and a
 * draw — to a directory whose timings are already the thing under suspicion.
 * `k6/load-test.ts` is where this repository argues for jitter.
 */

import { BUDGET_MS } from './timings.ts'

/** The shape of `fetch` this directory needs, and no more of it. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

export const POLICY_IDS = [
  'bare',
  'race-timeout',
  'signal-timeout',
  'retry-5xx',
  'retry-any',
  'breaker',
] as const

export type PolicyId = (typeof POLICY_IDS)[number]

export interface Policy {
  readonly id: PolicyId
  /** The wiring, in the words its own code would use. */
  readonly wiring: string
  /** What it is sold as covering. */
  readonly claims: string
}

export const POLICIES: readonly Policy[] = [
  {
    id: 'bare',
    wiring: '`await (await fetch(url)).json()`',
    claims: 'nothing — the baseline every other row is measured against',
  },
  {
    id: 'race-timeout',
    wiring: '`Promise.race([fetch(url), rejectAfter(budget)])`, then a status check, then `res.json()`',
    claims: 'a call that takes longer than the budget fails instead of waiting, and a non-2xx is an error rather than a body',
  },
  {
    id: 'signal-timeout',
    wiring: '`fetch(url, { signal: AbortSignal.timeout(budget) })`, then a status check, then `res.json()`',
    claims: 'the same two things, with the timeout around the whole call rather than around the request',
  },
  {
    id: 'retry-5xx',
    wiring: 'as `signal-timeout`, re-attempted up to three times while `res.status >= 500`',
    claims: 'a dependency that is failing transiently is retried',
  },
  {
    id: 'retry-any',
    wiring: 'as `signal-timeout`, re-attempted up to three times on any thrown error or non-2xx',
    claims: 'as above, for transport failures as well as reported ones',
  },
  {
    id: 'breaker',
    wiring: 'as `retry-any`, behind a breaker that opens after two consecutive failed attempts and then fails without calling',
    claims: 'a dependency that is down is not called again',
  },
]

const BY_ID = new Map(POLICIES.map((policy) => [policy.id, policy]))

export function policy(id: PolicyId): Policy {
  const found = BY_ID.get(id)

  if (found === undefined) throw new Error(`unknown policy: ${id}`)

  return found
}

/** Attempts a retrying wiring makes before giving up. */
export const MAX_ATTEMPTS = 3

/** Consecutive failed attempts after which the breaker opens. */
export const BREAKER_THRESHOLD = 2

/** Calls in a series, which is what one cell of the matrix is measured over. */
export const SERIES_LENGTH = 3

/** Thrown when a wiring declines to call because its breaker is open. */
export class BreakerOpenError extends Error {
  constructor() {
    super('circuit breaker is open')
    this.name = 'BreakerOpenError'
  }
}

/** Thrown when a wiring rejects a response on its status. */
export class HttpStatusError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`dependency answered ${String(status)}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

/**
 * The one timer a policy owns: `race-timeout`'s losing horse.
 *
 * Returned with its canceller because an uncancelled rejection outlives the
 * race and surfaces as an unhandled rejection in whichever test happens to be
 * running when it fires — which is a flake in a directory about flakes.
 */
function rejectAfter(ms: number): { readonly promise: Promise<never>; readonly cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined

  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DOMException('The operation timed out.', 'TimeoutError'))
    }, ms)
  })

  return { promise, cancel: () => clearTimeout(timer) }
}

/** One attempt of the wiring every row but `bare` and `race-timeout` is built on. */
async function guardedAttempt(url: string, call: FetchLike): Promise<unknown> {
  const response = await call(url, { signal: AbortSignal.timeout(BUDGET_MS) })

  if (!response.ok) {
    throw new HttpStatusError(response.status)
  }

  return await response.json()
}

/** A wiring, as the runs invoke it: a URL and the transport to use. */
export type Wiring = (url: string, call: FetchLike) => Promise<unknown>

async function bare(url: string, call: FetchLike): Promise<unknown> {
  const response = await call(url)

  return await response.json()
}

async function raceTimeout(url: string, call: FetchLike): Promise<unknown> {
  const budget = rejectAfter(BUDGET_MS)

  try {
    // The bug, written the way it is written in the wild: the race is around
    // the request, and `json()` — which is where the body is actually read —
    // happens after it, unwatched.
    const response = await Promise.race([call(url), budget.promise])

    if (!response.ok) {
      throw new HttpStatusError(response.status)
    }

    return await response.json()
  } finally {
    budget.cancel()
  }
}

const signalTimeout: Wiring = guardedAttempt

/** `retry-5xx` and `retry-any` differ only in this predicate. */
const retrying =
  (shouldRetry: (error: unknown) => boolean): Wiring =>
  async (url, call) => {
    let last: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await guardedAttempt(url, call)
      } catch (error) {
        last = error

        if (!shouldRetry(error)) throw error
      }
    }

    throw last
  }

const isServerStatus = (error: unknown): boolean => error instanceof HttpStatusError && error.status >= 500

const retry5xx = retrying(isServerStatus)

const retryAny = retrying(() => true)

/**
 * The breaker.
 *
 * State lives in the closure, so `breakerWiring()` returns a *fresh* breaker
 * per series — a breaker shared between two cells of the matrix would carry
 * one fault's failures into the next fault's measurement, which is the kind of
 * leak `dbisolation/` exists to measure in databases.
 *
 * There is no half-open state and no reset timer. Both would need a clock the
 * series is too short to reach, and neither changes a cell: what the table is
 * about is whether the second and third call reach the dependency at all.
 */
function breakerWiring(): Wiring {
  let consecutiveFailures = 0

  return async (url, call) => {
    let last: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        throw new BreakerOpenError()
      }

      try {
        const body = await guardedAttempt(url, call)

        consecutiveFailures = 0

        return body
      } catch (error) {
        last = error
        consecutiveFailures += 1
      }
    }

    throw last
  }
}

/**
 * A wiring ready to run one series.
 *
 * Five of the six are stateless and could be module constants; `breaker` is
 * not, and giving every row the same factory shape is what stops a future
 * edit from sharing the one piece of state that must not be shared.
 */
export function wiringFor(id: PolicyId): Wiring {
  switch (id) {
    case 'bare':
      return bare
    case 'race-timeout':
      return raceTimeout
    case 'signal-timeout':
      return signalTimeout
    case 'retry-5xx':
      return retry5xx
    case 'retry-any':
      return retryAny
    case 'breaker':
      return breakerWiring()
  }
}
