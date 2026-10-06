/**
 * The fixture origin the k6 scenarios can be pointed at.
 *
 * A load-test template is the one kind of example that cannot be verified by
 * reading it: a profile with a typo in a stage duration, a threshold on a
 * metric the script never produces, or a tag the thresholds select on and the
 * script never sets all look fine on the page and do nothing in a run. So this
 * repository ships a target, and `check.ts` runs the real k6 binary against it.
 *
 * It serves the three endpoints `load-test.ts` calls, so
 *
 *     BASE_URL=http://localhost:8799 K6_PROFILE=smoke k6 run k6/load-test.ts
 *
 * is a complete run with nothing else installed, plus two routes that exist to
 * make a threshold breach on purpose — `/slow` and `/fail` — because a gate
 * that has only ever been seen to pass has not been seen to work.
 *
 * Like `intercept/server.ts` and for the same reason, this is the only file
 * here that touches `node:http`, and it binds before returning: a caller that
 * gets the port back can connect to it.
 */

import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'

/** The default port. `K6_ORIGIN_PORT` overrides it. */
export const ORIGIN_PORT = 8799

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** A fake bearer token, for the shape of an authenticated response only. */
const FAKE_TOKEN_PREFIX = 'mock-access-token'

interface Created {
  readonly id: string
  readonly name: string
  readonly role: string
}

/**
 * The routing table, as a pure function of method, path and query.
 *
 * Separated from the socket so the route behaviour is unit-testable and the
 * census counts one integration test here rather than the directory.
 */
export interface Reply {
  readonly status: number
  readonly body: string
  /** Milliseconds to wait before replying. `/slow` is the only route that does. */
  readonly delayMs: number
}

export function route(method: string, url: string): Reply {
  const parsed = new URL(url, `http://localhost:${ORIGIN_PORT}`)
  const path = parsed.pathname

  if (method === 'GET' && path === '/health') {
    return reply(200, { status: 'ok', uptime: 1 })
  }

  if (method === 'GET' && path === '/v1/users') {
    const page = positiveInt(parsed.searchParams.get('page'), 1)
    const limit = positiveInt(parsed.searchParams.get('limit'), 20)

    return reply(200, {
      data: Array.from({ length: limit }, (_, index) => ({
        id: `user-${(page - 1) * limit + index + 1}`,
        name: `Fixture User ${(page - 1) * limit + index + 1}`,
        token: `${FAKE_TOKEN_PREFIX}-${page}-${index}`,
      })),
      page,
      limit,
      total: 500,
    })
  }

  if (method === 'POST' && path === '/v1/users') {
    const created: Created = { id: 'user-created', name: 'Fixture User', role: 'viewer' }
    return reply(201, created)
  }

  // Deliberate breach routes. `/slow` is how a latency threshold is made to
  // fail without waiting for a real system to be slow, and `/fail` is how
  // `http_req_failed` is made to move.
  if (method === 'GET' && path === '/slow') {
    const delayMs = positiveInt(parsed.searchParams.get('ms'), 500)
    return { ...reply(200, { slept: delayMs }), delayMs }
  }

  if (method === 'GET' && path === '/fail') {
    const status = positiveInt(parsed.searchParams.get('status'), 500)
    return reply(status, { error: 'deliberate failure', status })
  }

  return reply(404, { error: 'not found', path })
}

function reply(status: number, body: unknown): Reply {
  return { status, body: JSON.stringify(body), delayMs: 0 }
}

/**
 * Reads a positive integer from a query parameter.
 *
 * Clamped rather than rejected: a load test that 400s because a generated
 * query string was odd measures the generator, not the system.
 */
function positiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback

  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed < 1) return fallback

  return Math.min(parsed, 1000)
}

export interface Origin {
  readonly port: number
  readonly baseUrl: string
  close: () => Promise<void>
}

/** Starts the origin and resolves once it is accepting connections. */
export function startOrigin(port = portFromEnv()): Promise<Origin> {
  const server: Server = createServer((req, res) => {
    const { status, body, delayMs } = route(req.method ?? 'GET', req.url ?? '/')

    // Request bodies are drained so a POST does not leave the socket
    // half-read, which k6 reports as a failed request rather than a slow one.
    req.resume()

    const send = (): void => {
      res.writeHead(status, JSON_HEADERS)
      res.end(body)
    }

    if (delayMs > 0) {
      setTimeout(send, delayMs)
    } else {
      send()
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        reject(new Error('Origin bound to a pipe rather than a TCP port'))
        return
      }

      resolve({
        port: address.port,
        baseUrl: `http://localhost:${address.port}`,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    })
  })
}

export function portFromEnv(value: string | undefined = process.env['K6_ORIGIN_PORT']): number {
  if (value === undefined || value === '') return ORIGIN_PORT

  const parsed = Number(value)

  // 0 is allowed: it is how both `check.ts` and this module's own suite ask
  // the OS for a free port, and rejecting it here while accepting it in
  // `startOrigin` would mean the environment variable could not express the
  // thing the code already does.
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(
      `K6_ORIGIN_PORT must be a TCP port, or 0 to let the OS pick one, ` +
        `got ${JSON.stringify(value)}`,
    )
  }

  return parsed
}

// `node k6/server.ts` runs the origin in the foreground, for driving a k6 run
// by hand from another shell.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const origin = await startOrigin()
  console.log(`k6 fixture origin listening on ${origin.baseUrl}`)
}
