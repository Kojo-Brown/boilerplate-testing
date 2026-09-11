/**
 * The compilation layer: the two dialects, and the three things about it that
 * are easy to get quietly wrong.
 *
 * "Quietly" is the operative word in all three. A `$ref` that resolves to
 * nothing, a schema position the strict dialect forgot to rewrite, an
 * `allOf` branch closed by a helper that meant well — none of those throws.
 * Each produces a validator that accepts more than it should, which looks
 * exactly like a service that has stopped drifting.
 */

import { describe, expect, it } from 'vitest'

import { closeObjects, compileDocument, mapSchemas, schemaPositions } from './schema.ts'
import { SPEC, type Json } from './spec.ts'

const CONFORMING_ORDER: Json = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'placed',
  placedAt: '2026-03-01T09:15:00.000Z',
  total: { amount: 1299, currency: 'GBP' },
  items: [{ sku: 'SKU-CHAIR-01', quantity: 1 }],
  note: null,
}

describe('closing objects', () => {
  it('closes an object schema that lists its properties', () => {
    expect(closeObjects({ type: 'object', properties: { a: { type: 'string' } } })).toMatchObject({
      additionalProperties: false,
    })
  })

  it('leaves a schema that already constrains extra properties alone', () => {
    const constrained = { type: 'object', properties: {}, additionalProperties: { type: 'string' } }

    expect(closeObjects(constrained)).toMatchObject({ additionalProperties: { type: 'string' } })
  })

  it('treats `unevaluatedProperties` as a constraint too', () => {
    const constrained = { type: 'object', properties: {}, unevaluatedProperties: false }

    expect(closeObjects(constrained)).not.toHaveProperty('additionalProperties')
  })

  it('treats `patternProperties` as a constraint too', () => {
    const constrained = { type: 'object', properties: {}, patternProperties: { '^x-': { type: 'string' } } }

    expect(closeObjects(constrained)).not.toHaveProperty('additionalProperties')
  })

  it('closes a nested object reached through `properties`', () => {
    const nested = closeObjects({
      type: 'object',
      properties: { inner: { type: 'object', properties: { a: { type: 'string' } } } },
    })

    expect(nested).toMatchObject({ properties: { inner: { additionalProperties: false } } })
  })

  it('closes an object reached through `items`', () => {
    const list = closeObjects({ type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } })

    expect(list).toMatchObject({ items: { additionalProperties: false } })
  })

  it('refuses to close a branch of a combinator', () => {
    // The classic trap: `additionalProperties` cannot see properties declared
    // in a sibling branch, so closing both halves of an `allOf` yields a schema
    // that nothing satisfies. The branches are still recursed into — a nested
    // object inside one is fair game — but the branch itself is left open.
    const composed = closeObjects({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'string' } } },
      ],
    })

    const branches = (composed as { allOf: readonly Record<string, Json>[] }).allOf

    expect(branches[0]).not.toHaveProperty('additionalProperties')
    expect(branches[1]).not.toHaveProperty('additionalProperties')
  })

  it('leaves a bare `$ref` untouched', () => {
    expect(closeObjects({ $ref: '#/components/schemas/Order' })).toEqual({ $ref: '#/components/schemas/Order' })
  })
})

describe('finding the schema positions', () => {
  const positions = schemaPositions().map((path) => path.join('.'))

  it('finds every named component schema', () => {
    for (const name of Object.keys(SPEC.components.schemas)) {
      expect(positions).toContain(`components.schemas.${name}`)
    }
  })

  it('finds a response body schema', () => {
    expect(positions).toContain('paths./orders/{orderId}.get.responses.200.content.application/json.schema')
  })

  it('finds a request body schema', () => {
    expect(positions).toContain('paths./orders.post.requestBody.content.application/json.schema')
  })

  it('finds a parameter schema', () => {
    expect(positions).toContain('paths./orders.get.parameters.0.schema')
  })

  it('finds a response header schema', () => {
    expect(positions).toContain('paths./orders.post.responses.201.headers.Location.schema')
  })

  it('does not descend into a schema that has a property of its own called `schema`', () => {
    const shadowed = {
      ...SPEC,
      components: {
        schemas: {
          ...SPEC.components.schemas,
          Envelope: { type: 'object', properties: { schema: { type: 'string' } } },
        },
      },
    }

    const found = schemaPositions(shadowed).map((path) => path.join('.'))

    expect(found).toContain('components.schemas.Envelope')
    expect(found).not.toContain('components.schemas.Envelope.properties.schema')
  })

  it('rewrites every position it finds and nothing else', () => {
    const rewritten = mapSchemas(SPEC, () => ({ marked: true }))
    const paths = rewritten['paths'] as Record<string, Json>
    const orders = paths['/orders'] as Record<string, Json>
    const get = orders['get'] as Record<string, Json>

    expect((rewritten['components'] as Record<string, Json>)['schemas']).toMatchObject({ Order: { marked: true } })
    expect(get['operationId']).toBe('listOrders')
  })
})

describe('the lenient dialect', () => {
  const validators = compileDocument('lenient')
  const body = validators.responseBody('/orders/{orderId}', 'get', 200, 'application/json')

  it('accepts a conforming order', () => {
    expect(body?.(CONFORMING_ORDER)).toEqual([])
  })

  it('accepts an order carrying a field the document never declared', () => {
    expect(body?.({ ...(CONFORMING_ORDER as Record<string, Json>), leaked: 'yes' })).toEqual([])
  })

  it('names the formats it declined to enforce', () => {
    expect([...new Set(validators.ignoredFormats)].sort()).toEqual(['date-time', 'uuid'])
  })

  it('still enforces the keywords that are not annotations', () => {
    expect(body?.({ ...(CONFORMING_ORDER as Record<string, Json>), status: 'dispatched' })).toHaveLength(1)
  })
})

describe('the strict dialect', () => {
  const validators = compileDocument('strict')
  const body = validators.responseBody('/orders/{orderId}', 'get', 200, 'application/json')

  it('accepts a conforming order', () => {
    expect(body?.(CONFORMING_ORDER)).toEqual([])
  })

  it('rejects an order carrying a field the document never declared, and names it', () => {
    const problems = body?.({ ...(CONFORMING_ORDER as Record<string, Json>), leaked: 'yes' }) ?? []

    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('leaked')
  })

  it('enforces a format', () => {
    const problems = body?.({ ...(CONFORMING_ORDER as Record<string, Json>), placedAt: '2026-03-01' }) ?? []

    expect(problems[0]?.at).toBe('/placedAt')
  })

  it('declines to enforce no formats at all', () => {
    expect(validators.ignoredFormats).toEqual([])
  })

  it('resolves a reference through an array into the component schemas', () => {
    // `items: { $ref: '#/components/schemas/OrderItem' }` only resolves because
    // the whole document is registered. Lift the response schema out and
    // compile it alone and this passes for the wrong reason.
    const problems = body?.({ ...(CONFORMING_ORDER as Record<string, Json>), items: [{ sku: null, quantity: 1 }] }) ?? []

    expect(problems[0]?.at).toBe('/items/0/sku')
  })
})

describe('looking up a position the document does not describe', () => {
  const validators = compileDocument('strict')

  it('returns null for a status that is not declared', () => {
    expect(validators.responseBody('/orders/{orderId}', 'get', 409, 'application/json')).toBeNull()
  })

  it('returns null for a media type that is not declared', () => {
    expect(validators.responseBody('/orders/{orderId}', 'get', 200, 'text/plain')).toBeNull()
  })

  it('returns null for a query parameter that is not declared', () => {
    expect(validators.parameter('/orders', 'get', 'settledOnly')).toBeNull()
  })

  it('finds a declared response header', () => {
    expect(validators.responseHeader('/orders', 'post', 201, 'Location')).not.toBeNull()
  })
})
