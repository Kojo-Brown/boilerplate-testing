/**
 * Where the fault is injected, which turns out to decide what it means.
 *
 * ---------------------------------------------------------------------------
 * The question
 * ---------------------------------------------------------------------------
 * Every fault in `faults.ts` can be produced two ways: by a real origin doing
 * a real thing over a real socket (`origin.ts`), or by replacing `fetch` with
 * a function that returns what the fault is supposed to look like. The second
 * is enormously cheaper — no port, no teardown, no flake surface — and it is
 * what most chaos suites are actually built on.
 *
 * So the second table in `README.md` scores the cheap layer against the real
 * one on all 48 cells, and the finding is not "the stub is approximate". It is
 * that the stub disagrees in **both directions**: it hides the one bug this
 * directory exists to find, and it invents a different one that is not there.
 *
 * ---------------------------------------------------------------------------
 * The stub is written to win
 * ---------------------------------------------------------------------------
 * This comparison is only worth having if the stub gets its best shot, so it
 * does. It does not hand-wave the transport failures: `connection-refused`
 * throws a `TypeError` whose `cause.code` is `ECONNREFUSED` and
 * `reset-mid-body` errors a half-written body stream with `UND_ERR_SOCKET`,
 * which is what undici really does and what a diligent author gets by reading
 * one real error before writing the stub. It streams `slow-body` rather than
 * delaying a string, so the headers genuinely arrive before the body stalls.
 *
 * It has exactly one weakness, and it is not a weakness anybody would notice
 * in review: **it ignores the `AbortSignal` it is passed.** A `Response`
 * constructed by hand has no connection to a signal, and neither does a
 * `ReadableStream` constructed by hand — honouring one means writing the
 * listener, the rejection and the stream teardown yourself, three things
 * `fetch` does and no stub in the wild does. That single omission is the whole
 * second table.
 */

import { HEALTHY_BODY } from './outcomes.ts'
import type { FetchLike } from './policies.ts'
import { INJECTED_MS } from './timings.ts'
import { type FaultId } from './faults.ts'

export const LAYER_IDS = ['socket', 'fetch-stub'] as const

export type LayerId = (typeof LAYER_IDS)[number]

export interface Layer {
  readonly id: LayerId
  /** How the fault is produced. */
  readonly injects: string
  /** What it costs to run, in the terms a CI budget cares about. */
  readonly cost: string
}

export const LAYERS: readonly Layer[] = [
  {
    id: 'socket',
    injects: 'a real `node:http` origin on loopback, writing status lines, chunks and resets itself',
    cost: 'one ephemeral port and a teardown; the ground truth every cell below is compared against',
  },
  {
    id: 'fetch-stub',
    injects: 'a hand-written `fetch` returning `Response` objects, some of them over a `ReadableStream`',
    cost: 'nothing — no port, no teardown, no network at all',
  },
]

const BY_ID = new Map(LAYERS.map((layer) => [layer.id, layer]))

export function layer(id: LayerId): Layer {
  const found = BY_ID.get(id)

  if (found === undefined) throw new Error(`unknown layer: ${id}`)

  return found
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const

/** The first half of a body that never gets a second half. Mirrors `origin.ts`. */
const TRUNCATED_BODY = '{"dependency":"ledger","ok":tru'

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

/**
 * The one scheduler read in this file.
 *
 * Both the stub's latency faults go through it, so there is a single
 * `setTimeout` to register in `determinism/registry.ts` and a single place to
 * read when asking what the stub's delays are doing.
 */
const after = (ms: number, run: () => void): void => {
  setTimeout(run, ms)
}

/** A transport error shaped the way undici shapes it. */
function transportError(message: string, code: string): TypeError {
  const cause = new Error(`${code} (stub)`)

  Object.assign(cause, { code })

  return new TypeError(message, { cause })
}

const healthyResponse = (): Response =>
  new Response(JSON.stringify(HEALTHY_BODY), { status: 200, headers: JSON_HEADERS })

/**
 * A body whose first chunk is already out when the stall starts.
 *
 * `start` enqueues immediately and schedules the rest, which is what makes
 * this a *body* fault rather than a slower version of `slow-headers`: the
 * `Response` is complete and resolvable the moment it is returned.
 */
function stallingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(TRUNCATED_BODY))
      after(INJECTED_MS, () => {
        controller.enqueue(encode('e}'))
        controller.close()
      })
    },
  })
}

/** A body that starts arriving and then dies, as a reset one does. */
function resettingBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(TRUNCATED_BODY))
      after(20, () => {
        controller.error(transportError('terminated', 'UND_ERR_SOCKET'))
      })
    },
  })
}

/**
 * The hand-written `fetch` for one fault.
 *
 * Every branch returns a function of no arguments, and that is the point
 * stated in the type system rather than in a comment: `FetchLike` passes an
 * `init` carrying the `AbortSignal`, and not one of these stubs declares a
 * parameter to receive it. A wiring whose entire defence is that signal has no
 * defence at this layer, and the signatures say so at a glance.
 */
export function stubFetch(fault: FaultId): FetchLike {
  switch (fault) {
    case 'healthy':
      return () => Promise.resolve(healthyResponse())

    case 'slow-headers':
      return () =>
        new Promise<Response>((resolve) => {
          after(INJECTED_MS, () => {
            resolve(healthyResponse())
          })
        })

    case 'slow-body':
      return () =>
        Promise.resolve(new Response(stallingBody(), { status: 200, headers: JSON_HEADERS }))

    case 'error-500':
      return () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'ledger unavailable' }), {
            status: 500,
            headers: JSON_HEADERS,
          }),
        )

    case 'transient-500': {
      // The one stub with state, and the one place a hand-written stub has an
      // easier job than the origin: the key is the URL it was handed, which is
      // the same stamp `runs.ts` puts on the real request.
      const spent = new Set<string>()

      return (url) => {
        if (spent.has(url)) return Promise.resolve(healthyResponse())

        spent.add(url)

        return Promise.resolve(
          new Response(JSON.stringify({ error: 'ledger electing a leader' }), {
            status: 500,
            headers: JSON_HEADERS,
          }),
        )
      }
    }

    case 'malformed-body':
      return () => Promise.resolve(new Response(TRUNCATED_BODY, { status: 200, headers: JSON_HEADERS }))

    case 'connection-refused':
      return () => Promise.reject(transportError('fetch failed', 'ECONNREFUSED'))

    case 'reset-mid-body':
      return () =>
        Promise.resolve(new Response(resettingBody(), { status: 200, headers: JSON_HEADERS }))

    case 'black-hole':
      // A connection that is accepted and never answered has no stub
      // equivalent, because there is no event to imitate — the fault *is* the
      // absence of one. A promise that never settles is the closest thing a
      // stub can be, and that is the honest imitation rather than a cheat:
      // what the real fault does to a caller is nothing, for ever.
      return () => new Promise<Response>(() => {})
  }
}
