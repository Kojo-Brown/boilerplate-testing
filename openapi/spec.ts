/**
 * The OpenAPI 3.1 document this module is measured against, and the lookups a
 * conformance check needs to get from a live exchange back to the part of the
 * document that describes it.
 *
 * ---------------------------------------------------------------------------
 * Why the document is TypeScript and not YAML
 * ---------------------------------------------------------------------------
 * Every real service keeps its spec in a `.yaml` file, and this one deliberately
 * does not. The subject here is what a conformance check *catches*, and a YAML
 * file would put a parser between the reader and the thing being measured
 * without changing a single answer — the validators below see a JSON object
 * either way. Keeping it as a module means `spec.test.ts` can hold the document
 * to invariants (every operation declares a 200-family response, every `$ref`
 * resolves) at typecheck time as well as at run time, which a string of YAML
 * cannot be.
 *
 * If you are copying this pattern into a service that does ship YAML, the only
 * line that changes is where `SPEC` comes from: `parse(readFileSync(...))`
 * instead of a literal. Everything downstream takes the document as a value.
 *
 * ---------------------------------------------------------------------------
 * One deliberate omission in the document
 * ---------------------------------------------------------------------------
 * No schema here sets `additionalProperties: false`. That is not an oversight
 * and it is not laziness — it is what almost every hand-written OpenAPI
 * document looks like, because the keyword is easy to forget, unpleasant to
 * maintain, and actively wrong for a schema you intend to extend. The
 * consequence is the single most useful finding in `README.md`: a response
 * validator pointed at a spec written this way cannot see an undeclared field,
 * so the one drift that leaks data is the one it is structurally blind to.
 * `strategies.ts` has a wiring that closes the objects itself; the point of
 * leaving the document open is that the closing has to be a decision somebody
 * makes.
 */

/** JSON, as a value. Schemas, request bodies and response bodies are all this. */
export type Json = string | number | boolean | null | readonly Json[] | JsonObject

export type JsonObject = { readonly [key: string]: Json }

/**
 * Narrow a `Json` to an object.
 *
 * A hand-written guard rather than an inline
 * `typeof value === 'object' && !Array.isArray(value)`, because TypeScript's
 * `Array.isArray` narrowing does not subtract `readonly Json[]` from a union in
 * the *negative* branch. Written inline, the false branch stays
 * `readonly Json[] | JsonObject` and every property read after it is an
 * implicit `any` — which `noImplicitAny` catches here and would not catch in a
 * codebase with looser settings. One guard, used everywhere, is also the only
 * way the check reads the same at all fifteen call sites.
 */
export const isJsonObject = (value: Json | undefined): value is JsonObject =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)

/** Narrow a `Json` to an array. The mirror of `isJsonObject`, for symmetry at call sites. */
export const isJsonArray = (value: Json | undefined): value is readonly Json[] => Array.isArray(value)

/**
 * A JSON Schema, untyped beyond "it is a JSON object".
 *
 * Typing the keywords would be a large surface for no benefit: nothing in this
 * module reads a schema by hand. Ajv compiles them and `schema.ts` walks them
 * generically, and both of those are correct for keywords that did not exist
 * when this was written.
 */
export type JsonSchema = { readonly [keyword: string]: Json }

export const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

export type Method = (typeof METHODS)[number]

export interface MediaTypeSpec {
  readonly schema: JsonSchema
}

export interface ResponseHeaderSpec {
  readonly description: string
  readonly required: boolean
  readonly schema: JsonSchema
}

export interface ResponseSpec {
  readonly description: string
  readonly headers?: Readonly<Record<string, ResponseHeaderSpec>>
  readonly content?: Readonly<Record<string, MediaTypeSpec>>
}

export interface ParameterSpec {
  readonly name: string
  readonly in: 'path' | 'query' | 'header'
  readonly required: boolean
  readonly description: string
  readonly schema: JsonSchema
}

export interface RequestBodySpec {
  readonly required: boolean
  readonly content: Readonly<Record<string, MediaTypeSpec>>
}

export interface OperationSpec {
  readonly operationId: string
  readonly summary: string
  readonly parameters?: readonly ParameterSpec[]
  readonly requestBody?: RequestBodySpec
  readonly responses: Readonly<Record<string, ResponseSpec>>
}

export type PathItemSpec = Partial<Record<Method, OperationSpec>>

export interface Document {
  readonly openapi: string
  readonly info: { readonly title: string; readonly version: string }
  readonly paths: Readonly<Record<string, PathItemSpec>>
  readonly components: { readonly schemas: Readonly<Record<string, JsonSchema>> }
}

const ORDER_STATUS: JsonSchema = {
  type: 'string',
  description: 'Where the order is in its lifecycle.',
  // `refunded` is declared and no order in the store has it. That is ordinary —
  // every enum outlives the rows that use it — and it is what gives the
  // `empty-collection` drift a request that is entirely legal and returns
  // nothing. See README.md: a response validator can only judge the responses a
  // test actually provoked.
  enum: ['placed', 'shipped', 'cancelled', 'refunded'],
}

const MONEY: JsonSchema = {
  type: 'object',
  description: 'An amount in the minor unit of its currency, so 1299 GBP is £12.99.',
  required: ['amount', 'currency'],
  properties: {
    amount: { type: 'integer', minimum: 0 },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  },
}

const ORDER_ITEM: JsonSchema = {
  type: 'object',
  required: ['sku', 'quantity'],
  properties: {
    sku: { type: 'string', minLength: 1 },
    quantity: { type: 'integer', minimum: 1 },
  },
}

const ORDER: JsonSchema = {
  type: 'object',
  required: ['id', 'status', 'placedAt', 'total', 'items'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { $ref: '#/components/schemas/OrderStatus' },
    // `format: date-time` is the keyword the whole `format-violation` row of
    // the README turns on. Ajv treats an unknown format as an annotation and
    // ignores it unless `ajv-formats` is registered, so this line is enforced
    // by two of the six wirings and silently decorative in the other four.
    placedAt: { type: 'string', format: 'date-time' },
    total: { $ref: '#/components/schemas/Money' },
    items: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/OrderItem' } },
    // The one genuinely nullable field, spelled the 3.1 way — a type array,
    // not the 3.0 `nullable: true` keyword, which JSON Schema never had.
    note: { type: ['string', 'null'] },
  },
}

const NEW_ORDER: JsonSchema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/OrderItem' } },
    note: { type: ['string', 'null'] },
  },
}

const PROBLEM: JsonSchema = {
  type: 'object',
  description: 'RFC 9457 problem details, trimmed to the members this service sets.',
  required: ['title', 'status'],
  properties: {
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
  },
}

const ORDER_JSON: Readonly<Record<string, MediaTypeSpec>> = {
  'application/json': { schema: { $ref: '#/components/schemas/Order' } },
}

const PROBLEM_JSON: Readonly<Record<string, MediaTypeSpec>> = {
  'application/json': { schema: { $ref: '#/components/schemas/Problem' } },
}

const ORDER_ID_PARAM: ParameterSpec = {
  name: 'orderId',
  in: 'path',
  required: true,
  description: 'Identifier of the order.',
  schema: { type: 'string', format: 'uuid' },
}

export const SPEC: Document = {
  openapi: '3.1.0',
  info: { title: 'Orders', version: '1.0.0' },
  paths: {
    '/orders': {
      get: {
        operationId: 'listOrders',
        summary: 'List orders, optionally filtered by status.',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            description: 'Return only orders in this state.',
            schema: { $ref: '#/components/schemas/OrderStatus' },
          },
        ],
        responses: {
          '200': {
            description: 'The matching orders, oldest first.',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
              },
            },
          },
        },
      },
      post: {
        operationId: 'placeOrder',
        summary: 'Place an order.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } },
        },
        responses: {
          '201': {
            description: 'The order as placed.',
            headers: {
              Location: {
                description: 'Where the new order can be read.',
                required: true,
                schema: { type: 'string' },
              },
            },
            content: ORDER_JSON,
          },
          '400': { description: 'The body was not a valid order.', content: PROBLEM_JSON },
        },
      },
    },
    '/orders/{orderId}': {
      get: {
        operationId: 'getOrder',
        summary: 'Read one order.',
        parameters: [ORDER_ID_PARAM],
        responses: {
          '200': { description: 'The order.', content: ORDER_JSON },
          '404': { description: 'No such order.', content: PROBLEM_JSON },
        },
      },
      // The operation nothing exercises. It is declared, it is implemented, and
      // its implementation does not match this — see `coverage.ts` for what
      // that costs and which gate is the only one that notices.
      delete: {
        operationId: 'cancelOrder',
        summary: 'Cancel an order.',
        parameters: [ORDER_ID_PARAM],
        responses: {
          '200': { description: 'The order, now cancelled.', content: ORDER_JSON },
          '404': { description: 'No such order.', content: PROBLEM_JSON },
        },
      },
    },
  },
  components: {
    schemas: {
      Order: ORDER,
      OrderStatus: ORDER_STATUS,
      Money: MONEY,
      OrderItem: ORDER_ITEM,
      NewOrder: NEW_ORDER,
      Problem: PROBLEM,
    },
  },
}

/** A path template and the operation under it, as resolved for a live request. */
export interface ResolvedOperation {
  /** The templated path, e.g. `/orders/{orderId}`. */
  readonly pathTemplate: string
  readonly method: Method
  readonly operation: OperationSpec
  /** Path parameters, read out of the concrete URL. */
  readonly pathParams: Readonly<Record<string, string>>
}

const TEMPLATE_SEGMENT = /^\{(?<name>[^}]+)\}$/

/**
 * Match a concrete path against one path template.
 *
 * Segment-wise rather than by regular expression, because the regular
 * expression version of this is where path matchers acquire their bugs: a
 * template compiled to `^/orders/(.+)$` matches `/orders/a/b`, and a
 * conformance check that resolves the wrong operation reports drift against a
 * schema that was never supposed to describe the response.
 */
function matchTemplate(pathTemplate: string, path: string): Readonly<Record<string, string>> | null {
  const templateSegments = pathTemplate.split('/')
  const pathSegments = path.split('/')

  if (templateSegments.length !== pathSegments.length) return null

  const params: Record<string, string> = {}

  for (const [index, segment] of templateSegments.entries()) {
    const actual = pathSegments[index] ?? ''
    const templated = TEMPLATE_SEGMENT.exec(segment)

    if (templated?.groups?.['name'] !== undefined) {
      // An empty segment is not a path parameter value: `/orders/` must not
      // resolve to `getOrder` with an empty id.
      if (actual === '') return null

      params[templated.groups['name']] = decodeURIComponent(actual)
      continue
    }

    if (segment !== actual) return null
  }

  return params
}

/**
 * The operation describing a live request, or `null` if the document has none.
 *
 * Concrete paths beat templated ones when both match, which is the rule
 * OpenAPI states and the one every router implements: `/orders/summary` is the
 * summary endpoint, not an order whose id happens to be "summary".
 */
export function resolveOperation(
  method: string,
  path: string,
  document: Document = SPEC,
): ResolvedOperation | null {
  const lowered = method.toLowerCase()

  if (!(METHODS as readonly string[]).includes(lowered)) return null

  const candidates = Object.entries(document.paths)
    .map(([pathTemplate, item]) => ({ pathTemplate, item, pathParams: matchTemplate(pathTemplate, path) }))
    .filter((candidate) => candidate.pathParams !== null)
    .sort((left, right) => Number(left.pathTemplate.includes('{')) - Number(right.pathTemplate.includes('{')))

  for (const candidate of candidates) {
    const operation = candidate.item[lowered as Method]

    if (operation !== undefined) {
      return {
        pathTemplate: candidate.pathTemplate,
        method: lowered as Method,
        operation,
        pathParams: candidate.pathParams ?? {},
      }
    }
  }

  return null
}

/**
 * The response the document declares for a status code.
 *
 * Exact codes only. OpenAPI also allows `2XX` wildcards and a `default`
 * fallback, and this document uses neither, so supporting them here would be
 * code no test in this repository can reach — see README.md, "What this
 * module does not measure".
 */
export function responseFor(operation: OperationSpec, status: number): ResponseSpec | null {
  return operation.responses[String(status)] ?? null
}

/** Every `(path, method, status)` triple the document declares. */
export function declaredResponses(document: Document = SPEC): readonly string[] {
  return Object.entries(document.paths).flatMap(([pathTemplate, item]) =>
    METHODS.flatMap((method) => {
      const operation = item[method]

      return operation === undefined
        ? []
        : Object.keys(operation.responses).map((status) => `${method.toUpperCase()} ${pathTemplate} ${status}`)
    }),
  )
}
