/**
 * The measurement: 96 cells, from real calls, on every `pnpm test`.
 *
 * Two layers × six policies × eight faults, where one cell is a *series* of
 * three calls through one wiring against one fault, and what is recorded is
 * what the last call did plus how many requests the whole series made.
 *
 * ---------------------------------------------------------------------------
 * Why the request count is a column
 * ---------------------------------------------------------------------------
 * Because it is the only place two of the six wirings differ. A retry that
 * never enters its retry branch returns exactly what a wiring with no retry
 * returns, and a breaker that never opens returns exactly what the retry
 * underneath it returns. Both are the failure a chaos suite is meant to catch
 * and the one it is least likely to assert on, because the assertion everybody
 * writes is about the value that came back. `intercept/outcomes.ts` names the
 * same blind spot `first-try`.
 *
 * The count is taken twice over, independently, and `runs.test.ts` requires
 * the two to agree: once by the harness, which wraps the transport and counts
 * invocations, and once by the origin, which counts the requests it actually
 * received. A wrapper that miscounted would be invisible on its own, and the
 * origin's ledger is the only witness that is not the thing under test.
 *
 * ---------------------------------------------------------------------------
 * Why the faults fan out
 * ---------------------------------------------------------------------------
 * Walking them takes about four times as long, and nearly all of that time is
 * a `setTimeout` rather than a CPU — the slowest cell in the table is a wiring
 * with no timeout sitting against `black-hole` until the harness's deadline.
 * Fanning out the eight faults keeps the whole measurement to a few seconds
 * while holding the socket count to eight, which matters: the policies inside
 * a fault are walked rather than fanned so that `black-hole`, the one fault
 * that parks a connection and never gives it back, only ever holds one.
 *
 * The `fetch-stub` layer opens no sockets at all, so it is fanned out
 * completely, which matters because its slowest cells are the five wirings
 * whose entire defence is a signal the stub ignores: each of them spends three
 * of the harness's deadlines, and walking them costs more than the whole rest
 * of the measurement put together.
 */

import { FAULT_IDS, type FaultId } from './faults.ts'
import { LAYER_IDS, type LayerId, stubFetch } from './layers.ts'
import {
  band,
  type Cell,
  classify,
  type ErrorShape,
  type Observation,
  type Table,
} from './outcomes.ts'
import { POLICY_IDS, SERIES_LENGTH, type FetchLike, type PolicyId, wiringFor } from './policies.ts'
import { type Origin, pathFor, startOrigin } from './origin.ts'
import { DEADLINE_MS } from './timings.ts'

/** Both tables, plus the origin's independent count of what it was sent. */
export interface Measurement {
  readonly tables: Readonly<Record<LayerId, Table>>
  /** Requests the origin received per fault, summed over every policy's series. */
  readonly originHits: Readonly<Record<FaultId, number>>
}

/**
 * The two monotonic reads in this file, and the only timing in the directory.
 *
 * `performance.now()` rather than `Date.now()` because what is being measured
 * is an interval, and a wall clock that steps — NTP, a suspended laptop — puts
 * a negative number in it.
 */
async function timed<T>(run: () => Promise<T>): Promise<{ readonly value: T; readonly elapsedMs: number }> {
  const started = performance.now()
  const value = await run()

  return { value, elapsedMs: performance.now() - started }
}

/** A thrown value, flattened to what `classify` reads. */
function shapeOf(thrown: unknown): ErrorShape {
  if (!(thrown instanceof Error)) {
    return { name: 'non-error', message: String(thrown), causeCode: null }
  }

  const cause: unknown = thrown.cause
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? (cause as { code: unknown }).code
      : undefined

  return {
    name: thrown.name,
    message: thrown.message,
    causeCode: typeof code === 'string' ? code : null,
  }
}

/** The marker the deadline race resolves with; never leaves this module. */
const EXPIRED = Symbol('deadline')

/**
 * One call, with the harness's deadline around it.
 *
 * The inner `try`/`catch` is load-bearing and is the reason there is no
 * `.catch()` anywhere in here. A wiring that loses this race is *still
 * running*: `bare` against `black-hole` is parked on a socket that answers
 * nothing, and when the origin is torn down its `fetch` finally rejects —
 * several tests later, with nobody awaiting it. Catching inside the callback
 * turns that into a promise which **resolves** with `{ error }`, and an
 * ignored resolved promise is inert. Rejecting and attaching a handler
 * afterwards would work too, and would mean every abandoned call had a window
 * in which it was an unhandled rejection waiting to be reported.
 *
 * The `elapsedMs` of a deadline is the deadline rather than a measured
 * interval, deliberately: the call has not finished, so there is no interval
 * to report. All `band()` needs from it is that it is not less than
 * `DEADLINE_MS`, and recording the nominal value says plainly that the number
 * is the harness's and not the wiring's.
 */
async function observe(run: () => Promise<unknown>): Promise<Observation> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<typeof EXPIRED>((resolve) => {
    timer = setTimeout(() => {
      resolve(EXPIRED)
    }, DEADLINE_MS)
  })

  const settled = timed(async (): Promise<{ readonly body: unknown } | { readonly error: unknown }> => {
    try {
      return { body: await run() }
    } catch (error) {
      return { error }
    }
  })

  const winner = await Promise.race([settled, deadline])

  clearTimeout(timer)

  if (winner === EXPIRED) {
    return { settled: 'deadline', elapsedMs: DEADLINE_MS }
  }

  const { value, elapsedMs } = winner

  return 'error' in value
    ? { settled: 'rejected', error: shapeOf(value.error), elapsedMs }
    : { settled: 'resolved', body: value.body, elapsedMs }
}

/** One cell: a series of calls through a fresh wiring, counted and classified. */
async function runSeries(policy: PolicyId, url: string, transport: FetchLike): Promise<Cell> {
  const wiring = wiringFor(policy)

  let requests = 0

  const counted: FetchLike = (target, init) => {
    requests += 1

    return transport(target, init)
  }

  let last: Observation | undefined

  for (let call = 0; call < SERIES_LENGTH; call += 1) {
    // Every call is stamped with the policy and index it belongs to. Only
    // `transient-500` reads the stamp — it is how the origin and the stub know
    // which requests are the first of a call without either of them knowing
    // what a series is — and the other faults ignore the query entirely.
    const stamped = `${url}?series=${policy}&call=${String(call)}`

    last = await observe(() => wiring(stamped, counted))
  }

  if (last === undefined) throw new Error('a series must contain at least one call')

  return { outcome: classify(last), band: band(last.elapsedMs), requests }
}

/**
 * A healthy call made and thrown away before anything is measured.
 *
 * The first `fetch` in a Node process pays for the global dispatcher being
 * built, which is tens of milliseconds that belong to no fault. Nothing
 * published depends on it — `prompt` has 300ms of clearance — but a warm-up is
 * one line and it removes the only cell whose band could be decided by
 * start-up cost rather than by a policy.
 */
async function warmUp(origin: Origin): Promise<void> {
  const response = await fetch(`${origin.baseUrl}${pathFor('healthy')}`)

  await response.json()
}

const emptyTable = (): Record<PolicyId, Record<FaultId, Cell>> =>
  Object.fromEntries(POLICY_IDS.map((policy) => [policy, {}])) as Record<
    PolicyId,
    Record<FaultId, Cell>
  >

/** The transport and URL one fault is reached through, at one layer. */
function transportFor(
  layer: LayerId,
  fault: FaultId,
  origin: Origin,
): { readonly url: string; readonly transport: FetchLike } {
  if (layer === 'fetch-stub') {
    return { url: `http://fetch-stub.invalid${pathFor(fault)}`, transport: stubFetch(fault) }
  }

  // `connection-refused` is the one fault the origin cannot serve by serving
  // something, so it is pointed at the port that was bound and closed.
  const base = fault === 'connection-refused' ? origin.deadUrl : origin.baseUrl

  return { url: `${base}${pathFor(fault)}`, transport: (target, init) => fetch(target, init) }
}

/**
 * Every cell of one layer.
 *
 * The faults always fan out. The policies inside a fault fan out only at the
 * `fetch-stub` layer, where there is no socket to hold: at the `socket` layer
 * they are walked, so that `black-hole` — the fault that parks a connection
 * and never gives it back — holds one connection rather than six. That is also
 * the difference between a 10-second measurement and a 24-second one, because
 * the slowest cells in the stub table are the five wirings whose only defence
 * is a signal the stub ignores, and each of them spends three deadlines.
 */
async function runLayer(layer: LayerId, origin: Origin): Promise<Table> {
  const table = emptyTable()

  const columns = await Promise.all(
    FAULT_IDS.map(async (fault) => {
      const { url, transport } = transportFor(layer, fault, origin)

      if (layer === 'fetch-stub') {
        const cells = await Promise.all(
          POLICY_IDS.map(async (policy) => [policy, await runSeries(policy, url, transport)] as const),
        )

        return { fault, cells } as const
      }

      const cells: Array<readonly [PolicyId, Cell]> = []

      for (const policy of POLICY_IDS) {
        cells.push([policy, await runSeries(policy, url, transport)])
      }

      return { fault, cells } as const
    }),
  )

  for (const { fault, cells } of columns) {
    for (const [policy, cell] of cells) {
      table[policy][fault] = cell
    }
  }

  return table as Table
}

/**
 * Run everything, once.
 *
 * The layers are walked rather than fanned so that the `socket` layer has the
 * machine to itself: the `fetch-stub` layer is pure timers and would otherwise
 * be competing for the event loop with the measurement that has a real server
 * in it.
 */
export async function measure(): Promise<Measurement> {
  const origin = await startOrigin()

  try {
    await warmUp(origin)

    const tables: Partial<Record<LayerId, Table>> = {}

    for (const layer of LAYER_IDS) {
      tables[layer] = await runLayer(layer, origin)
    }

    // Read after both layers, and the warm-up is subtracted: the ledger counts
    // every request the origin received, and one of them was not a measurement.
    const originHits = Object.fromEntries(
      FAULT_IDS.map((fault) => [fault, origin.hits(fault) - (fault === 'healthy' ? 1 : 0)]),
    ) as Record<FaultId, number>

    return { tables: tables as Record<LayerId, Table>, originHits }
  } finally {
    await origin.close()
  }
}
