/**
 * The fixture origin, bound to a socket.
 *
 * The only file in `authstate/` that imports `node:http`, for the reason
 * `intercept/server.ts` gives: `origin.ts` is a pure function of a request and
 * a state object, so the routing table is checked in the unit run and the shape
 * census counts one integration test here rather than the whole directory.
 *
 * Two entry points, because there are two ways this origin is needed:
 *
 *   - `startOrigin(port)` — used by `runs.test.ts`, which drives real
 *     `playwright test` runs and needs to read the ledger back afterwards from
 *     the same process.
 *   - `node authstate/server.ts` — used by the browser half's Playwright
 *     config, which starts it as a child process and waits for the port.
 *
 * The parked-request deadline is the part worth reading. `/api/barrier` is how
 * two workers are ordered against each other without a sleep, and a barrier
 * that never fills — because a worker died, or because the run used a different
 * worker count than the barrier was written for — would otherwise hang until
 * Playwright's own timeout fired somewhere unrelated. So a parked request gets
 * {@link BARRIER_TIMEOUT_MS} and then a 504 naming the barrier, which turns a
 * hang into a message.
 */

import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

import { createState, respond, ORIGIN_PORT, type OriginState } from './origin.ts'

/** How long a request may sit on a barrier before the origin gives up on it. */
export const BARRIER_TIMEOUT_MS = 30_000

/** Read the port from the environment, falling back to the baked-in one. */
export function portFromEnv(value: string | undefined): number {
  if (value === undefined) {
    return ORIGIN_PORT
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(`AUTHSTATE_PORT must be a port number, got ${JSON.stringify(value)}`)
  }

  return parsed
}

/** A bound origin, and the state it is answering from. */
export interface RunningOrigin {
  readonly server: Server
  readonly state: OriginState
  /** The port actually bound, which is the interesting one when 0 was asked for. */
  readonly port: number
  close(): Promise<void>
}

/**
 * Bind the origin and resolve once it is accepting connections.
 *
 * The state is created per server rather than per module so that two origins in
 * one process do not share a ledger — which `runs.test.ts` does not need today
 * and would be a silent cross-test leak the day it did.
 */
export function startOrigin(port = ORIGIN_PORT): Promise<RunningOrigin> {
  const state = createState()

  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []

    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const response = respond(state, {
        method: incoming.method ?? 'GET',
        url: incoming.url ?? '/',
        body: Buffer.concat(chunks).toString('utf8'),
        headers: incoming.headers as Readonly<Record<string, string | undefined>>,
      })

      if (response.kind === 'body') {
        outgoing.writeHead(response.status, response.headers)
        outgoing.end(response.body)

        return
      }

      const timer = setTimeout(() => {
        outgoing.writeHead(504, { 'content-type': 'application/json; charset=utf-8' })
        outgoing.end(
          JSON.stringify({
            error: 'barrier-timeout',
            after: BARRIER_TIMEOUT_MS,
            detail:
              'A request parked on a barrier that never filled. Either a worker died before ' +
              'reaching it, or the run used a different worker count than the barrier expects.',
          }),
        )
      }, BARRIER_TIMEOUT_MS)

      // `unref` so a parked request cannot by itself keep the process alive:
      // `close()` should end the run even with somebody still on a barrier.
      timer.unref()

      void response.release.then(
        () => {
          clearTimeout(timer)
          outgoing.writeHead(response.status, response.headers)
          outgoing.end(response.body)
        },
        (error: unknown) => {
          clearTimeout(timer)
          outgoing.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          outgoing.end(JSON.stringify({ error: 'bad-barrier', detail: String(error) }))
        },
      )
    })
  })

  return new Promise<RunningOrigin>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        reject(new Error('The origin bound to a pipe rather than a TCP port'))

        return
      }

      resolve({
        server,
        state,
        port: address.port,
        close: () =>
          new Promise<void>((done, failed) => {
            server.closeAllConnections()
            server.close((error) => (error ? failed(error) : done()))
          }),
      })
    })
  })
}

// Started as a child process by the Playwright config's `webServer`. The
// `import.meta.url` guard is what lets the same file be imported by
// `runs.test.ts` without binding a second port.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = portFromEnv(process.env['AUTHSTATE_PORT'])
  const running = await startOrigin(port)

  process.stdout.write(`authstate origin listening on http://127.0.0.1:${running.port}\n`)
}
