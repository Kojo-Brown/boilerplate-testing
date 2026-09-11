// @vitest-environment node
/**
 * The subject, held to its own document.
 *
 * Every cell in the matrix is a difference between the conforming service and
 * one drifting copy of it, so the conforming service has to actually conform —
 * otherwise the control row is quiet for the wrong reason and every `miss`
 * below it is unreadable. That is what the first half of this file is for.
 *
 * The second half asserts the one thing `service.ts` gets deliberately wrong.
 * `DELETE /orders/{orderId}` returns a shape the document does not describe,
 * permanently, and the tests here are the only place in this directory that
 * sends it a request — which is the whole point of `coverage.ts` and is stated
 * as an assertion rather than left as a claim in a README.
 */

import { describe, expect, it } from 'vitest'

import { compileDocument } from './schema.ts'
import { handle, KNOWN_ORDER_ID, MISSING_ORDER_ID, ORDERS, serialise } from './service.ts'
import { resolveOperation, type Json } from './spec.ts'

const validators = compileDocument('strict')

const request = (method: string, path: string, query: Record<string, string> = {}, body?: Json) => ({
  method,
  path,
  query,
  headers: body === undefined ? {} : { 'content-type': 'application/json' },
  body,
})

/** Validate a response against whatever the document declares for it. */
function conformanceOf(method: string, path: string, status: number, payload: Json): readonly string[] {
  const resolved = resolveOperation(method, path)

  if (resolved === null) return [`no operation for ${method} ${path}`]

  const validate = validators.responseBody(resolved.pathTemplate, resolved.method, status, 'application/json')

  if (validate === null) return [`no schema for ${method} ${path} ${status}`]

  return validate(payload).map((problem) => `${problem.at} ${problem.message}`)
}

describe('the conforming service', () => {
  it('returns every order when nothing is filtered', () => {
    const response = handle(request('GET', '/orders'))

    expect(response.status).toBe(200)
    expect(Array.isArray(response.payload) ? response.payload : []).toHaveLength(ORDERS.length)
  })

  it('filters by status', () => {
    const response = handle(request('GET', '/orders', { status: 'shipped' }))

    expect(Array.isArray(response.payload) ? response.payload : []).toHaveLength(1)
  })

  it('returns nothing for a declared status no order has', () => {
    // The request behind the `empty-collection` row. Legal, documented, empty.
    expect(handle(request('GET', '/orders', { status: 'refunded' })).payload).toEqual([])
  })

  it('serves a known order as the document describes it', () => {
    const response = handle(request('GET', `/orders/${KNOWN_ORDER_ID}`))

    expect(response.status).toBe(200)
    expect(conformanceOf('GET', `/orders/${KNOWN_ORDER_ID}`, 200, response.payload)).toEqual([])
  })

  it('serves a list as the document describes it', () => {
    const response = handle(request('GET', '/orders'))

    expect(conformanceOf('GET', '/orders', 200, response.payload)).toEqual([])
  })

  it('answers a problem document for an order that is not there', () => {
    const response = handle(request('GET', `/orders/${MISSING_ORDER_ID}`))

    expect(response.status).toBe(404)
    expect(conformanceOf('GET', `/orders/${MISSING_ORDER_ID}`, 404, response.payload)).toEqual([])
  })

  it('places an order and says where to read it', () => {
    const response = handle(request('POST', '/orders', {}, { items: [{ sku: 'SKU-MUG-11', quantity: 1 }], note: null }))

    expect(response.status).toBe(201)
    expect(response.headers['location']).toMatch(/^\/orders\//)
    expect(conformanceOf('POST', '/orders', 201, response.payload)).toEqual([])
  })

  it('rejects an order with no items', () => {
    const response = handle(request('POST', '/orders', {}, { items: [] }))

    expect(response.status).toBe(400)
    expect(conformanceOf('POST', '/orders', 400, response.payload)).toEqual([])
  })

  it('places the same order twice identically', () => {
    // No clock and no RNG: the injected defaults are what make every cell in
    // the matrix a fact rather than a sample.
    const body = { items: [{ sku: 'SKU-DESK-07', quantity: 1 }], note: 'twice' }

    expect(serialise(handle(request('POST', '/orders', {}, body)))).toBe(
      serialise(handle(request('POST', '/orders', {}, body))),
    )
  })
})

describe('the operation nothing in the corpus calls', () => {
  const response = handle(request('DELETE', `/orders/${KNOWN_ORDER_ID}`))

  it('answers 200, exactly as the document declares', () => {
    expect(response.status).toBe(200)
  })

  it('returns a body the document does not describe', () => {
    const problems = conformanceOf('DELETE', `/orders/${KNOWN_ORDER_ID}`, 200, response.payload)

    // Five required properties absent and one undeclared property present.
    // Any wiring in this directory would report it the instant anything asked.
    expect(problems.length).toBeGreaterThanOrEqual(5)
  })

  it('is reachable, so nothing but the absence of a request is hiding it', () => {
    expect(handle(request('DELETE', `/orders/${MISSING_ORDER_ID}`)).status).toBe(404)
  })
})
