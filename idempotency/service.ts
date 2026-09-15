/**
 * Eight ways to make `POST /v1/charges` survive being delivered twice.
 *
 * ---------------------------------------------------------------------------
 * Why the handlers are written out rather than parameterised
 * ---------------------------------------------------------------------------
 * A single handler with an options object would be a third of the length, and
 * it would hide the only thing being compared. Every difference that decides a
 * cell in the matrix is a difference in the *order of two store operations* and
 * in *which transaction each one is in* — whether the key is written before or
 * after the effect, whether it shares the effect's transaction, whether the
 * external call happens before or after the commit. Those are exactly the
 * details an options object flattens into a boolean, so they are spelled out.
 *
 * Read them as eight implementations of the same endpoint by eight teams who
 * each thought they had solved this. Seven of them are things people ship.
 *
 * ---------------------------------------------------------------------------
 * The subject
 * ---------------------------------------------------------------------------
 * `POST /v1/charges` does two things that cannot both be rolled back:
 *
 *   1. It inserts a row into `charges`. This is transactional.
 *   2. It calls a payment gateway. This is not: it is somebody else's process,
 *      and once it has answered, the money has moved whatever this transaction
 *      does next.
 *
 * Almost every treatment of idempotency keys omits the second, and omitting it
 * is what makes the topic look solved. The hazard `crash-after-gateway` exists
 * for it, and only two of the eight strategies score on that row — both of
 * them because they pass a deduplication key *downstream*, which is the actual
 * fix and is not what either of them is usually credited for.
 */

import type { Clock, IdentitySource } from './clock.ts'
import { Store, UniqueViolation, type Row, type Transaction } from './store.ts'

/** What a client sends. `key` is the `Idempotency-Key` header, when there is one. */
export interface ChargeRequest {
  readonly principal: string
  readonly key: string | null
  readonly orderId: string
  readonly amount: number
}

/** What the client gets back. */
export interface ChargeResponse {
  readonly status: number
  readonly body: Readonly<Record<string, string | number | boolean | null>>
  /** Whether this answer was served from a record rather than from work. */
  readonly replayed: boolean
}

/** The payment gateway: somebody else's process, reachable and irreversible. */
export interface Gateway {
  /**
   * Move the money.
   *
   * `dedupKey` is the gateway's own idempotency key. A real one (Stripe's,
   * Adyen's) accepts one and will not charge twice for it; passing `null` is
   * the default not because it is sensible but because it is what a service
   * that has thought about its own idempotency and not about its dependency's
   * ends up doing.
   */
  charge(input: {
    readonly principal: string
    readonly amount: number
    readonly dedupKey: string | null
  }): Promise<{ readonly ok: boolean; readonly reference: string }>
}

export interface Context {
  readonly store: Store
  readonly clock: Clock
  readonly ids: IdentitySource
  readonly gateway: Gateway
  /** Names this delivery in the store log and to the hazard's hook. */
  readonly delivery: string
}

/**
 * How long a lease is honoured before another delivery may take it over.
 *
 * Ten seconds is short for a payment and that is the point: the number has to
 * be longer than the work and shorter than the client's retry, and a strategy
 * whose correctness depends on getting that window right is a strategy with a
 * tuning parameter. `lease` has no recovery at all and is what happens when a
 * team does not notice the parameter exists.
 */
export const LEASE_TTL_MS = 10_000

/** How long a completed key is replayable. Stripe's is 24 hours; this is a minute. */
export const KEY_TTL_MS = 60_000

/**
 * A request fingerprint.
 *
 * A real implementation hashes the canonicalised body; this joins the two
 * fields that exist, because a hash here would be a deterministic function of
 * the same two fields with an extra step nobody can read in a failure message.
 * What matters for the matrix is that it is *derived from the payload*, so a
 * retry that changed the payload has a different one.
 */
export const fingerprint = (request: ChargeRequest): string => `${request.orderId}:${request.amount}`

/**
 * The scope a key is unique within.
 *
 * `idempotency_keys` is unique on `(scope, key)` rather than on `key` alone,
 * which makes "whose key is this?" a decision each strategy has to make rather
 * than one the schema makes for it. Seven of the eight scope keys to the
 * principal. `memo-after` uses {@link GLOBAL_SCOPE}, and that is not a
 * contrivance to give the matrix a loser: `WHERE idempotency_key = ?` with no
 * tenant predicate is what the naive implementation looks like, it is invisible
 * to every test written about retries, and `cross-principal-key` is the row
 * where it hands one customer another customer's charge.
 */
export const GLOBAL_SCOPE = '*'

const ok = (chargeId: string, amount: number, replayed = false): ChargeResponse => ({
  status: replayed ? 200 : 201,
  body: { chargeId, amount, status: 'charged' },
  replayed,
})

const error = (status: number, code: string, detail: string): ChargeResponse => ({
  status,
  body: { error: code, detail },
  replayed: false,
})

/** Rebuild the response a key row recorded. */
function replayOf(row: Row): ChargeResponse {
  return {
    status: Number(row['status'] ?? 200),
    body: JSON.parse(String(row['body'] ?? '{}')) as ChargeResponse['body'],
    replayed: true,
  }
}

/** Validation every strategy runs first, so `retry-after-400` means the same thing to all eight. */
function invalid(request: ChargeRequest): ChargeResponse | null {
  if (request.amount <= 0) return error(400, 'invalid_amount', 'amount must be greater than zero')

  return null
}

/**
 * The charge row and the gateway call, in the order everybody writes them.
 *
 * Shared because it is the part that is *not* the comparison: six of the eight
 * strategies do exactly this, inside whatever transaction and after whatever
 * bookkeeping they have decided on. `dedupKey` is what they disagree about.
 */
async function applyCharge(
  context: Context,
  request: ChargeRequest,
  requestKey: string | null,
  transaction: Transaction,
  dedupKey: string | null,
): Promise<ChargeResponse> {
  const chargeId = context.ids.next('ch')

  await transaction.insert('charges', {
    id: chargeId,
    principal: request.principal,
    order_id: request.orderId,
    amount: request.amount,
    request_key: requestKey,
  })

  const result = await context.gateway.charge({
    principal: request.principal,
    amount: request.amount,
    dedupKey,
  })

  if (!result.ok) {
    // The gateway refused, so there is no charge to record — and the rollback
    // belongs here rather than in each caller, because forgetting it is a
    // *different* bug from the ones this directory compares and would show up
    // as a phantom charge in every column at once.
    await transaction.rollback()

    return error(502, 'gateway_declined', 'the payment gateway refused the charge')
  }

  await transaction.commit()

  return ok(chargeId, request.amount)
}

export type Handler = (context: Context, request: ChargeRequest) => Promise<ChargeResponse>

// ---------------------------------------------------------------------------
// 1. none
// ---------------------------------------------------------------------------
/**
 * No idempotency of any kind. The control.
 *
 * Present for the reason `openapi/matrix.ts` keeps its own control row: a table
 * of safety outcomes with no unsafe column is a table in which the reader
 * cannot tell a strategy from a coincidence of the harness.
 */
const none: Handler = async (context, request) => {
  const rejection = invalid(request)

  if (rejection !== null) return rejection

  const transaction = context.store.begin({ delivery: context.delivery })

  return applyCharge(context, request, null, transaction, null)
}

// ---------------------------------------------------------------------------
// 2. retry-backoff
// ---------------------------------------------------------------------------
/**
 * Exponential backoff with jitter on the client, and nothing on the server.
 *
 * The handler is `none`. That is not laziness in the model — it is the claim
 * being tested, and the matrix is where it is settled. "Make your retries safe"
 * is advice that overwhelmingly arrives as a retry *policy*: budgets, backoff,
 * jitter, a circuit breaker. All of that is about load, and this column is what
 * it is worth against correctness. The client half lives in
 * `strategies.ts#clientRetry`, so the backoff genuinely runs — the deliveries
 * really are spaced by a growing, seeded delay on an injected clock.
 */
const retryBackoff: Handler = none

// ---------------------------------------------------------------------------
// 3. natural-key
// ---------------------------------------------------------------------------
/**
 * A unique constraint on something the payload already contains.
 *
 * No header, no key table, no expiry, no bookkeeping: the order id is the
 * identity of the operation, the database already enforces uniqueness, and the
 * duplicate is caught by catching the violation. It is the least fashionable
 * design here and it beats most of the others, which is the finding this column
 * exists to make available.
 *
 * Its blindness is exactly as wide as the key: everything not in `request_key`
 * is invisible to it, which `different-body-same-key` is what tests.
 */
const naturalKey: Handler = async (context, request) => {
  const rejection = invalid(request)

  if (rejection !== null) return rejection

  const transaction = context.store.begin({ delivery: context.delivery })

  try {
    return await applyCharge(context, request, request.orderId, transaction, null)
  } catch (cause) {
    if (!(cause instanceof UniqueViolation)) throw cause

    await transaction.rollback()

    // The insert collided, so a committed charge for this order exists. Read it
    // in a fresh transaction and answer with it — the duplicate is not an error
    // to the client, it is the same operation arriving twice.
    const reader = context.store.begin({ delivery: context.delivery })
    const existing = await reader.selectOne('charges', { request_key: request.orderId })

    await reader.rollback()

    if (existing === null) return error(500, 'lost_charge', 'the constraint fired but no row was found')

    return ok(String(existing['id']), Number(existing['amount']), true)
  }
}

// ---------------------------------------------------------------------------
// 4. memo-after
// ---------------------------------------------------------------------------
/**
 * Check for a recorded response; do the work; record the response.
 *
 * This is the implementation the phrase "idempotency key" usually produces, and
 * it is correct under every test anybody writes for it, because the test
 * delivers the second request after the first has returned. Its window is
 * between the effect's commit and the key's, and two hazards open it:
 * `concurrent-retry` from the outside and `crash-after-effect` from the inside.
 * They are the same bug and the matrix shows them as the same pair of cells.
 */
const memoAfter: Handler = async (context, request) => {
  const rejection = invalid(request)

  if (rejection !== null) return rejection
  if (request.key === null) return none(context, request)

  const reader = context.store.begin({ delivery: context.delivery })
  const recorded = await reader.selectOne('idempotency_keys', {
    scope: GLOBAL_SCOPE,
    key: request.key,
  })

  await reader.rollback()

  if (recorded !== null) return replayOf(recorded)

  const work = context.store.begin({ delivery: context.delivery })
  const response = await applyCharge(context, request, null, work, null)

  const memo = context.store.begin({ delivery: context.delivery })

  await memo.insert('idempotency_keys', {
    scope: GLOBAL_SCOPE,
    principal: request.principal,
    key: request.key,
    fingerprint: null,
    state: 'done',
    status: response.status,
    body: JSON.stringify(response.body),
    created_at: context.clock.now(),
  })
  await memo.commit()

  return response
}

// ---------------------------------------------------------------------------
// 5. memo-before
// ---------------------------------------------------------------------------
/**
 * Claim the key first, in its own transaction, then do the work.
 *
 * The fix people reach for once they have seen `memo-after` lose the race — and
 * it does close that race. What it does instead is convert every duplicate into
 * a *lost write*: the key is committed before the effect, so a delivery that
 * dies in between has told the world the operation is finished and left it
 * undone, permanently and silently. The client's retry is answered 200.
 *
 * A duplicate charge gets noticed within a day by the customer. This does not
 * get noticed at all, which is why it scores worse than the bug it fixes.
 */
const memoBefore: Handler = async (context, request) => {
  const rejection = invalid(request)

  if (rejection !== null) return rejection
  if (request.key === null) return none(context, request)

  const claim = context.store.begin({ delivery: context.delivery })

  try {
    await claim.insert('idempotency_keys', {
      scope: request.principal,
      principal: request.principal,
      key: request.key,
      fingerprint: null,
      state: 'done',
      status: 201,
      body: JSON.stringify({ chargeId: null, amount: request.amount, status: 'charged' }),
      created_at: context.clock.now(),
    })
    await claim.commit()
  } catch (cause) {
    if (!(cause instanceof UniqueViolation)) throw cause

    await claim.rollback()

    const reader = context.store.begin({ delivery: context.delivery })
    const recorded = await reader.selectOne('idempotency_keys', {
      scope: request.principal,
      key: request.key,
    })

    await reader.rollback()

    return recorded === null
      ? error(500, 'lost_key', 'the constraint fired but no key was found')
      : replayOf(recorded)
  }

  const work = context.store.begin({ delivery: context.delivery })
  const response = await applyCharge(context, request, null, work, null)

  const update = context.store.begin({ delivery: context.delivery })

  await update.update(
    'idempotency_keys',
    { scope: request.principal, key: request.key },
    { status: response.status, body: JSON.stringify(response.body) },
  )
  await update.commit()

  return response
}

// ---------------------------------------------------------------------------
// 6. lease
// ---------------------------------------------------------------------------
/**
 * Commit an `in-progress` lease, do the work, mark the key done.
 *
 * The design every "how Stripe does idempotency" article describes, and the
 * first one here that is genuinely safe under concurrency: the lease is
 * committed before the work starts, so a second delivery finds it and is told
 * 409 rather than charging again.
 *
 * Its own failure is the thing those articles mention in a sentence and this
 * matrix prices: a lease with no recovery is a lock with no owner. A delivery
 * that dies holding one leaves the operation *permanently* un-performable —
 * every retry for the rest of time gets 409, and the charge never happens.
 * `lease-recovering` is the same design with the sentence implemented.
 */
const lease: Handler = async (context, request) => {
  const rejection = invalid(request)

  if (rejection !== null) return rejection
  if (request.key === null) return none(context, request)

  const claim = context.store.begin({ delivery: context.delivery })

  try {
    await claim.insert('idempotency_keys', {
      scope: request.principal,
      principal: request.principal,
      key: request.key,
      fingerprint: null,
      state: 'in-progress',
      status: null,
      body: null,
      created_at: context.clock.now(),
    })
    await claim.commit()
  } catch (cause) {
    if (!(cause instanceof UniqueViolation)) throw cause

    await claim.rollback()

    const reader = context.store.begin({ delivery: context.delivery })
    const held = await reader.selectOne('idempotency_keys', {
      scope: request.principal,
      key: request.key,
    })

    await reader.rollback()

    if (held === null) return error(500, 'lost_key', 'the constraint fired but no key was found')
    if (held['state'] === 'done') return replayOf(held)

    return error(409, 'in_progress', 'another request with this idempotency key is still running')
  }

  const work = context.store.begin({ delivery: context.delivery })
  const response = await applyCharge(context, request, null, work, null)

  const finish = context.store.begin({ delivery: context.delivery })

  await finish.update(
    'idempotency_keys',
    { scope: request.principal, key: request.key },
    { state: 'done', status: response.status, body: JSON.stringify(response.body) },
  )
  await finish.commit()

  return response
}

// ---------------------------------------------------------------------------
// 7. lease-recovering
// ---------------------------------------------------------------------------
/**
 * `lease`, plus the three things that turn it from a demo into an implementation.
 *
 *   - **Recovery.** An `in-progress` lease older than {@link LEASE_TTL_MS} is
 *     taken over rather than honoured, so a delivery that died holding one
 *     stops blocking the operation forever.
 *   - **A fingerprint.** The payload that claimed the key is recorded, and a
 *     later delivery whose payload differs is rejected 422 instead of being
 *     handed somebody else's answer.
 *   - **A downstream key.** The idempotency key is passed to the gateway, which
 *     is the only mechanism in this file that can make the *external* effect
 *     happen once. Everything else here protects one database.
 *
 * The third is the one worth arguing about, because it is not usually presented
 * as part of this pattern at all, and it is what `crash-after-gateway` scores.
 */
const leaseRecovering: Handler = async (context, request) => {
  const rejection = invalid(request)

  if (rejection !== null) return rejection
  if (request.key === null) return none(context, request)

  const mark = fingerprint(request)
  const claim = context.store.begin({ delivery: context.delivery })

  try {
    await claim.insert('idempotency_keys', {
      scope: request.principal,
      principal: request.principal,
      key: request.key,
      fingerprint: mark,
      state: 'in-progress',
      status: null,
      body: null,
      created_at: context.clock.now(),
    })
    await claim.commit()
  } catch (cause) {
    if (!(cause instanceof UniqueViolation)) throw cause

    await claim.rollback()

    const reader = context.store.begin({ delivery: context.delivery })
    const held = await reader.selectOne('idempotency_keys', {
      scope: request.principal,
      key: request.key,
    })

    await reader.rollback()

    if (held === null) return error(500, 'lost_key', 'the constraint fired but no key was found')

    // Before anything else: is this even the same request? A key reused with a
    // different payload is a client bug, and replaying the first answer would
    // hide it behind a 200 that describes an operation this caller never asked
    // for.
    if (held['fingerprint'] !== mark) {
      return error(422, 'key_reused', 'this idempotency key was used with a different request body')
    }

    const age = context.clock.now() - Number(held['created_at'] ?? 0)

    if (held['state'] === 'done') {
      if (age > KEY_TTL_MS) {
        // The record has expired, so there is nothing to replay. Taking the key
        // over means doing the work again, which is correct only because the
        // gateway key below is what actually prevents the second charge.
        return takeOver(context, request, mark, held)
      }

      return replayOf(held)
    }

    if (age > LEASE_TTL_MS) return takeOver(context, request, mark, held)

    return error(409, 'in_progress', 'another request with this idempotency key is still running')
  }

  return complete(context, request)
}

/** Seize a stale lease and run the work under it. */
async function takeOver(
  context: Context,
  request: ChargeRequest,
  mark: string,
  held: Row,
): Promise<ChargeResponse> {
  const seize = context.store.begin({ delivery: context.delivery })

  await seize.update(
    'idempotency_keys',
    { scope: request.principal, key: request.key },
    { state: 'in-progress', fingerprint: mark, created_at: context.clock.now(), status: null, body: null },
  )
  await seize.commit()

  void held

  return complete(context, request)
}

/** The work half of `lease-recovering`, shared by the first claim and a takeover. */
async function complete(context: Context, request: ChargeRequest): Promise<ChargeResponse> {
  const work = context.store.begin({ delivery: context.delivery })
  const response = await applyCharge(
    context,
    request,
    null,
    work,
    // The whole difference on the `crash-after-gateway` row.
    `${request.principal}:${request.key ?? ''}`,
  )

  const finish = context.store.begin({ delivery: context.delivery })

  await finish.update(
    'idempotency_keys',
    { scope: request.principal, key: request.key },
    { state: 'done', status: response.status, body: JSON.stringify(response.body) },
  )
  await finish.commit()

  return response
}

// ---------------------------------------------------------------------------
// 8. atomic-outbox
// ---------------------------------------------------------------------------
/**
 * Key, effect and the intent to call the gateway, in one transaction.
 *
 * The transactional outbox: nothing leaves this process until the database has
 * agreed the operation happened, and what leaves is driven by a row that was
 * committed alongside the effect. The window every other strategy has between
 * "the effect is durable" and "the record of it is durable" does not exist here
 * because there is only one commit.
 *
 * What it does *not* buy is exactly-once delivery downstream, and the matrix is
 * where that shows: the consumer can crash between the call and marking the row
 * sent, so the gateway can see the request twice. It is at-least-once, and it
 * is only once because the outbox row's id goes with it as the gateway's own
 * deduplication key. An outbox without that is a well-committed way to charge
 * somebody twice.
 */
const atomicOutbox: Handler = async (context, request) => {
  const rejection = invalid(request)

  if (rejection !== null) return rejection

  const key = request.key ?? request.orderId
  const transaction = context.store.begin({ delivery: context.delivery })
  const chargeId = context.ids.next('ch')

  try {
    await transaction.insert('idempotency_keys', {
      scope: request.principal,
      principal: request.principal,
      key,
      fingerprint: fingerprint(request),
      state: 'done',
      status: 201,
      body: JSON.stringify({ chargeId, amount: request.amount, status: 'charged' }),
      created_at: context.clock.now(),
    })
    await transaction.insert('charges', {
      id: chargeId,
      principal: request.principal,
      order_id: request.orderId,
      amount: request.amount,
      request_key: null,
    })
    await transaction.insert('outbox', {
      id: context.ids.next('ob'),
      dedup_key: `${request.principal}:${key}`,
      principal: request.principal,
      amount: request.amount,
      state: 'pending',
    })
    await transaction.commit()
  } catch (cause) {
    if (!(cause instanceof UniqueViolation)) throw cause

    await transaction.rollback()

    const reader = context.store.begin({ delivery: context.delivery })
    const recorded = await reader.selectOne('idempotency_keys', { scope: request.principal, key })

    await reader.rollback()

    if (recorded === null) return error(500, 'lost_key', 'the constraint fired but no key was found')
    if (recorded['fingerprint'] !== fingerprint(request)) {
      return error(422, 'key_reused', 'this idempotency key was used with a different request body')
    }

    return replayOf(recorded)
  }

  await drainOutbox(context)

  return ok(chargeId, request.amount)
}

/**
 * The outbox consumer, run inline.
 *
 * Inline because a separate process would add a scheduler to a directory whose
 * whole claim is that it has none, and because *when* it runs changes nothing
 * the matrix measures: the guarantee is that it runs after the commit and that
 * a crash before it leaves a pending row somebody will pick up. Both hold here.
 * `drainPending` is what a retry calls to prove the second half.
 */
export async function drainOutbox(context: Context): Promise<void> {
  const reader = context.store.begin({ delivery: context.delivery })
  const pending = await reader.select('outbox', { state: 'pending' })

  await reader.rollback()

  for (const row of pending) {
    const result = await context.gateway.charge({
      principal: String(row['principal']),
      amount: Number(row['amount']),
      dedupKey: String(row['dedup_key']),
    })

    const mark = context.store.begin({ delivery: context.delivery })

    // `failed` rather than `sent`, and it does not become `pending` again
    // either. A decline is not a transient error to retry past — the gateway
    // has answered, and answered no. What it exposes is the outbox's real
    // limitation: the charge row was committed and the client was told 201
    // before anybody asked the gateway anything, so there is no longer a
    // request to refuse, only a compensating action somebody has to write.
    await mark.update('outbox', { id: row['id'] }, { state: result.ok ? 'sent' : 'failed' })
    await mark.commit()
  }
}

export const HANDLERS = {
  none,
  'retry-backoff': retryBackoff,
  'natural-key': naturalKey,
  'memo-after': memoAfter,
  'memo-before': memoBefore,
  lease,
  'lease-recovering': leaseRecovering,
  'atomic-outbox': atomicOutbox,
} as const satisfies Record<string, Handler>

export type StrategyKey = keyof typeof HANDLERS
