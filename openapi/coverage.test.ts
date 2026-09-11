/**
 * Coverage arithmetic, over exchanges built by hand.
 *
 * No socket here, deliberately. Coverage is a function of a *set* of exchanges
 * and nothing about the function cares whether they were captured or written
 * down — so the cases that matter (a request to an undeclared path, a status
 * the operation does not declare, the empty set) are clearer as literals, and
 * this file stays a unit test.
 *
 * The half that does need a socket — sending `DELETE /orders/{orderId}` and
 * showing that every wiring which reads a body reports it the instant anything
 * asks — lives in `matrix.test.ts`, next to the corpus whose silence it
 * explains.
 */

import { describe, expect, it } from 'vitest'

import { coverageOf, percentage } from './coverage.ts'
import type { Exchange } from './exchange.ts'
import { KNOWN_ORDER_ID } from './service.ts'

const exchangeFor = (method: string, path: string, status: number): Exchange => ({
  drift: 'synthetic',
  expectedStatus: status,
  request: { method, path, query: {}, headers: {}, body: undefined },
  response: { status, headers: {}, text: '', body: undefined },
})

describe('measuring coverage', () => {
  it('counts an operation as touched when any request resolves to it', () => {
    const coverage = coverageOf([exchangeFor('GET', `/orders/${KNOWN_ORDER_ID}`, 200)])

    expect(coverage.untouchedOperations).not.toContain('GET /orders/{orderId}')
  })

  it('counts a response as observed only for the status that came back', () => {
    const coverage = coverageOf([exchangeFor('GET', `/orders/${KNOWN_ORDER_ID}`, 200)])

    expect(coverage.unobservedResponses).toContain('GET /orders/{orderId} 404')
  })

  it('ignores a request the document describes no operation for', () => {
    // Otherwise a request to a path the document has never heard of would
    // improve the coverage of the paths it has.
    const coverage = coverageOf([exchangeFor('GET', '/invoices', 200)])

    expect(coverage.untouchedOperations).toEqual(coverage.operations)
  })

  it('reports every declared operation when nothing was exercised', () => {
    expect(coverageOf([]).untouchedOperations).toHaveLength(4)
  })

  it('reports every declared response when nothing was exercised', () => {
    expect(coverageOf([]).unobservedResponses).toHaveLength(7)
  })

  it('reaches 100% of operations once the probe is included', () => {
    const everything = [
      exchangeFor('GET', '/orders', 200),
      exchangeFor('POST', '/orders', 201),
      exchangeFor('GET', `/orders/${KNOWN_ORDER_ID}`, 200),
      exchangeFor('DELETE', `/orders/${KNOWN_ORDER_ID}`, 200),
    ]

    expect(coverageOf(everything).untouchedOperations).toEqual([])
  })
})

describe('the percentage', () => {
  it('rounds to one decimal place', () => {
    expect(percentage(3, 7)).toBe(42.9)
  })

  it('calls an empty document fully covered rather than dividing by zero', () => {
    expect(percentage(0, 0)).toBe(100)
  })
})
