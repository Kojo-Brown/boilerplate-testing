/**
 * The harness: deliver one logical request more than once, on purpose, and
 * report what the world looks like afterwards.
 *
 * ---------------------------------------------------------------------------
 * What a retry-safety test has to do that an ordinary test does not
 * ---------------------------------------------------------------------------
 * The usual shape of an idempotency test is: call the handler twice, assert the
 * second response equals the first, assert there is one row. It passes against
 * `memo-after`, which is broken, and it passes against `memo-before`, which is
 * worse. Three things are missing from it, and this harness exists to supply
 * them:
 *
 *   1. **Overlap.** The second delivery has to be able to arrive while the
 *      first is still running, parked at a chosen point rather than at a lucky
 *      one. A retry that waits politely for the first to finish cannot
 *      reproduce the bug the pattern exists to prevent.
 *
 *   2. **Death.** The first delivery has to be able to stop existing — not
 *      throw, stop — after its effect and before its bookkeeping. Every
 *      interesting idempotency bug is a window between two commits, and a
 *      process that always reaches the second commit cannot show you one.
 *
 *   3. **Counting the effect, not the response.** Two identical 200s prove
 *      nothing; the question is how many charges exist and how much money
 *      moved. Those are separate counts here because they fail separately.
 *
 * ---------------------------------------------------------------------------
 * Using it on your own handler
 * ---------------------------------------------------------------------------
 * `runHazard` takes a {@link Subject} — a handler plus, if the design needs
 * one, the background reconciliation it depends on — and one {@link Hazard}.
 * Nothing in it is specific to the eight strategies in `service.ts`; those are
 * how the harness itself is validated, on the principle that a detector with no
 * corpus of things to detect is an assertion. Point it at your own handler,
 * declare what a correct implementation should leave behind, and read the
 * outcome.
 *
 * ---------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------
 * There is no timer anywhere in this file, and the eighty-eight cell matrix is
 * byte-identical between runs. Overlap is produced by parking a delivery on a
 * promise and releasing it when the other has either finished or blocked on a
 * lock, which is observable rather than probable; time is an injected counter;
 * ids are a per-run sequence. `concurrency/README.md` is the directory that
 * argues the opposite case — that some races are only reachable by scheduling
 * many trials — and the difference is that there the interleaving *is* the
 * subject, whereas here it is a fixture and a detection rate would only mean
 * the fixture was unreliable.
 */

import { turn } from '../concurrency/runtime.ts'

import { createClock, createIdentitySource, type Clock } from './clock.ts'
import { createGateway, type RecordingGateway } from './gateway.ts'
import { drainOutbox, type ChargeRequest, type ChargeResponse, type Context, type Handler } from './service.ts'
import { CrashedTransaction, Store, type OperationEvent } from './store.ts'

/**
 * Thrown to end a delivery the way a power cut does.
 *
 * It escapes the handler because no handler catches it: the strategies in
 * `service.ts` only ever catch `UniqueViolation` by `instanceof`, which is how
 * a real handler is written and the reason a `catch (error) { return 500 }`
 * around everything is a bug rather than a style.
 */
export class ProcessCrash extends Error {
  readonly at: string

  constructor(at: string) {
    super(`the delivery was killed at ${at}`)
    this.name = 'ProcessCrash'
    this.at = at
  }
}

/** Points at which a delivery can be killed or parked. */
export type Point =
  /** Once the transaction that wrote `charges` is committed. */
  | 'after-effect'
  /** Once this delivery's first transaction of any kind is committed. */
  | 'after-claim'
  /** Once the gateway has answered. */
  | 'after-gateway'

export interface DeliverySpec {
  readonly label: string
  readonly request: ChargeRequest
  /** Kill this delivery at this point. */
  readonly crashAt?: Point
  /** Hold this delivery here until the next one has finished or blocked. */
  readonly parkAt?: Point
  /** Move the clock on by this much before sending it. */
  readonly delayBefore?: number
}

/** A handler under test, plus whatever background work its design assumes. */
export interface Subject {
  readonly handle: Handler
  /**
   * The background process the design depends on, run once after every
   * delivery has settled.
   *
   * Only the outbox strategy declares one, and declaring it is the honest move
   * rather than a convenience: a transactional outbox is not a handler, it is a
   * handler *and* a consumer, and a harness that quietly ran the consumer for
   * free would be scoring a system nobody deployed. A design with no such
   * dependency leaves this undefined and the harness does nothing.
   */
  readonly reconcile?: (context: Context) => Promise<void>
}

/** What one delivery ended up as. */
export interface DeliveryOutcome {
  readonly label: string
  /** The response, or null when the delivery died before answering. */
  readonly response: ChargeResponse | null
  readonly crashed: boolean
  /** The clock reading when the request was sent. */
  readonly sentAt: number
}

export interface Observation {
  readonly deliveries: readonly DeliveryOutcome[]
  /** Committed rows in `charges`. */
  readonly charges: number
  /** Gateway calls that moved money — declines are attempts, not effects. */
  readonly gatewayEffects: number
  /** Every request that reached the gateway, deduplicated or not. */
  readonly gatewayRequests: number
  /** Charges whose principal is not the one that asked for them. */
  readonly misattributed: number
  readonly store: Store
  readonly gateway: RecordingGateway
}

export interface HazardOptions {
  /** Outcomes for successive gateway effects; missing entries succeed. */
  readonly gatewayOutcomes?: readonly boolean[]
  readonly clock?: Clock
}

/**
 * How long the harness will wait for a parked delivery's partner to get
 * somewhere before releasing it anyway.
 *
 * A bound on *turns of the event loop*, not on wall-clock time, for the reason
 * `concurrency/runtime.ts` gives its own step budget: a scheduled run has no
 * clock in it, and a partner that has neither finished nor blocked after this
 * many turns is looping rather than slow.
 */
const TURN_BUDGET = 200

interface Killer {
  readonly hook: (event: OperationEvent) => Promise<void>
  readonly gatewayHook: (event: { phase: 'before' | 'after'; dedupKey: string | null }) => Promise<void>
}

/**
 * Translate crash and park points into store and gateway hooks.
 *
 * The translation is the part worth reading, because a crash point stated in
 * terms a strategy can recognise would not be one hazard across eight columns.
 * `after-effect` fires on the commit whose transaction wrote `charges`,
 * whichever transaction that is — the second for `memo-after`, the only one for
 * `atomic-outbox` — so the row asks all eight the same question even though
 * none of them has the same shape.
 */
function buildHooks(
  specs: readonly DeliverySpec[],
  release: Map<string, () => void>,
  parked: Set<string>,
): Killer {
  const committed = new Set<string>()

  const reached = (spec: DeliverySpec, point: Point, event: OperationEvent): boolean => {
    if (event.phase !== 'after') return false

    switch (point) {
      case 'after-effect':
        return event.operation === 'commit' && event.tables.includes('charges')
      case 'after-claim':
        return event.operation === 'commit' && !committed.has(spec.label)
      case 'after-gateway':
        return false
    }
  }

  const hook = async (event: OperationEvent): Promise<void> => {
    const spec = specs.find((candidate) => candidate.label === event.delivery)

    if (spec === undefined) return

    const isFirstCommit = event.operation === 'commit' && event.phase === 'after' && !committed.has(spec.label)

    if (spec.parkAt !== undefined && reached(spec, spec.parkAt, event) && !parked.has(spec.label)) {
      parked.add(spec.label)
      if (isFirstCommit) committed.add(spec.label)

      await new Promise<void>((resume) => release.set(spec.label, resume))

      return
    }

    if (spec.crashAt !== undefined && reached(spec, spec.crashAt, event)) {
      if (isFirstCommit) committed.add(spec.label)

      throw new ProcessCrash(`${spec.label}/${spec.crashAt}`)
    }

    if (isFirstCommit) committed.add(spec.label)
  }

  // The gateway has no idea which delivery is calling it — a real one does not
  // either — so `after-gateway` fires for the first delivery that declared it
  // and then never again. Every hazard that uses the point has exactly one such
  // delivery, and `hazards.test.ts` is what keeps that true.
  const crashedAtGateway = new Set<string>()

  const gatewayHook = async (event: {
    phase: 'before' | 'after'
    dedupKey: string | null
  }): Promise<void> => {
    if (event.phase !== 'after') return

    for (const spec of specs) {
      if (spec.crashAt === 'after-gateway' && !crashedAtGateway.has(spec.label)) {
        crashedAtGateway.add(spec.label)
        throw new ProcessCrash(`${spec.label}/after-gateway`)
      }
    }
  }

  return { hook, gatewayHook }
}

/**
 * One delivery, from request to response or to death.
 *
 * `CrashedTransaction` is folded into `ProcessCrash` here rather than left to
 * escape: it means the handler kept going after its process died, which can
 * only happen because a store call was already in flight, and reporting it as
 * two different failures would make one bug look like two.
 */
async function deliver(
  subject: Subject,
  context: Context,
  spec: DeliverySpec,
  clock: Clock,
): Promise<DeliveryOutcome> {
  const sentAt = clock.now()

  try {
    const response = await subject.handle(context, spec.request)

    return { label: spec.label, response, crashed: false, sentAt }
  } catch (cause) {
    if (cause instanceof ProcessCrash || cause instanceof CrashedTransaction) {
      // The process is gone, so its database connection is gone with it. See
      // `Store#killDelivery`: without this the locks it was holding outlive it
      // and the retry waits on a transaction that will never settle.
      context.store.killDelivery(spec.label)

      return { label: spec.label, response: null, crashed: true, sentAt }
    }

    // Anything else becomes a 500, because that is what happens to it in a real
    // service: an unhandled error reaches the framework's error middleware and
    // the client gets a 500, it does not take the process down. This is not a
    // detail of the model — `memo-after` under `concurrent-retry` reaches it,
    // because the second delivery's memo insert collides with the first's on a
    // key it had already decided was absent, and a plain `INSERT` with no
    // `ON CONFLICT` raises. Letting that escape would fail the suite with a
    // stack trace instead of scoring the cell, and the cell is the finding: two
    // charges happened before the error, so the customer is out twice the money
    // and the log says the request failed.
    return {
      label: spec.label,
      response: {
        status: 500,
        body: { error: 'unhandled', detail: cause instanceof Error ? cause.message : String(cause) },
        replayed: false,
      },
      crashed: false,
      sentAt,
    }
  }
}

/**
 * Run a hazard's deliveries against a subject and report what happened.
 *
 * A spec with `parkAt` runs concurrently with the one after it; everything else
 * runs in order, each awaited before the next is sent. That is two scheduling
 * modes rather than one general one, and deliberately: a general scheduler over
 * eight strategies with different numbers of transactions would produce a
 * different interleaving per column, and the row would stop being a hazard and
 * start being eight of them.
 */
export async function runDeliveries(
  subject: Subject,
  specs: readonly DeliverySpec[],
  options: HazardOptions = {},
): Promise<Observation> {
  const store = new Store()
  const clock = options.clock ?? createClock()
  const ids = createIdentitySource()
  const release = new Map<string, () => void>()
  const parked = new Set<string>()
  const { hook, gatewayHook } = buildHooks(specs, release, parked)
  const gateway = createGateway(store, {
    // Spread rather than assigned: `exactOptionalPropertyTypes` is on, so an
    // absent option and an option set to `undefined` are different types here.
    ...(options.gatewayOutcomes !== undefined && { outcomes: options.gatewayOutcomes }),
    hook: gatewayHook,
  })

  store.setHook(hook)

  const contextFor = (label: string): Context => ({ store, clock, ids, gateway, delivery: label })
  const outcomes: DeliveryOutcome[] = []

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]

    if (spec === undefined) continue
    if (spec.delayBefore !== undefined) clock.advance(spec.delayBefore)

    const next = specs[index + 1]

    if (spec.parkAt === undefined || next === undefined) {
      outcomes.push(await deliver(subject, contextFor(spec.label), spec, clock))
      continue
    }

    // The overlap. `first` will stop at its park point; `second` then runs
    // until it finishes or blocks on a lock `first` is holding, and only then
    // is `first` allowed to continue.
    const first = deliver(subject, contextFor(spec.label), spec, clock)
    let firstSettled = false

    void first.then(() => {
      firstSettled = true
    })

    if (next.delayBefore !== undefined) clock.advance(next.delayBefore)

    const second = deliver(subject, contextFor(next.label), next, clock)
    let secondSettled = false

    void second.then(() => {
      secondSettled = true
    })

    for (let step = 0; step < TURN_BUDGET; step += 1) {
      if (secondSettled || store.isWaiting(next.label)) break
      // A parked `first` cannot be what we are waiting for, and a `first` that
      // never reaches its park point would otherwise spin out the budget.
      if (firstSettled && !parked.has(spec.label)) break

      await turn()
    }

    // Release in a loop rather than once, because the partner can settle before
    // the parked delivery has reached its park point at all — `atomic-outbox`
    // commits everything in one transaction, so its retry is refused and
    // finished while the first delivery is still several operations short of
    // the commit it would park on. A single release call would then find
    // nothing registered and the first delivery would park forever, which is
    // exactly the hang this loop replaced.
    for (let step = 0; step < TURN_BUDGET && !firstSettled; step += 1) {
      const resume = release.get(spec.label)

      if (resume !== undefined) {
        release.delete(spec.label)
        resume()
      }

      await turn()
    }

    outcomes.push(await first, await second)
    index += 1
  }

  if (subject.reconcile !== undefined) await subject.reconcile(contextFor('reconcile'))

  const charges = store.committed('charges')
  const requested = new Map(specs.map((spec) => [spec.request.orderId, spec.request.principal]))

  return {
    deliveries: outcomes,
    charges: charges.length,
    // Money moved, which is not the same as calls made: a decline is an attempt
    // the customer never sees on a statement, and a request the gateway
    // deduplicated never reached the ledger at all.
    gatewayEffects: store.committed('gateway_calls').filter((row) => row['ok'] === true).length,
    gatewayRequests: gateway.requests.length,
    misattributed: charges.filter((row) => {
      const asked = requested.get(String(row['order_id']))

      return asked !== undefined && asked !== row['principal']
    }).length,
    store,
    gateway,
  }
}

/** The outbox consumer, as a {@link Subject} reconciliation step. */
export const reconcileOutbox = (context: Context): Promise<void> => drainOutbox(context)

export type { ChargeRequest, ChargeResponse }
