/**
 * The six wirings, over exchanges written down rather than captured.
 *
 * `matrix.test.ts` drives real sockets and answers one question: what does each
 * wiring say about the twelve exchanges the corpus produces. That is the
 * finding, and it is not coverage — a corpus chosen to be a set of *realistic
 * regressions* leaves whole branches of `strategies.ts` unreached, because the
 * things it does not contain are the things nobody ships by accident: a request
 * to a path the document has never heard of, a required query parameter left
 * off, a `POST` sent as form-encoded.
 *
 * Those branches decide what a wiring says when it is confused, and a wiring
 * that goes quiet when confused is the failure mode this whole directory is
 * about. So they are tested here, from literals, with no socket — which is also
 * what keeps these in the unit layer where `shape/README.md` argues they belong.
 */

import { describe, expect, it } from 'vitest'

import type { Exchange } from './exchange.ts'
import { KNOWN_ORDER_ID } from './service.ts'
import { baseMediaType, compileWiring, strategyFor, type Finding } from './strategies.ts'
import type { Json } from './spec.ts'

const wiring = compileWiring()

const CONFORMING_ORDER: Json = {
  id: KNOWN_ORDER_ID,
  status: 'placed',
  placedAt: '2026-03-01T09:15:00.000Z',
  total: { amount: 1299, currency: 'GBP' },
  items: [{ sku: 'SKU-CHAIR-01', quantity: 1 }],
  note: null,
}

interface ExchangeOverrides {
  readonly method?: string
  readonly path?: string
  readonly query?: Readonly<Record<string, string>>
  readonly requestHeaders?: Readonly<Record<string, string>>
  readonly requestBody?: Json
  readonly status?: number
  readonly expectedStatus?: number
  readonly contentType?: string | null
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly body?: Json
}

/** A conforming `GET /orders/{orderId}` exchange, with one thing changed at a time. */
function exchange(overrides: ExchangeOverrides = {}): Exchange {
  const status = overrides.status ?? 200
  const contentType = overrides.contentType === undefined ? 'application/json' : overrides.contentType
  const body = overrides.body === undefined ? CONFORMING_ORDER : overrides.body

  return {
    drift: 'synthetic',
    expectedStatus: overrides.expectedStatus ?? status,
    request: {
      method: overrides.method ?? 'GET',
      path: overrides.path ?? `/orders/${KNOWN_ORDER_ID}`,
      query: overrides.query ?? {},
      headers: overrides.requestHeaders ?? {},
      ...(overrides.requestBody === undefined ? { body: undefined } : { body: overrides.requestBody }),
    },
    response: {
      status,
      headers: {
        ...(contentType === null ? {} : { 'content-type': contentType }),
        ...(overrides.responseHeaders ?? {}),
      },
      text: JSON.stringify(body),
      body,
    },
  }
}

const check = (strategy: string, subject: Exchange): readonly Finding[] =>
  strategyFor(strategy).check(subject, wiring.lenient, wiring.strict)

const codes = (strategy: string, subject: Exchange): readonly string[] =>
  check(strategy, subject).map((finding) => finding.code)

describe('every wiring', () => {
  const keys = ['status-only', 'handwritten', 'body-schema', 'body-schema-strict', 'full-response', 'request-and-response']

  it.each(keys)('is quiet about a conforming exchange under `%s`', (strategy) => {
    expect(check(strategy, exchange())).toEqual([])
  })

  it.each(keys.slice(2))('reports a path the document has never heard of under `%s`', (strategy) => {
    // The confused case. Four wirings resolve an operation before doing
    // anything else, and "there is no operation" has to be a finding rather
    // than a reason to stop: a test pointed at a path that does not exist in
    // the document is a test that proves nothing, silently.
    expect(codes(strategy, exchange({ path: '/invoices/1' }))).toContain('unknown-operation')
  })
})

describe('`status-only`', () => {
  it('reports the status the test expected against the one that came back', () => {
    const findings = check('status-only', exchange({ status: 404, expectedStatus: 200, body: null }))

    expect(findings[0]?.message).toBe('expected 200, got 404')
  })

  it('says nothing about a body it never reads', () => {
    expect(check('status-only', exchange({ body: { nonsense: true } }))).toEqual([])
  })
})

describe('`handwritten`', () => {
  it('reports a field the client reads', () => {
    expect(codes('handwritten', exchange({ body: { ...(CONFORMING_ORDER as object), id: 7 } }))).toEqual(['body'])
  })

  it('says nothing about a field the client ignores', () => {
    // `note` is passed through by the client, so no hand-written assertion
    // covers it. This is the shape of the whole `handwritten` row: it catches
    // the drift somebody thought of.
    expect(check('handwritten', exchange({ body: { ...(CONFORMING_ORDER as object), note: 42 } }))).toEqual([])
  })

  it('reports a list whose elements are not orders, naming the index', () => {
    const findings = check('handwritten', exchange({ path: '/orders', body: [CONFORMING_ORDER, { id: 1 }] }))

    expect(findings[0]?.message).toContain('[1]')
  })

  it('stands down on a response it was not written for', () => {
    // A hand-written happy-path assertion run against a 404 body would fail for
    // a reason that is not drift. Every suite skips that; the wiring says so.
    expect(check('handwritten', exchange({ status: 404, expectedStatus: 200, body: { title: 'No such order', status: 404 } }))).toEqual([])
  })
})

describe('`body-schema`', () => {
  it('goes quiet when the document declares no schema for the status', () => {
    expect(check('body-schema', exchange({ status: 409, body: { title: 'Locked', status: 409 } }))).toEqual([])
  })

  it('goes quiet when the document declares no schema for the media type', () => {
    expect(check('body-schema', exchange({ contentType: 'text/plain' }))).toEqual([])
  })

  it('reports a body that did not parse, when a schema does apply', () => {
    const findings = check('body-schema', { ...exchange(), response: { ...exchange().response, body: undefined } })

    expect(findings[0]?.message).toBe('the body did not parse as JSON')
  })

  it('names the path into the instance that failed', () => {
    const drifted = { ...(CONFORMING_ORDER as object), total: { amount: '1299', currency: 'GBP' } }

    expect(check('body-schema', exchange({ body: drifted }))[0]?.message).toContain('body/total/amount')
  })
})

describe('`full-response`', () => {
  it('reports a status the operation does not declare, and lists the ones it does', () => {
    const findings = check('full-response', exchange({ status: 409, body: { title: 'Locked', status: 409 } }))

    expect(findings[0]?.code).toBe('undeclared-status')
    expect(findings[0]?.message).toContain('200, 404')
  })

  it('says nothing further about a body whose status is already the finding', () => {
    // One finding, not two. "409 is undeclared" and "the body did not match a
    // schema that does not exist" are the same fact, and printing both trains
    // readers to skim.
    expect(check('full-response', exchange({ status: 409, body: { nonsense: true } }))).toHaveLength(1)
  })

  it('reports a media type the response does not declare', () => {
    expect(codes('full-response', exchange({ contentType: 'text/plain' }))).toContain('undeclared-content-type')
  })

  it('reports an absent content type rather than treating it as a match', () => {
    const findings = check('full-response', exchange({ contentType: null }))

    expect(findings[0]?.message).toContain('(absent)')
  })

  it('ignores the charset parameter when comparing media types', () => {
    expect(check('full-response', exchange({ contentType: 'application/json; charset=utf-8' }))).toEqual([])
  })

  it('reports a required response header that is absent', () => {
    const post = exchange({ method: 'POST', path: '/orders', status: 201, requestBody: { items: [{ sku: 'A', quantity: 1 }] } })

    expect(codes('full-response', post)).toContain('header')
  })

  it('accepts the required response header when it is there', () => {
    const post = exchange({
      method: 'POST',
      path: '/orders',
      status: 201,
      responseHeaders: { location: `/orders/${KNOWN_ORDER_ID}` },
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { items: [{ sku: 'A', quantity: 1 }] },
    })

    expect(check('full-response', post)).toEqual([])
  })
})

describe('`request-and-response`', () => {
  it('reports a query parameter the document does not declare, and lists the ones it does', () => {
    const findings = check('request-and-response', exchange({ path: '/orders', query: { settledOnly: 'true' }, body: [] }))

    expect(findings[0]?.code).toBe('request')
    expect(findings[0]?.message).toContain('declared: status')
  })

  it('reports a declared query parameter whose value is not what the document allows', () => {
    const findings = check('request-and-response', exchange({ path: '/orders', query: { status: 'dispatched' }, body: [] }))

    expect(findings[0]?.message).toContain('query parameter status')
  })

  it('accepts a declared query parameter with a declared value', () => {
    expect(check('request-and-response', exchange({ path: '/orders', query: { status: 'shipped' }, body: [] }))).toEqual([])
  })

  it('reports a required request body that was not sent', () => {
    const post = exchange({
      method: 'POST',
      path: '/orders',
      status: 201,
      responseHeaders: { location: '/orders/x' },
    })

    expect(check('request-and-response', post)[0]?.message).toBe('a request body is required and none was sent')
  })

  it('reports a request body sent as a media type the document does not declare', () => {
    const post = exchange({
      method: 'POST',
      path: '/orders',
      status: 201,
      responseHeaders: { location: '/orders/x' },
      requestHeaders: { 'content-type': 'application/x-www-form-urlencoded' },
      requestBody: { items: [{ sku: 'A', quantity: 1 }] },
    })

    expect(check('request-and-response', post)[0]?.message).toContain('application/json')
  })

  it('reports a request body that does not match its schema', () => {
    const post = exchange({
      method: 'POST',
      path: '/orders',
      status: 201,
      responseHeaders: { location: '/orders/x' },
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { items: [] },
    })

    expect(check('request-and-response', post)[0]?.message).toContain('request body/items')
  })
})

describe('reading a media type', () => {
  it('drops the parameters', () => {
    expect(baseMediaType('application/json; charset=utf-8')).toBe('application/json')
  })

  it('lower-cases it, because a header is not case-sensitive and a document is', () => {
    expect(baseMediaType('Application/JSON')).toBe('application/json')
  })

  it('reads an absent header as the empty string rather than throwing', () => {
    expect(baseMediaType(undefined)).toBe('')
  })
})
