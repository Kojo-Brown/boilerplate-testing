/**
 * The subject: a small orders service that implements `spec.ts`, plus the seam
 * the corpus in `drifts.ts` uses to break it in one stated way at a time.
 *
 * ---------------------------------------------------------------------------
 * This file imports nothing that opens a socket
 * ---------------------------------------------------------------------------
 * `handle()` is a pure function from a request record to a response record.
 * `server.ts` is the `node:http` shell around it, and the split is not
 * decoration — it is the difference between a test of this service being a unit
 * test and an integration one. `shape/boundaries.ts` resolves what a test
 * reaches *transitively*, so a single `import { createServer } from 'node:http'`
 * at the top of this file would reclassify every test that touches the handler,
 * the drift corpus or the request plans, none of which goes near a socket.
 *
 * The matrix still drives a real server over a real socket — a conformance
 * check that has never seen a content-type header has not been tested against
 * the thing it is for. That is `server.ts` and `exchange.ts`, and it is where
 * the cost belongs.
 *
 * ---------------------------------------------------------------------------
 * Determinism
 * ---------------------------------------------------------------------------
 * No clock, no RNG, no database. The store is a frozen array, ids are literals,
 * and `placedAt` values are literals. `POST /orders` is the one operation that
 * would normally need both, and it gets them injected (`nextId`, `now`) with
 * fixed defaults. The matrix compares 72 cells against a README; a service that
 * returned a different timestamp per run would make every cell a coin toss on
 * the one drift that reads timestamps.
 */

import { isJsonArray, isJsonObject, type Json } from './spec.ts'

export interface ServiceRequest {
  readonly method: string
  /** Path only — no query string. */
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
  /** Parsed body, or `undefined` for a request that carried none. */
  readonly body: Json | undefined
}

export interface ServiceResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  /**
   * The response payload *before* serialisation.
   *
   * A `string` here is written to the wire as-is; anything else is
   * `JSON.stringify`d. That is what lets `wrong-content-type` be a drift rather
   * than a special case in the server: it returns a string payload and a
   * `text/plain` header, exactly as a handler that reached for `res.send()`
   * would.
   */
  readonly payload: Json
}

export interface Order {
  readonly id: string
  readonly status: 'placed' | 'shipped' | 'cancelled' | 'refunded'
  readonly placedAt: string
  readonly total: { readonly amount: number; readonly currency: string }
  readonly items: readonly { readonly sku: string; readonly quantity: number }[]
  readonly note: string | null
}

/**
 * The store.
 *
 * Three orders, one per status, because the `status` filter has to have
 * something to filter and the `empty-collection` drift has to have a filter
 * that legitimately matches nothing interesting. Ids are obviously-fake UUIDs:
 * the shape a `format: uuid` check accepts, with a body no generator would
 * produce.
 */
export const ORDERS: readonly Order[] = Object.freeze([
  {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'placed',
    placedAt: '2026-03-01T09:15:00.000Z',
    total: { amount: 1299, currency: 'GBP' },
    items: [{ sku: 'SKU-CHAIR-01', quantity: 1 }],
    note: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    status: 'shipped',
    placedAt: '2026-03-02T11:40:00.000Z',
    total: { amount: 4550, currency: 'GBP' },
    items: [
      { sku: 'SKU-DESK-07', quantity: 1 },
      { sku: 'SKU-LAMP-02', quantity: 2 },
    ],
    note: 'Leave with the neighbour.',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    status: 'cancelled',
    placedAt: '2026-03-03T16:05:00.000Z',
    total: { amount: 899, currency: 'GBP' },
    items: [{ sku: 'SKU-MUG-11', quantity: 3 }],
    note: null,
  },
])

/** An id in the store, for tests and drifts that need one that exists. */
export const KNOWN_ORDER_ID = ORDERS[0]?.id ?? ''

/** A well-formed id that is deliberately absent, for the 404 path. */
export const MISSING_ORDER_ID = '00000000-0000-4000-8000-0000000009ff'

const JSON_HEADERS = { 'content-type': 'application/json' } as const

/** What `POST /orders` needs from the outside world, so that it has neither. */
export interface PlacementClock {
  readonly nextId: string
  readonly now: string
}

const DEFAULT_PLACEMENT: PlacementClock = {
  nextId: '00000000-0000-4000-8000-00000000000a',
  now: '2026-03-04T08:00:00.000Z',
}

function problem(status: number, title: string, detail: string): ServiceResponse {
  return { status, headers: JSON_HEADERS, payload: { title, status, detail } }
}

/** `Order` widened to `Json` — every field is already JSON, this is the cast-free proof. */
function asJson(order: Order): Json {
  return {
    id: order.id,
    status: order.status,
    placedAt: order.placedAt,
    total: { amount: order.total.amount, currency: order.total.currency },
    items: order.items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
    note: order.note,
  }
}

function listOrders(request: ServiceRequest): ServiceResponse {
  const status = request.query['status']
  const matching = status === undefined ? ORDERS : ORDERS.filter((order) => order.status === status)

  return { status: 200, headers: JSON_HEADERS, payload: matching.map(asJson) }
}

function placeOrder(request: ServiceRequest, placement: PlacementClock): ServiceResponse {
  const body = request.body

  if (!isJsonObject(body)) {
    return problem(400, 'Malformed order', 'The request body must be a JSON object.')
  }

  const items = body['items']

  if (!isJsonArray(items) || items.length === 0) {
    return problem(400, 'Malformed order', 'An order must have at least one item.')
  }

  const note = body['note']
  const placed: Json = {
    id: placement.nextId,
    status: 'placed',
    placedAt: placement.now,
    total: { amount: 1000 * items.length, currency: 'GBP' },
    items,
    note: typeof note === 'string' ? note : null,
  }

  return {
    status: 201,
    headers: { ...JSON_HEADERS, location: `/orders/${placement.nextId}` },
    payload: placed,
  }
}

function readOrder(id: string): ServiceResponse {
  const order = ORDERS.find((candidate) => candidate.id === id)

  return order === undefined
    ? problem(404, 'No such order', `No order with id ${id}.`)
    : { status: 200, headers: JSON_HEADERS, payload: asJson(order) }
}

/**
 * `DELETE /orders/{orderId}` — the operation no exchange in the corpus calls.
 *
 * It returns `{ cancelled: true }` where the document promises an `Order`: five
 * required properties missing and one undeclared property present. Every wiring
 * in `strategies.ts` that reads a body would report it the instant anything sent
 * it a request — `status-only` would not, because the status is the one thing
 * here that is right. Nothing sends it a request, which is the finding
 * `coverage.ts` exists to make.
 */
function cancelOrder(id: string): ServiceResponse {
  const order = ORDERS.find((candidate) => candidate.id === id)

  return order === undefined
    ? problem(404, 'No such order', `No order with id ${id}.`)
    : { status: 200, headers: JSON_HEADERS, payload: { cancelled: true } }
}

const ORDER_PATH = /^\/orders\/(?<id>[^/]+)$/

/** The service, as a pure function. */
export function handle(
  request: ServiceRequest,
  placement: PlacementClock = DEFAULT_PLACEMENT,
): ServiceResponse {
  const method = request.method.toUpperCase()

  if (request.path === '/orders') {
    if (method === 'GET') return listOrders(request)
    if (method === 'POST') return placeOrder(request, placement)

    return problem(405, 'Method not allowed', `${method} is not supported on /orders.`)
  }

  const match = ORDER_PATH.exec(request.path)

  if (match?.groups?.['id'] !== undefined) {
    const id = decodeURIComponent(match.groups['id'])

    if (method === 'GET') return readOrder(id)
    if (method === 'DELETE') return cancelOrder(id)

    return problem(405, 'Method not allowed', `${method} is not supported on /orders/{orderId}.`)
  }

  return problem(404, 'No such resource', `Nothing is served at ${request.path}.`)
}

/**
 * A transform applied to the correct response, which is how `drifts.ts` breaks
 * the service.
 *
 * Modelling drift as a transform rather than as a second copy of each handler
 * has one real cost — it cannot represent a divergence in control flow that the
 * response alone does not show — and one real benefit, which is why it is the
 * choice here: the conforming service and each drifting service differ in
 * exactly the one way the drift's own source states, so a cell that changes
 * colour can only be about that way. Twelve hand-edited copies of the handler
 * would drift from each other in ways nobody declared, and the matrix would be
 * measuring the copies.
 */
export type ResponseTransform = (response: ServiceResponse, request: ServiceRequest) => ServiceResponse

export interface ServerOptions {
  /** Applied to every response. Defaults to the identity — a conforming service. */
  readonly transform?: ResponseTransform
  readonly placement?: PlacementClock
}

/** Serialise a payload for the wire, honouring whatever content type was set. */
export function serialise(response: ServiceResponse): string {
  if (typeof response.payload === 'string') return response.payload

  return JSON.stringify(response.payload)
}
