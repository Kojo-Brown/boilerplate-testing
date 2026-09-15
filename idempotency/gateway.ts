/**
 * The payment gateway: the effect that is not yours to roll back.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate participant and not a row
 * ---------------------------------------------------------------------------
 * If the only effect a handler has is a row in its own database, idempotency is
 * a solved problem with a one-line answer — put a unique index on something and
 * catch the violation. Every strategy in `service.ts` would score full marks on
 * a corpus built that way, and the corpus would be measuring the store.
 *
 * What makes this hard in a real service is that the handler also does
 * something *outside* the transaction: it charges a card, sends an email, posts
 * to a queue, calls a partner. Those cannot be rolled back, they do not
 * participate in the commit, and a crash between the call and the commit leaves
 * the world changed and the database saying otherwise.
 *
 * So the gateway is modelled with the one property that decides the hardest row
 * in the matrix: **it deduplicates if, and only if, it is given a key to
 * deduplicate on.** That is true of Stripe, of Adyen, of every payment API
 * worth using — and passing the key downstream is the step that services which
 * have carefully implemented their own idempotency routinely skip, because
 * their own key table looks like the answer.
 *
 * `effects` counts money moved, not requests made. A second request carrying a
 * `dedupKey` the gateway has already honoured is a request, not an effect, and
 * the distinction is the entire content of the `crash-after-gateway` row.
 */

import type { Gateway } from './service.ts'
import type { Store } from './store.ts'

/** Fired around a gateway call, so a hazard can kill a delivery mid-flight. */
export type GatewayHook = (event: {
  readonly phase: 'before' | 'after'
  readonly dedupKey: string | null
}) => Promise<void> | void

export interface GatewayOptions {
  /**
   * Outcomes for successive *effects*, consumed in order; missing entries are
   * successes. `[false]` is how `retry-after-500` makes the first charge fail
   * without making every charge fail.
   */
  readonly outcomes?: readonly boolean[]
  readonly hook?: GatewayHook
}

export interface RecordingGateway extends Gateway {
  /** Every request that reached the gateway, deduplicated or not. */
  readonly requests: readonly (string | null)[]
  /** Money actually moved. What a duplicate charge is counted in. */
  readonly effects: readonly { readonly reference: string; readonly dedupKey: string | null }[]
}

export function createGateway(store: Store, options: GatewayOptions = {}): RecordingGateway {
  const requests: (string | null)[] = []
  const outcomes = [...(options.outcomes ?? [])]
  let issued = 0

  const gateway: RecordingGateway = {
    requests,

    get effects() {
      return store.committed('gateway_calls').map((row) => ({
        reference: String(row['reference']),
        dedupKey: row['dedup_key'] === null ? null : String(row['dedup_key']),
      }))
    },

    async charge(input) {
      await options.hook?.({ phase: 'before', dedupKey: input.dedupKey })
      requests.push(input.dedupKey)

      if (input.dedupKey !== null) {
        const seen = store
          .committed('gateway_calls')
          .find((row) => row['dedup_key'] === input.dedupKey)

        if (seen !== undefined) {
          // The gateway remembers. The money does not move a second time, and
          // the caller gets the same answer it got the first time — which is
          // what "idempotent downstream" actually means and why it is the only
          // thing that survives a crash in the wrong place.
          await options.hook?.({ phase: 'after', dedupKey: input.dedupKey })

          return { ok: Boolean(seen['ok']), reference: String(seen['reference']) }
        }
      }

      const ok = outcomes[issued] ?? true
      const reference = `gw_${String(issued + 1)}`

      issued += 1

      // Appended outside any transaction, because that is the point: the money
      // has moved and no `ROLLBACK` in this process will bring it back.
      store.append('gateway_calls', {
        reference,
        dedup_key: input.dedupKey,
        principal: input.principal,
        amount: input.amount,
        ok,
      })

      await options.hook?.({ phase: 'after', dedupKey: input.dedupKey })

      return { ok, reference }
    },
  }

  return gateway
}
