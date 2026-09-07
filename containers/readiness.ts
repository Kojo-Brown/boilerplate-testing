/**
 * Measuring the two halves of "the container is up".
 *
 * ---------------------------------------------------------------------------
 * Why there are two halves at all
 * ---------------------------------------------------------------------------
 * `await container.start()` looks like one thing and is two: the runtime
 * created and started a container, and *some wait strategy decided that was
 * enough*. The first is the same work for every image. The second is a claim
 * about a protocol, made by whoever wrote the module, and it is the half that
 * can be wrong.
 *
 * So every figure this directory reports about startup is a pair: `startMs`,
 * which is what `start()` took, and `usableMs`, which is how much longer a
 * real client had to wait afterwards. A module with an honest wait strategy
 * reports a `usableMs` in single-digit milliseconds and one probe attempt —
 * that residue is the probe's own connection setup, not a gap.
 *
 * ---------------------------------------------------------------------------
 * The Kafka gap, and why it is not the broker being slow
 * ---------------------------------------------------------------------------
 * `@testcontainers/kafka@12.1.0` starts the Confluent image with a substitute
 * command — `echo 'Waiting for script...'; while [ ! -f /tmp/testcontainers_start.sh ]; do sleep 0.1; done; …` —
 * so that it can compute `KAFKA_ADVERTISED_LISTENERS` from the port the daemon
 * actually published and copy in a real starter script. To do that it swaps
 * the container's wait strategy for `Wait.forLogMessage('Waiting for script...')`,
 * keeping the original in `originalWaitStrategy`, and after the script is in
 * place it waits again — this time, it intends, for the real one:
 *
 * ```js
 * // beforeContainerCreated()
 * this.originalWaitStrategy = this.waitStrategy            // undefined: nobody set one
 * this.waitStrategy = Wait.forLogMessage(WAIT_FOR_SCRIPT_MESSAGE)
 *
 * // containerStarted()
 * const waitStrategy = await this.selectWaitStrategy(client, inspect, this.originalWaitStrategy)
 * ```
 *
 * `selectWaitStrategy` is declared `(…, waitStrategy = this.waitStrategy)`.
 * Passing an explicit `undefined` to a parameter with a default *triggers the
 * default*, so the second wait is handed the substitute strategy — a log
 * message the container printed seconds ago — and returns immediately. The
 * intended fallback, `Wait.forListeningPorts()`, is never reached.
 *
 * The effect is measurable and it is not subtle: `start()` resolves in a few
 * hundred milliseconds and the first client connection is refused for the next
 * several seconds while the broker actually boots. A suite whose client
 * retries — kafkajs does, five times, with backoff — sees this as slowness. A
 * suite whose client does not sees it as a flaky connection error on a
 * container that had just reported itself started.
 *
 * That is the whole argument for {@link awaitUsable}: the wait strategy is
 * somebody else's claim about readiness, and the client is the only thing that
 * knows.
 */

import type { StoreName } from './images.ts'
import type { Readiness, StartedStore } from './stores.ts'
import { awaitUsable, startStore } from './stores.ts'

/** The label Ryuk reaps by. Absent from a reused container, on purpose. */
export const SESSION_LABEL = 'org.testcontainers.session-id'

export interface Startup {
  readonly store: StoreName
  readonly reused: boolean
  /** Milliseconds `start()` itself took. */
  readonly startMs: number
  /** What the first real client operation cost after that. */
  readonly readiness: Readiness
  /** `startMs + readiness.elapsedMs`, which is the number a suite waits. */
  readonly totalMs: number
  readonly started: StartedStore
}

/**
 * Start one store and measure both halves.
 *
 * The container is returned rather than stopped, because every caller needs it
 * afterwards — to reuse it, to read its labels, or to stop it themselves.
 */
export async function measureStartup(
  store: StoreName,
  options: { readonly reuse: boolean; readonly variant?: string },
): Promise<Startup> {
  const startedAt = performance.now()
  const started = await startStore(store, {
    reuse: options.reuse,
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  })
  const startMs = Math.round(performance.now() - startedAt)
  const readiness = await awaitUsable(started)

  return {
    store,
    reused: options.reuse,
    startMs,
    readiness,
    totalMs: startMs + readiness.elapsedMs,
    started,
  }
}

/** Cold and warm, for one store, with the containers left for the caller to stop. */
export interface ReusePair {
  readonly store: StoreName
  readonly cold: Startup
  readonly warm: Startup
  /** Whether the second start adopted the first container rather than making one. */
  readonly adopted: boolean
}

/**
 * Start a store twice with reuse on, and measure the second start.
 *
 * The first start is cold whatever the flag says — reuse can only adopt a
 * container that is already running — so this measures the two states a
 * developer actually sees: the first `pnpm test:containers` of the morning,
 * and every one after it.
 */
export async function measureReuse(store: StoreName, variant: string): Promise<ReusePair> {
  const cold = await measureStartup(store, { reuse: true, variant })
  const warm = await measureStartup(store, { reuse: true, variant })

  return {
    store,
    cold,
    warm,
    adopted: cold.started.containerId === warm.started.containerId,
  }
}
