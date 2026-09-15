/**
 * Eleven ways one logical request arrives more than once, and what a correct
 * handler should have left behind afterwards.
 *
 * ---------------------------------------------------------------------------
 * Why a hazard declares its own correct answer
 * ---------------------------------------------------------------------------
 * "Exactly one effect" is the wrong yardstick for three of the eleven rows, and
 * a corpus that applied it uniformly would score two correct behaviours as
 * bugs. `cross-principal-key` *should* produce two charges — two customers each
 * asked for one, and a design that deduplicated them would be the catastrophe,
 * not the fix. `retry-after-invalid` should produce none. And
 * `different-body-same-key` should produce one charge and a *refusal*, because
 * replaying the first answer to a caller who asked for something else is a
 * wrong answer delivered with a 200.
 *
 * So each hazard carries the world a correct implementation leaves — how many
 * charges, how much money moved — and the outcome word that describes getting
 * it right. `scoring.ts` compares; nothing in this file decides whether a
 * strategy passed.
 *
 * ---------------------------------------------------------------------------
 * On the two that are not retries
 * ---------------------------------------------------------------------------
 * `clean` is the control, and it is here for the reason every matrix in this
 * repository has one: a column of `safe` means nothing until you know the
 * harness can say something else, and a strategy that refused every request
 * would otherwise score well on ten rows out of eleven.
 *
 * `cross-principal-key` is not a retry at all — it is two different customers
 * who happened to generate the same key, which is what happens within a week of
 * shipping a client that seeds its key from a timestamp or a sequence. It is in
 * the corpus because the bug it finds is invisible to every test written about
 * retries, and because it is the one failure here that leaks one customer's
 * data to another.
 */

import type { DeliverySpec } from './harness.ts'
import type { Outcome } from './scoring.ts'

export interface Hazard {
  readonly key: string
  /** One line, as the README states it. */
  readonly blurb: string
  readonly deliveries: readonly DeliverySpec[]
  /** Gateway outcomes consumed in order; missing entries succeed. */
  readonly gatewayOutcomes?: readonly boolean[]
  /** Charges a correct implementation leaves committed. */
  readonly expectedCharges: number
  /** Money a correct implementation moves, counted in successful gateway effects. */
  readonly expectedGatewayEffects: number
  /** The outcome word a correct implementation earns. */
  readonly correct: Outcome
}

const PRINCIPAL = 'cus_alpha'
const OTHER = 'cus_beta'
const KEY = 'idem_7f3a'

const request = (
  overrides: Partial<{ principal: string; key: string | null; orderId: string; amount: number }> = {},
) => ({
  principal: overrides.principal ?? PRINCIPAL,
  key: overrides.key === undefined ? KEY : overrides.key,
  orderId: overrides.orderId ?? 'ord_001',
  amount: overrides.amount ?? 2500,
})

/**
 * How far the clock moves before a retry that follows a crash.
 *
 * Longer than {@link LEASE_TTL_MS} on purpose: a client that lost its
 * connection does not retry in the same millisecond, and a lease TTL shorter
 * than the client's retry is the only configuration in which recovery can work
 * at all. Making it shorter here would score `lease-recovering` as `lease` and
 * the row would be reporting the fixture's timing rather than the design.
 */
export const RETRY_AFTER_CRASH_MS = 30_000

/** Past {@link KEY_TTL_MS}, so the record a replay would need is gone. */
export const RETRY_AFTER_EXPIRY_MS = 90_000

export const HAZARDS: readonly Hazard[] = [
  {
    key: 'clean',
    blurb: 'One delivery, nothing goes wrong. The control.',
    deliveries: [{ label: 'first', request: request() }],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
  {
    key: 'sequential-retry',
    blurb: 'The client times out after the response was produced and sends it again.',
    deliveries: [
      { label: 'first', request: request() },
      { label: 'retry', request: request() },
    ],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
  {
    key: 'concurrent-retry',
    blurb: 'A proxy retries while the first delivery is still in the window after its effect.',
    deliveries: [
      { label: 'first', request: request(), parkAt: 'after-effect' },
      { label: 'retry', request: request() },
    ],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
  {
    key: 'crash-after-effect',
    blurb: 'The process dies once the charge is durable and before it is recorded as done.',
    deliveries: [
      { label: 'first', request: request(), crashAt: 'after-effect' },
      { label: 'retry', request: request(), delayBefore: RETRY_AFTER_CRASH_MS },
    ],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
  {
    key: 'crash-after-claim',
    blurb: "The process dies just after its first durable write, whatever that write was.",
    deliveries: [
      { label: 'first', request: request(), crashAt: 'after-claim' },
      { label: 'retry', request: request(), delayBefore: RETRY_AFTER_CRASH_MS },
    ],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
  {
    key: 'crash-after-gateway',
    blurb: 'The process dies after the money has moved and before anything about it is committed.',
    deliveries: [
      { label: 'first', request: request(), crashAt: 'after-gateway' },
      { label: 'retry', request: request(), delayBefore: RETRY_AFTER_CRASH_MS },
    ],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
  {
    key: 'different-body-same-key',
    blurb: 'The retry reuses the key and changes the amount. A replay would answer the wrong question.',
    deliveries: [
      { label: 'first', request: request() },
      { label: 'retry', request: request({ amount: 9900 }) },
    ],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'rejected',
  },
  {
    key: 'cross-principal-key',
    blurb: 'A second customer generates the same key value. Both charges are real and neither is a retry.',
    deliveries: [
      { label: 'first', request: request() },
      { label: 'second', request: request({ principal: OTHER, orderId: 'ord_002' }) },
    ],
    expectedCharges: 2,
    expectedGatewayEffects: 2,
    correct: 'safe',
  },
  {
    key: 'retry-after-decline',
    blurb: 'The gateway declines the first attempt. The retry must be allowed to actually succeed.',
    deliveries: [
      { label: 'first', request: request() },
      { label: 'retry', request: request() },
    ],
    gatewayOutcomes: [false],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
  {
    key: 'retry-after-invalid',
    blurb: 'The request is malformed. The retry is identical and must stay refused, with no effect.',
    deliveries: [
      { label: 'first', request: request({ amount: -1 }) },
      { label: 'retry', request: request({ amount: -1 }) },
    ],
    expectedCharges: 0,
    expectedGatewayEffects: 0,
    correct: 'rejected',
  },
  {
    key: 'key-expired',
    blurb: 'The retry arrives after the key record has expired, so there is nothing left to replay.',
    deliveries: [
      { label: 'first', request: request() },
      { label: 'retry', request: request(), delayBefore: RETRY_AFTER_EXPIRY_MS },
    ],
    expectedCharges: 1,
    expectedGatewayEffects: 1,
    correct: 'safe',
  },
]

export const hazardNamed = (key: string): Hazard => {
  const hazard = HAZARDS.find((candidate) => candidate.key === key)

  if (hazard === undefined) throw new Error(`No hazard named ${key}`)

  return hazard
}
