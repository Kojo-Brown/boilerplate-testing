/**
 * The document, and the lookups every wiring depends on.
 *
 * Small, and load-bearing out of proportion to its size: `resolveOperation` is
 * the first thing every strategy calls, and a resolver that returns the wrong
 * operation makes the whole matrix a comparison against a schema that was never
 * meant to describe the response. A resolver that returns `null` too eagerly is
 * worse — four of the six wirings treat "no schema" as "nothing to check", so a
 * quietly broken resolver turns the table green.
 */

import { describe, expect, it } from 'vitest'

import {
  declaredResponses,
  METHODS,
  resolveOperation,
  responseFor,
  SPEC,
  type Document,
  type Json,
  type OperationSpec,
} from './spec.ts'

describe('resolving an operation', () => {
  it('matches a literal path', () => {
    expect(resolveOperation('GET', '/orders')?.pathTemplate).toBe('/orders')
  })

  it('matches a templated path and reads the parameter out of it', () => {
    const resolved = resolveOperation('GET', '/orders/abc-123')

    expect(resolved?.pathTemplate).toBe('/orders/{orderId}')
    expect(resolved?.pathParams).toEqual({ orderId: 'abc-123' })
  })

  it('lower-cases the method the way the document spells it', () => {
    expect(resolveOperation('GET', '/orders')?.method).toBe('get')
  })

  it('declines a method the document does not declare on that path', () => {
    expect(resolveOperation('PUT', '/orders')).toBeNull()
  })

  it('declines a method that is not an HTTP method at all', () => {
    expect(resolveOperation('TRACE', '/orders')).toBeNull()
  })

  it('refuses to let one template swallow an extra segment', () => {
    // The bug a regex-compiled matcher has: `^/orders/(.+)$` matches this and
    // resolves it to `getOrder`, so the conformance check validates a 404 body
    // against the `Order` schema and reports drift that is not there.
    expect(resolveOperation('GET', '/orders/abc-123/items')).toBeNull()
  })

  it('refuses to read an empty segment as a path parameter', () => {
    expect(resolveOperation('GET', '/orders/')).toBeNull()
  })

  it('decodes a percent-encoded path parameter', () => {
    expect(resolveOperation('GET', '/orders/a%2Fb')?.pathParams).toEqual({ orderId: 'a/b' })
  })

  it('prefers a literal path to a templated one that also matches', () => {
    // The rule OpenAPI states and every router implements: `/orders/summary` is
    // the summary endpoint, not an order whose id happens to be "summary".
    const summary: OperationSpec = {
      operationId: 'orderSummary',
      summary: 'Totals across every order.',
      responses: { '200': { description: 'The totals.', content: {} } },
    }
    const withSummary: Document = {
      ...SPEC,
      paths: { ...SPEC.paths, '/orders/summary': { get: summary } },
    }

    expect(resolveOperation('GET', '/orders/summary', withSummary)?.pathTemplate).toBe('/orders/summary')
  })
})

describe('resolving a response', () => {
  it('finds a declared status', () => {
    const operation = SPEC.paths['/orders/{orderId}']?.get

    expect(operation && responseFor(operation, 200)).not.toBeNull()
  })

  it('returns null for a status the operation does not declare', () => {
    const operation = SPEC.paths['/orders/{orderId}']?.get

    expect(operation && responseFor(operation, 409)).toBeNull()
  })
})

describe('the document itself', () => {
  it('lists every declared method, path and status', () => {
    expect(declaredResponses()).toEqual([
      'GET /orders 200',
      'POST /orders 201',
      'POST /orders 400',
      'GET /orders/{orderId} 200',
      'GET /orders/{orderId} 404',
      'DELETE /orders/{orderId} 200',
      'DELETE /orders/{orderId} 404',
    ])
  })

  it('resolves every local reference it contains', () => {
    const names = new Set(Object.keys(SPEC.components.schemas))
    const seen: string[] = []

    const walk = (node: Json): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }

      if (node === null || typeof node !== 'object') return

      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') seen.push(value)
        else walk(value)
      }
    }

    walk(JSON.parse(JSON.stringify(SPEC)) as Json)

    expect(seen.length).toBeGreaterThan(0)

    for (const reference of seen) {
      expect(reference.startsWith('#/components/schemas/'), `${reference} is not a local schema reference`).toBe(true)
      expect(names, `${reference} points at nothing`).toContain(reference.replace('#/components/schemas/', ''))
    }
  })

  it('declares a response body for every operation that is not a 404', () => {
    for (const [pathTemplate, item] of Object.entries(SPEC.paths)) {
      for (const method of METHODS) {
        const operation = item[method]

        if (operation === undefined) continue

        for (const [status, response] of Object.entries(operation.responses)) {
          expect(
            Object.keys(response.content ?? {}),
            `${method} ${pathTemplate} ${status} declares no content`,
          ).not.toHaveLength(0)
        }
      }
    }
  })

  it('leaves every object schema open, which is what makes `extra-field` a finding', () => {
    // If this ever fails, somebody has closed the document and the README's
    // `extra-field` row is wrong — `body-schema` would start catching it. That
    // is a good change to make and a bad one to make silently.
    for (const [name, schema] of Object.entries(SPEC.components.schemas)) {
      expect(schema['additionalProperties'], `${name} is closed`).toBeUndefined()
    }
  })
})
