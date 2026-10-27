/**
 * The dependency, and the eight ways it misbehaves.
 *
 * ---------------------------------------------------------------------------
 * Why a real server
 * ---------------------------------------------------------------------------
 * Every fault in `faults.ts` could be "injected" in four lines by replacing
 * the client's `fetch` with a function that returns what the fault is supposed
 * to look like. `layers.ts` does exactly that, on purpose, and the second
 * table in `README.md` is the measurement of how far that gets you. The short
 * version is that it gets latency and transport faults wrong in both
 * directions, so the ground truth has to come from somewhere a response is
 * genuinely assembled byte by byte over a socket.
 *
 * Hence `node:http`, 28 lines of routes, and no dependency. What this buys is
 * specific and not obtainable otherwise:
 *
 *   - `slow-body` needs headers to be flushed and the body to stall *after*
 *     them. That is `res.writeHead()` and a partial `res.write()` followed by
 *     a delayed `res.end()`, and it is the fault the whole directory turns on.
 *   - `reset-mid-body` needs the socket destroyed with a response in flight,
 *     which is `res.socket.destroy()` and has no equivalent above the
 *     transport.
 *   - `black-hole` needs a connection that is accepted and then ignored,
 *     which is a handler that returns without touching `res`.
 *   - `connection-refused` needs a port with nothing behind it, and the only
 *     honest way to get one is to bind a port and close it — see `deadUrl`.
 *
 * ---------------------------------------------------------------------------
 * The ledger
 * ---------------------------------------------------------------------------
 * The server counts the requests it receives per fault, and `runs.ts` reads
 * the count. This is the only way to tell a retry policy that retried from one
 * that did not: the outcome a caller observes is identical either way, which is
 * the same blind spot `intercept/outcomes.ts` describes as `first-try`. A
 * retry wiring whose branch is never entered is the failure mode a chaos suite
 * is supposed to catch and the one it is least likely to assert on.
 */

import { createServer, type Server } from 'node:http'

import type { FaultId } from './faults.ts'
import { HEALTHY_BODY } from './outcomes.ts'
import { INJECTED_MS } from './timings.ts'

/**
 * The first half of a body that never gets a second half.
 *
 * `malformed-body` sends it and stops; `slow-body` sends it, stalls, and then
 * sends the two bytes that complete it. One constant for both, so that the
 * only difference between a payload fault and a latency fault is the timing —
 * if the strings differed, a cell could move for the wrong reason.
 */
const TRUNCATED_BODY = '{"dependency":"ledger","ok":tru'

const JSON_HEADERS = { 'content-type': 'application/json' } as const

/**
 * The one scheduler read in this file.
 *
 * Both latency faults and the reset go through it, so there is a single
 * `setTimeout` to register in `determinism/registry.ts` rather than three, and
 * a single place to read when asking what the delays are doing.
 */
const after = (ms: number, run: () => void): void => {
  setTimeout(run, ms)
}

/** A running fault origin, with the ledger and the teardown. */
export interface Origin {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  readonly baseUrl: string
  /**
   * A URL on a port that was bound and then closed.
   *
   * This is what `connection-refused` is measured against. Picking a port and
   * hoping is not good enough — an unlucky guess hits something listening and
   * the cell quietly becomes a measurement of whatever that was — and the
   * low reserved ports answer with a different error from the runtime before a
   * connection is attempted at all, which is not the fault either.
   */
  readonly deadUrl: string
  /** How many requests the origin has received for a fault. */
  readonly hits: (fault: FaultId) => number
  readonly close: () => Promise<void>
}

/** The path a fault is served at. */
export const pathFor = (fault: FaultId): string => `/${fault}`

export async function startOrigin(): Promise<Origin> {
  const hits = new Map<string, number>()

  /**
   * Which calls have already had their one failure.
   *
   * `transient-500` is the only route with state, and the key is the whole
   * request target rather than the path: `runs.ts` stamps each call with the
   * policy and the index it belongs to, so "the first request of this call"
   * is a question the origin can answer without knowing what a series is.
   * Keyed on the path alone, the first policy to run would absorb the only
   * failure and every policy after it would measure a healthy dependency.
   */
  const spent = new Set<string>()

  const server = createServer((req, res) => {
    const target = req.url ?? '/'
    const path = target.split('?')[0] ?? '/'
    const fault = path.slice(1)

    hits.set(fault, (hits.get(fault) ?? 0) + 1)

    switch (fault) {
      case 'healthy':
      case 'connection-refused':
        // `connection-refused` is served here too, and never reached: the
        // runs point it at `deadUrl`. The route exists so that a run which
        // *did* reach the origin by mistake answers 200 and fails the cell
        // loudly, rather than 404ing into the `http-error` bucket where it
        // would look like a plausible measurement.
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify(HEALTHY_BODY))
        return

      case 'slow-headers':
        after(INJECTED_MS, () => {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify(HEALTHY_BODY))
        })
        return

      case 'slow-body':
        // The whole point of the directory, in three lines: headers and a
        // first chunk go out now, so a caller timing `fetch()` alone has
        // already seen a complete, successful `Response` object.
        res.writeHead(200, { ...JSON_HEADERS, 'transfer-encoding': 'chunked' })
        res.write(TRUNCATED_BODY)
        after(INJECTED_MS, () => {
          res.end('e}')
        })
        return

      case 'error-500':
        res.writeHead(500, JSON_HEADERS)
        res.end(JSON.stringify({ error: 'ledger unavailable' }))
        return

      case 'transient-500':
        if (spent.has(target)) {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify(HEALTHY_BODY))
          return
        }

        spent.add(target)
        res.writeHead(500, JSON_HEADERS)
        res.end(JSON.stringify({ error: 'ledger electing a leader' }))
        return

      case 'malformed-body':
        res.writeHead(200, JSON_HEADERS)
        res.end(TRUNCATED_BODY)
        return

      case 'reset-mid-body':
        res.writeHead(200, { ...JSON_HEADERS, 'transfer-encoding': 'chunked' })
        res.write(TRUNCATED_BODY)
        // Short rather than `INJECTED_MS`: a reset is not a latency fault and
        // nothing measures when it lands, only that the body never completes.
        // The delay exists so the chunk is flushed before the socket goes.
        after(20, () => {
          res.socket?.destroy()
        })
        return

      case 'black-hole':
        return

      default:
        res.writeHead(404, JSON_HEADERS)
        res.end(JSON.stringify({ error: `no such fault: ${fault}` }))
    }
  })

  const baseUrl = await listen(server)
  const deadUrl = await bindAndClose()

  return {
    baseUrl,
    deadUrl,
    hits: (fault) => hits.get(fault) ?? 0,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // `closeAllConnections` first, and it is not optional: `black-hole`
        // leaves a request parked and `close()` alone waits for it, so the
        // suite would hang on teardown having measured everything correctly.
        server.closeAllConnections()
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

/** Bind to an ephemeral loopback port and report the URL. */
function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        reject(new Error('origin did not bind to a TCP port'))
        return
      }

      resolve(`http://127.0.0.1:${String(address.port)}`)
    })
  })
}

/** A URL whose port is known to have been free, and is now unoccupied again. */
async function bindAndClose(): Promise<string> {
  const scratch = createServer()
  const url = await listen(scratch)

  await new Promise<void>((resolve, reject) => {
    scratch.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

  return url
}
