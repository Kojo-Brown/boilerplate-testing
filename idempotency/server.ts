/**
 * The `node:http` shell around `service.ts`.
 *
 * Its own file for the reason `openapi/server.ts` gives: `shape/boundaries.ts`
 * classifies a test by what it reaches transitively, so folding this one import
 * into `service.ts` would make every unit test of a handler — and of the
 * scoring, and of the hazard corpus — count as an integration test. The
 * boundary is real; only the code that crosses it should pay for it.
 *
 * ---------------------------------------------------------------------------
 * Why there is a socket here at all
 * ---------------------------------------------------------------------------
 * The matrix runs against handler functions, which is the right place to
 * measure eighty-eight cells: it is fast, it is deterministic, and the crash
 * and overlap points are reachable. The obvious objection is that it therefore
 * measures functions rather than HTTP handlers, and that the header parsing,
 * status codes and body serialisation — the parts a real client actually meets
 * — are assumed.
 *
 * `server.test.ts` answers that objection rather than arguing with it. It takes
 * the two rows where the stakes are highest, drives them over a real loopback
 * socket with a real `Idempotency-Key` header, and checks the same outcomes
 * come out. If the transport changed an answer, that is where it would show.
 */

import { createServer, type Server } from 'node:http'

import type { ChargeRequest, Context, Handler } from './service.ts'

export const CHARGES_PATH = '/v1/charges'

export interface ServerOptions {
  readonly handler: Handler
  /**
   * The context factory.
   *
   * A factory rather than a context because `delivery` names the request, and
   * the store, clock and gateway have to be shared across requests for any of
   * this to mean anything — a server that built a fresh store per request would
   * be idempotent by amnesia.
   */
  readonly contextFor: (delivery: string) => Context
}

interface Parsed {
  readonly request: ChargeRequest
  readonly problem: string | null
}

/**
 * Turn an HTTP request into a {@link ChargeRequest}.
 *
 * `Idempotency-Key` absent is `null` rather than an error, because that is a
 * real case the strategies disagree about: `memo-after` and its relatives fall
 * back to `none` without a key, and a service that rejected keyless requests
 * would be a different design from any of the eight.
 */
function parse(body: string, headers: Readonly<Record<string, string>>): Parsed {
  let payload: unknown

  try {
    payload = JSON.parse(body === '' ? '{}' : body)
  } catch {
    return {
      request: { principal: '', key: null, orderId: '', amount: 0 },
      problem: 'body is not JSON',
    }
  }

  const record = payload as Record<string, unknown>
  const principal = headers['x-principal']
  const orderId = record['orderId']
  const amount = record['amount']

  if (typeof principal !== 'string' || principal === '') {
    return { request: { principal: '', key: null, orderId: '', amount: 0 }, problem: 'X-Principal is required' }
  }

  if (typeof orderId !== 'string' || typeof amount !== 'number') {
    return {
      request: { principal, key: null, orderId: '', amount: 0 },
      problem: 'orderId must be a string and amount a number',
    }
  }

  return {
    request: {
      principal,
      key: headers['idempotency-key'] ?? null,
      orderId,
      amount,
    },
    problem: null,
  }
}

/**
 * The service as an unbound `node:http` server.
 *
 * Unbound for the reason `supertest/createTestApp.ts` documents at length: a
 * server bound lazily by the first request is a server closed again when *that*
 * request ends, which resets siblings still in flight. The caller binds it and
 * owns the listener.
 */
export function createChargesServer(options: ServerOptions): Server {
  let delivery = 0

  return createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []

    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      void (async () => {
        const headers: Record<string, string> = {}

        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string') headers[name] = value
        }

        const respond = (status: number, body: unknown, replayed = false): void => {
          const serialised = JSON.stringify(body)

          outgoing.writeHead(status, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(serialised),
            // The header Stripe sends, and the one a client needs to tell "your
            // charge went through" from "your charge went through earlier".
            'idempotent-replayed': String(replayed),
          })
          outgoing.end(serialised)
        }

        if (incoming.method !== 'POST' || incoming.url !== CHARGES_PATH) {
          respond(404, { error: 'not_found' })

          return
        }

        const { request, problem } = parse(Buffer.concat(chunks).toString('utf8'), headers)

        if (problem !== null) {
          respond(400, { error: 'bad_request', detail: problem })

          return
        }

        delivery += 1

        try {
          const response = await options.handler(options.contextFor(`http_${String(delivery)}`), request)

          respond(response.status, response.body, response.replayed)
        } catch (cause) {
          // The error middleware every framework has. `harness.ts` does the
          // same thing for the same reason, and both are the honest model: an
          // unhandled error in a handler becomes a 500, it does not take the
          // server down.
          respond(500, { error: 'unhandled', detail: cause instanceof Error ? cause.message : String(cause) })
        }
      })()
    })
  })
}
