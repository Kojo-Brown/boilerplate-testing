/**
 * The eight columns: a handler, a client retry policy, and a sentence.
 *
 * The client half is here rather than in `service.ts` because one of the eight
 * is *entirely* a client-side policy. "Make your retries safe" arrives, far
 * more often than not, as advice about the caller — bounded retries,
 * exponential backoff, jitter, a circuit breaker — and a comparison that only
 * modelled server-side designs would leave that advice untested and looking
 * reasonable. `retry-backoff` runs a real backoff: the deliveries genuinely are
 * spaced by a growing, seeded delay on the injected clock, `strategies.test.ts`
 * asserts the spacing actually grew, and the column still comes out identical
 * to `none` on every row.
 *
 * That identity is the point. Backoff decides *when* the duplicate arrives. It
 * has no opinion about whether it is a duplicate.
 */

import { HANDLERS, type Handler, type StrategyKey } from './service.ts'
import { reconcileOutbox, type Subject } from './harness.ts'

export type RetryPolicy = 'immediate' | 'backoff'

export interface Strategy {
  readonly key: StrategyKey
  /** One line, as the README states it. Audited against the prose. */
  readonly blurb: string
  readonly handler: Handler
  readonly retry: RetryPolicy
  /** The background process this design depends on, if it has one. */
  readonly reconcile?: Subject['reconcile']
}

/** First backoff delay, doubling per attempt. */
export const BACKOFF_BASE_MS = 100

/**
 * Jitter, drawn from a seeded generator rather than `Math.random`.
 *
 * A linear congruential generator and not a dependency: it needs to be
 * deterministic and to look nothing like a uniform sequence, and those are the
 * only two properties this uses. `determinism/registry.ts` is the gate that
 * would otherwise have something to say here — an unseeded draw in a fixture is
 * exactly the ambient nondeterminism it exists to catch, and the fix is a seed
 * rather than a row explaining the draw.
 */
export function seededJitter(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0

    return state / 0x1_0000_0000
  }
}

/**
 * The delay before the nth retry under a policy.
 *
 * `immediate` is zero, which is what a proxy retry or a double-clicked button
 * actually does. `backoff` is `base * 2^(n-1)` plus up to a full interval of
 * jitter — "full jitter", the variant AWS's own retry guidance recommends.
 *
 * Both stay far below `LEASE_TTL_MS` (10s) and `KEY_TTL_MS` (60s) on purpose.
 * If a backoff delay could cross either threshold, the `key-expired` and
 * `crash-*` rows would be measuring the fixture's timing rather than the
 * design, and `retry-backoff` would differ from `none` for a reason that had
 * nothing to do with safety.
 */
export function retryDelay(policy: RetryPolicy, attempt: number, jitter: () => number): number {
  if (policy === 'immediate') return 0

  const interval = BACKOFF_BASE_MS * 2 ** (attempt - 1)

  return Math.floor(interval + jitter() * interval)
}

export const STRATEGIES: readonly Strategy[] = [
  {
    key: 'none',
    blurb: 'No idempotency of any kind. The control.',
    handler: HANDLERS.none,
    retry: 'immediate',
  },
  {
    key: 'retry-backoff',
    blurb: 'Exponential backoff with full jitter on the client, and nothing on the server.',
    handler: HANDLERS['retry-backoff'],
    retry: 'backoff',
  },
  {
    key: 'natural-key',
    blurb: 'A unique constraint on the order id already in the payload; catch the violation.',
    handler: HANDLERS['natural-key'],
    retry: 'immediate',
  },
  {
    key: 'memo-after',
    blurb: 'Look the key up, do the work, then record the response against it.',
    handler: HANDLERS['memo-after'],
    retry: 'immediate',
  },
  {
    key: 'memo-before',
    blurb: 'Commit the key first, in its own transaction, then do the work.',
    handler: HANDLERS['memo-before'],
    retry: 'immediate',
  },
  {
    key: 'lease',
    blurb: 'Commit an in-progress lease, do the work, mark the key done. No recovery.',
    handler: HANDLERS.lease,
    retry: 'immediate',
  },
  {
    key: 'lease-recovering',
    blurb: 'A lease that expires, a stored request fingerprint, and the key passed downstream.',
    handler: HANDLERS['lease-recovering'],
    retry: 'immediate',
  },
  {
    key: 'atomic-outbox',
    blurb: 'Key, charge and outbox row in one transaction; a consumer calls the gateway after.',
    handler: HANDLERS['atomic-outbox'],
    retry: 'immediate',
    reconcile: reconcileOutbox,
  },
]

export const strategyNamed = (key: string): Strategy => {
  const strategy = STRATEGIES.find((candidate) => candidate.key === key)

  if (strategy === undefined) throw new Error(`No strategy named ${key}`)

  return strategy
}

/** A strategy as the harness wants it. */
export const subjectFor = (strategy: Strategy): Subject => ({
  handle: strategy.handler,
  ...(strategy.reconcile !== undefined && { reconcile: strategy.reconcile }),
})
