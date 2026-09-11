/**
 * Turning an OpenAPI document into compiled validators, in the two dialects the
 * matrix compares.
 *
 * ---------------------------------------------------------------------------
 * Why the whole document is registered, rather than each schema compiled
 * ---------------------------------------------------------------------------
 * A response schema in `spec.ts` is `{ $ref: '#/components/schemas/Order' }`,
 * and `#/` means "the root of the document this schema came from". Lift that
 * object out and compile it on its own and the reference resolves against
 * *itself*, which is either an error or — worse, and this is the bug worth
 * naming — a silently empty schema that accepts everything. Every response then
 * conforms, the suite is green, and the conformance check has been switched off
 * without anybody editing it.
 *
 * So the document is added to Ajv once, under a base URI, and every validator
 * is fetched by JSON pointer *into* it (`getSchema('…#/paths/~1orders/…')`).
 * References resolve the way the document meant them to, and there is one place
 * where a pointer can be wrong instead of one per call site.
 *
 * ---------------------------------------------------------------------------
 * The two dialects
 * ---------------------------------------------------------------------------
 * `lenient` is Ajv as an off-the-shelf response validator configures it: the
 * document's schemas exactly as written, and no format assertions. Not a straw
 * man — it is Ajv's documented default, because JSON Schema classifies `format`
 * as an annotation, so a validator that ignores it is *correct*. It is also why
 * `format: date-time` in a spec is, by default, a comment.
 *
 * `strict` makes both of the decisions the lenient dialect leaves open:
 * `ajv-formats` is registered, so `format` asserts, and every object schema
 * that lists `properties` and says nothing about the rest is closed. Two of the
 * corpus's eleven drifts are invisible without that and visible with it.
 *
 * The cost of `strict` is real and stated here rather than buried: closing
 * objects the document left open means the validator is no longer checking the
 * document, it is checking the document plus an assumption. For a service whose
 * clients must tolerate added fields — which is most of them — that assumption
 * is wrong in the direction that fails a build on a backwards-compatible
 * change. The honest fix is `additionalProperties: false` in the document,
 * where it is a decision somebody made. Injecting it in the validator is what
 * you do while you are getting there.
 */

import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'

import { isJsonArray, isJsonObject, SPEC, type Document, type Json, type Method } from './spec.ts'

/**
 * Not a reachable URL, and deliberately so — `.invalid` is reserved by RFC 2606
 * exactly so that a resolver which decides to fetch a `$id` cannot reach
 * anything. Ajv never fetches; the guarantee is for whoever copies this next.
 */
export const BASE_ID = 'https://openapi-conformance.invalid/spec.json'

export type Dialect = 'lenient' | 'strict'

/** Ajv's own wording, which is the only place the fact is reported. */
const IGNORED_FORMAT = /unknown format "(?<format>[^"]+)" ignored/

/** JSON Pointer escaping: `~` before `/`, or the escapes eat each other. */
const pointerToken = (token: string): string => token.replaceAll('~', '~0').replaceAll('/', '~1')

const pointer = (...tokens: readonly string[]): string => `${BASE_ID}#/${tokens.map(pointerToken).join('/')}`

/** Keywords whose value is itself a schema. */
const SCHEMA_VALUED = ['items', 'not', 'if', 'then', 'else', 'contains', 'propertyNames'] as const

/** Keywords whose value is a map of name → schema. */
const SCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions'] as const

/** Keywords whose value is a list of schemas. */
const SCHEMA_LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const

/**
 * Close every object schema that lists its properties and says nothing about
 * the others.
 *
 * Two guards, both learned the hard way by everybody who writes this function:
 *
 *   - A schema that already constrains extra properties — `additionalProperties`,
 *     `unevaluatedProperties` or `patternProperties` — is left exactly as it is.
 *     Overwriting `additionalProperties: { type: 'string' }` with `false` is not
 *     "stricter", it is a different schema.
 *   - Subschemas of `allOf`, `anyOf` and `oneOf` are recursed into but never
 *     closed, because closing them is the classic JSON Schema trap:
 *     `additionalProperties` cannot see properties declared in a *sibling*
 *     branch, so closing both halves of an `allOf` produces a schema that
 *     nothing can satisfy. `spec.ts` uses no combinators today; this function
 *     is written so that adding one does not quietly produce a validator that
 *     rejects every response.
 */
export function closeObjects(schema: Json, insideCombinator = false): Json {
  if (isJsonArray(schema)) return schema.map((entry) => closeObjects(entry, insideCombinator))
  if (!isJsonObject(schema)) return schema

  const rewritten: Record<string, Json> = { ...schema }

  for (const keyword of SCHEMA_VALUED) {
    if (keyword in rewritten) rewritten[keyword] = closeObjects(rewritten[keyword] ?? null, false)
  }

  for (const keyword of SCHEMA_MAPS) {
    const map = rewritten[keyword]

    if (isJsonObject(map)) {
      rewritten[keyword] = Object.fromEntries(
        Object.entries(map).map(([name, value]) => [name, closeObjects(value ?? null, false)]),
      )
    }
  }

  for (const keyword of SCHEMA_LISTS) {
    const list = rewritten[keyword]

    if (isJsonArray(list)) rewritten[keyword] = list.map((entry) => closeObjects(entry, true))
  }

  if (isJsonObject(rewritten['additionalProperties'])) {
    rewritten['additionalProperties'] = closeObjects(rewritten['additionalProperties'] ?? null, false)
  }

  const constrained =
    'additionalProperties' in rewritten ||
    'unevaluatedProperties' in rewritten ||
    'patternProperties' in rewritten

  if (!insideCombinator && isJsonObject(rewritten['properties']) && !constrained) {
    rewritten['additionalProperties'] = false
  }

  return rewritten
}

/** A document as plain JSON — what Ajv is actually handed. */
export type JsonDocument = { readonly [key: string]: Json }

const asJsonDocument = (document: Document): JsonDocument =>
  JSON.parse(JSON.stringify(document)) as JsonDocument

/**
 * Every position in a document that holds a JSON Schema, as a path of keys.
 *
 * Found rather than enumerated. A hand-written list of the five places OpenAPI
 * 3.1 puts a schema is correct today and silently incomplete the first time
 * somebody adds a `callbacks` block — and "silently incomplete" here means the
 * strict dialect stops being strict about part of the document while still
 * reporting itself as strict, which is the failure mode this whole module is
 * about.
 *
 * The walk is: `components.schemas.<name>`, and any value under a key literally
 * named `schema`. It does **not** descend into a position it has already
 * identified, so a schema with a property of its own called `schema` is data,
 * not another position. That guard is the entire subtlety here.
 */
export function schemaPositions(document: Document = SPEC): readonly (readonly string[])[] {
  const found: (readonly string[])[] = []

  const walk = (node: Json, path: readonly string[]): void => {
    if (isJsonArray(node)) {
      node.forEach((entry, index) => walk(entry, [...path, String(index)]))
      return
    }

    if (!isJsonObject(node)) return

    for (const [key, value] of Object.entries(node)) {
      const here = [...path, key]
      const isSchema =
        (key === 'schema' && isJsonObject(value)) ||
        (path.length === 2 && path[0] === 'components' && path[1] === 'schemas' && isJsonObject(value))

      if (isSchema) {
        found.push(here)
        continue
      }

      walk(value, here)
    }
  }

  walk(asJsonDocument(document), [])

  return found
}

function editAt(root: Record<string, Json>, path: readonly string[], edit: (schema: Json) => Json): void {
  const parents = path.slice(0, -1)
  const leaf = path.at(-1)

  if (leaf === undefined) return

  let node: Record<string, Json> = root

  for (const key of parents) {
    const next = node[key]

    // Mutating a freshly-parsed clone, so both objects and arrays are plain
    // mutable records here; the index type is the only thing that differs and
    // JSON Pointer does not distinguish them either.
    if (!isJsonObject(next) && !isJsonArray(next)) return

    node = next as Record<string, Json>
  }

  node[leaf] = edit(node[leaf] ?? null)
}

/**
 * A copy of the document with every schema position rewritten and nothing else.
 *
 * The copy is a JSON round-trip rather than a typed rebuild, because the result
 * is only ever handed to Ajv. Keeping it `Document`-shaped would buy a type
 * check on a value nothing reads through the type, at the cost of a page of
 * optional-property gymnastics that could itself drop a field.
 */
export function mapSchemas(document: Document, edit: (schema: Json) => Json): JsonDocument {
  const copy = asJsonDocument(document) as Record<string, Json>

  for (const path of schemaPositions(document)) editAt(copy, path, edit)

  return copy
}

/** One validation failure, flattened out of Ajv's error objects. */
export interface SchemaProblem {
  /** JSON Pointer into the instance, e.g. `/total/amount`. `''` for the root. */
  readonly at: string
  readonly message: string
}

const describe = (error: ErrorObject): SchemaProblem => {
  const extra =
    error.keyword === 'additionalProperties' && typeof error.params['additionalProperty'] === 'string'
      ? ` (${error.params['additionalProperty']})`
      : ''

  return { at: error.instancePath, message: `${error.message ?? 'is invalid'}${extra}` }
}

/**
 * Compiled validators for one document in one dialect.
 *
 * Every lookup returns `null` when the document does not describe that position
 * — no schema for this status, no schema for this media type — and every caller
 * has to decide what that means. That is deliberate: "the document says nothing
 * here" and "the document says this and the response disagrees" are different
 * findings, and a validator that conflated them would make `undeclared-status`
 * unreportable.
 */
export interface Validators {
  readonly dialect: Dialect
  readonly document: Document
  /**
   * Formats Ajv declined to enforce while compiling, in the order it met them.
   *
   * Ajv does not fail on `format: date-time` with no format package
   * registered — it logs `unknown format "date-time" ignored` and carries on,
   * because an unenforced format is a legal reading of the specification. That
   * line is the only warning anybody gets that a keyword in their document is
   * decorative, and it goes to stderr in the middle of an install log.
   *
   * Collecting it here does two things: it keeps the lenient dialect from
   * printing four lines of noise on every compile, and it turns "this wiring
   * silently ignores your formats" into a value a test can assert on. See
   * `schema.test.ts`.
   */
  readonly ignoredFormats: readonly string[]
  /** Validate a value, or `null` if the document describes no schema at that position. */
  responseBody(pathTemplate: string, method: Method, status: number, mediaType: string): Validator | null
  requestBody(pathTemplate: string, method: Method, mediaType: string): Validator | null
  parameter(pathTemplate: string, method: Method, name: string): Validator | null
  responseHeader(pathTemplate: string, method: Method, status: number, name: string): Validator | null
}

export type Validator = (value: Json) => readonly SchemaProblem[]

function wrap(compiled: ValidateFunction | undefined): Validator | null {
  if (compiled === undefined) return null

  return (value: Json) => (compiled(value) ? [] : (compiled.errors ?? []).map(describe))
}

/**
 * Compile a document.
 *
 * `strict: false` on the Ajv instance is not the same axis as the `dialect`
 * argument and the collision of names is unfortunate enough to spell out.
 * Ajv's `strict` mode polices the *schema* — it throws on keywords it does not
 * recognise — and an OpenAPI document is full of those (`paths`, `responses`,
 * `operationId`), so it has to be off or nothing compiles at all. `dialect` is
 * about how the compiled validators treat the *instance*.
 */
export function compileDocument(dialect: Dialect, document: Document = SPEC): Validators {
  const prepared = dialect === 'strict' ? mapSchemas(document, (schema) => closeObjects(schema)) : asJsonDocument(document)
  const ignoredFormats: string[] = []
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    logger: {
      log: () => {},
      warn: (...args: readonly unknown[]) => {
        const ignored = IGNORED_FORMAT.exec(args.map(String).join(' '))

        if (ignored?.groups?.['format'] !== undefined) ignoredFormats.push(ignored.groups['format'])
      },
      error: (...args: readonly unknown[]) => {
        throw new Error(`Ajv reported an error while compiling the document: ${args.map(String).join(' ')}`)
      },
    },
  })

  if (dialect === 'strict') addFormats(ajv)

  ajv.addSchema({ ...prepared, $id: BASE_ID })

  const at = (...tokens: readonly string[]): Validator | null => wrap(ajv.getSchema(pointer(...tokens)))

  return {
    dialect,
    document,
    ignoredFormats,
    responseBody: (pathTemplate, method, status, mediaType) =>
      at('paths', pathTemplate, method, 'responses', String(status), 'content', mediaType, 'schema'),
    requestBody: (pathTemplate, method, mediaType) =>
      at('paths', pathTemplate, method, 'requestBody', 'content', mediaType, 'schema'),
    parameter: (pathTemplate, method, name) => {
      const parameters = document.paths[pathTemplate]?.[method]?.parameters ?? []
      const index = parameters.findIndex((parameter) => parameter.name === name)

      return index === -1 ? null : at('paths', pathTemplate, method, 'parameters', String(index), 'schema')
    },
    responseHeader: (pathTemplate, method, status, name) =>
      at('paths', pathTemplate, method, 'responses', String(status), 'headers', name, 'schema'),
  }
}
