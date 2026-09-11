/**
 * The corpus: eleven ways a working service stops matching its document, plus
 * the conforming baseline.
 *
 * ---------------------------------------------------------------------------
 * How these were chosen
 * ---------------------------------------------------------------------------
 * Not by enumerating JSON Schema keywords. A corpus built that way measures
 * Ajv, and Ajv does not need measuring — it implements the specification and
 * `minLength` will keep working. The question this module is about is *which
 * divergences a conformance wiring can see at all*, and the interesting ones
 * are almost all outside the response body schema: a status nobody declared, a
 * content type nobody declared, a required header that went missing, a query
 * parameter the handler honours and the document has never heard of. Every one
 * of those is invisible to "validate the body against the schema", which is
 * what most teams mean when they say they have schema-conformance tests.
 *
 * So each entry below is a regression somebody has actually shipped:
 *
 *   - `extra-field` is a `select *` reaching a serialiser.
 *   - `missing-required` is a column made nullable.
 *   - `wrong-type` is a numeric column read through a driver that returns
 *     strings for `bigint` — the single most common one in this list.
 *   - `format-violation` is a date column serialised with `toISOString().slice(0, 10)`.
 *   - `enum-drift` is a new state added to the domain and not to the document.
 *   - `nested-null` is a left join.
 *   - `undeclared-status` is a new conflict case added to a handler.
 *   - `wrong-content-type` is an error path that reached for `res.send(string)`.
 *   - `missing-header` is a `Location` dropped in a refactor from 201-with-body
 *     to 201-with-body-and-ETag.
 *   - `undeclared-query-param` is a filter added to the handler and to the
 *     client, and never to the document.
 *   - `empty-collection` is not a regression at all. It is `wrong-type` again,
 *     against a request that legitimately matches no rows, and it is in the
 *     corpus because the whole table goes green and the bug is still there.
 *
 * ---------------------------------------------------------------------------
 * One drift is not in this file
 * ---------------------------------------------------------------------------
 * `DELETE /orders/{orderId}` is broken in `service.ts` permanently and
 * unconditionally. It is not a row here because no request in this corpus sends
 * it, and that is precisely its point — see `coverage.ts`.
 */

import { isJsonArray, isJsonObject, type Json } from './spec.ts'
import { KNOWN_ORDER_ID, type ResponseTransform, type ServiceResponse } from './service.ts'

/** The one request a drift is exercised by. */
export interface RequestPlan {
  readonly method: 'GET' | 'POST' | 'DELETE'
  /** Path only; `query` is appended by the capture. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: Json
  /**
   * The status the test author wrote down.
   *
   * Not "the status the service returns" — the whole point of the
   * `undeclared-status` row is that those two are different, and the
   * `status-only` wiring is the one that notices.
   */
  readonly expect: number
}

export interface Drift {
  readonly key: string
  /** What this looks like in a real codebase, one line. Audited against README.md. */
  readonly blurb: string
  readonly request: RequestPlan
  readonly transform: ResponseTransform
}

const identity: ResponseTransform = (response) => response

/** Edit a JSON object payload, leaving every other payload shape alone. */
function editPayload(
  response: ServiceResponse,
  edit: (payload: Record<string, Json>) => Record<string, Json>,
): ServiceResponse {
  const { payload } = response

  if (!isJsonObject(payload)) return response

  return { ...response, payload: edit({ ...payload }) }
}

/** Edit every element of a JSON array payload. */
function editItems(response: ServiceResponse, edit: (item: Json) => Json): ServiceResponse {
  const { payload } = response

  return isJsonArray(payload) ? { ...response, payload: payload.map(edit) } : response
}

/** Keep only the elements of a JSON array payload that a predicate accepts. */
function keepItems(response: ServiceResponse, keep: (item: Json) => boolean): ServiceResponse {
  const { payload } = response

  return isJsonArray(payload) ? { ...response, payload: payload.filter(keep) } : response
}

const READ_KNOWN_ORDER: RequestPlan = { method: 'GET', path: `/orders/${KNOWN_ORDER_ID}`, expect: 200 }

/**
 * A `bigint` column read through a driver that hands back strings.
 *
 * Reused by two drifts, and the reuse is the finding: `wrong-type` and
 * `empty-collection` are the *same bug*, differing only in the request that
 * meets it.
 */
const stringifyAmount = (item: Json): Json => {
  if (!isJsonObject(item)) return item

  const total = item['total']

  if (!isJsonObject(total)) return item

  return { ...item, total: { ...total, amount: String(total['amount']) } }
}

export const DRIFTS: readonly Drift[] = [
  {
    key: 'none',
    blurb: 'The service as written. Every wiring must be silent here.',
    request: READ_KNOWN_ORDER,
    transform: identity,
  },
  {
    key: 'extra-field',
    blurb: 'A `select *` reaches the serialiser and an internal column ships.',
    request: READ_KNOWN_ORDER,
    transform: (response) =>
      editPayload(response, (payload) => ({ ...payload, internalCostPence: 940, warehouse: 'LEEDS-2' })),
  },
  {
    key: 'missing-required',
    blurb: 'A column is made nullable and a required property stops being sent.',
    request: READ_KNOWN_ORDER,
    transform: (response) =>
      editPayload(response, ({ placedAt: _dropped, ...rest }) => rest),
  },
  {
    key: 'wrong-type',
    blurb: 'A numeric column arrives as a string from the driver.',
    request: READ_KNOWN_ORDER,
    transform: (response) => ({ ...response, payload: stringifyAmount(response.payload) }),
  },
  {
    key: 'format-violation',
    blurb: 'A `date-time` is serialised as a bare date.',
    request: READ_KNOWN_ORDER,
    transform: (response) =>
      editPayload(response, (payload) => ({
        ...payload,
        placedAt: String(payload['placedAt']).slice(0, 10),
      })),
  },
  {
    key: 'enum-drift',
    blurb: 'A new lifecycle state is added to the domain and not to the document.',
    request: READ_KNOWN_ORDER,
    transform: (response) => editPayload(response, (payload) => ({ ...payload, status: 'dispatched' })),
  },
  {
    key: 'nested-null',
    blurb: 'A left join puts a null inside an array item, two levels down.',
    request: READ_KNOWN_ORDER,
    transform: (response) =>
      editPayload(response, (payload) => {
        const items = payload['items']

        if (!isJsonArray(items)) return payload

        return {
          ...payload,
          items: items.map((item, index) =>
            index === 0 && isJsonObject(item) ? { ...item, sku: null } : item,
          ),
        }
      }),
  },
  {
    key: 'undeclared-status',
    blurb: 'A conflict case is added to the handler; the document declares 200 and 404.',
    request: READ_KNOWN_ORDER,
    transform: (response) => ({
      ...response,
      status: 409,
      payload: { title: 'Order is locked', status: 409, detail: 'A fulfilment run holds this order.' },
    }),
  },
  {
    key: 'wrong-content-type',
    blurb: 'A path reaches for `res.send(string)` and answers text where JSON is declared.',
    request: READ_KNOWN_ORDER,
    transform: (response) => ({
      ...response,
      headers: { ...response.headers, 'content-type': 'text/plain; charset=utf-8' },
      payload: `order ${KNOWN_ORDER_ID} is placed`,
    }),
  },
  {
    key: 'missing-header',
    blurb: 'A refactor drops the `Location` header from a 201 that still declares it.',
    request: {
      method: 'POST',
      path: '/orders',
      body: { items: [{ sku: 'SKU-CHAIR-01', quantity: 2 }], note: null },
      expect: 201,
    },
    transform: (response) => {
      const { location: _dropped, ...headers } = response.headers

      return { ...response, headers }
    },
  },
  {
    key: 'undeclared-query-param',
    blurb: 'A filter is added to the handler and the client, and never to the document.',
    request: { method: 'GET', path: '/orders', query: { settledOnly: 'true' }, expect: 200 },
    // The handler honours the parameter, and the response it produces is
    // impeccable — a conforming array of conforming orders. Nothing about the
    // response is wrong. The document is what is wrong, and only a wiring that
    // reads the request can say so.
    transform: (response, request) =>
      request.query['settledOnly'] === 'true'
        ? keepItems(response, (item) => isJsonObject(item) && item['status'] === 'shipped')
        : response,
  },
  {
    key: 'empty-collection',
    blurb: 'The `wrong-type` bug again, against a filter that legitimately matches no rows.',
    request: { method: 'GET', path: '/orders', query: { status: 'refunded' }, expect: 200 },
    transform: (response) => editItems(response, stringifyAmount),
  },
]

/** Look one drift up by key, for tests that name a row rather than an index. */
export function driftFor(key: string): Drift {
  const drift = DRIFTS.find((candidate) => candidate.key === key)

  if (drift === undefined) throw new Error(`No drift named ${key}`)

  return drift
}
