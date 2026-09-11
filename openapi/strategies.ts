/**
 * The six wirings. Each one is a complete answer to "we have schema-conformance
 * tests", and they are ordered by how much of an exchange they look at.
 *
 * ---------------------------------------------------------------------------
 * What a strategy is
 * ---------------------------------------------------------------------------
 * A pure function from a captured exchange to a list of findings. Empty means
 * the wiring was satisfied. Pure, because the expensive part — a real request
 * over a real socket — happens once in `exchange.ts` and every wiring then
 * judges the same bytes. Six wirings each making their own request would be
 * comparing six responses, and the first time one of them was flaky the table
 * would be measuring the flake.
 *
 * ---------------------------------------------------------------------------
 * The rule that decides almost every cell
 * ---------------------------------------------------------------------------
 * **A validator that cannot find a schema does not fail. It says nothing.**
 *
 * This is not a strawman written to lose. It is what every response-validation
 * middleware does, and it is defensible in isolation: the document does not
 * describe a 409 on this operation, so there is no schema, so there is nothing
 * to validate against, so the check passes. Each step is reasonable and the
 * conclusion is that the wiring is loudest about the responses you already
 * documented and silent about the ones you did not — which is backwards,
 * because an undocumented response is the drift.
 *
 * `body-schema` and `body-schema-strict` behave that way. `full-response` is
 * the same validator plus three lines that turn "no schema here" into a
 * finding, and those three lines are worth more than the dialect upgrade below
 * them: they are what moves `undeclared-status`, `wrong-content-type` and
 * `missing-header` from miss to catch.
 */

import type { Exchange } from './exchange.ts'
import { compileDocument, type Validators } from './schema.ts'
import { isJsonArray, isJsonObject, resolveOperation, type Json } from './spec.ts'

export interface Finding {
  /** Which check fired. Coarse on purpose: this is for reading a table, not a log. */
  readonly code:
    | 'status'
    | 'body'
    | 'undeclared-status'
    | 'undeclared-content-type'
    | 'header'
    | 'request'
    | 'unknown-operation'
  readonly message: string
}

export interface Strategy {
  readonly key: string
  /** One line, audited against README.md. */
  readonly blurb: string
  check(exchange: Exchange, lenient: Validators, strict: Validators): readonly Finding[]
}

/** `application/json; charset=utf-8` → `application/json`. */
export const baseMediaType = (contentType: string | undefined): string =>
  (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

/** Headers as Node gives them: lower-cased. The document spells them however it likes. */
const headerValue = (exchange: Exchange, name: string): string | undefined =>
  exchange.response.headers[name.toLowerCase()]

/**
 * `status-only` — the baseline every suite already has.
 *
 * `await agent.get(path).expect(200)` and nothing else. It is in the table
 * because it is not nothing: it is the only wiring below `full-response` that
 * notices a status code the handler invented, and it costs a line. A team
 * arguing about whether to adopt response validation should know that the
 * cheapest thing they already own covers one of the eleven rows.
 */
const statusOnly: Strategy = {
  key: 'status-only',
  blurb: 'The status code the test expected, and nothing else.',
  check: (exchange) =>
    exchange.response.status === exchange.expectedStatus
      ? []
      : [
          {
            code: 'status',
            message: `expected ${exchange.expectedStatus}, got ${exchange.response.status}`,
          },
        ],
}

/**
 * The fields a consumer of this API actually reads.
 *
 * Three, which is realistic: a client renders the id, branches on the status
 * and formats the total. `placedAt`, `items` and `note` are passed through or
 * ignored, so no hand-written test asserts on them, so drift in them is
 * invisible — which is the finding, and the reason the `handwritten` row is
 * shaped the way it is rather than being a uniformly weaker `body-schema`.
 */
const HANDLED_STATUSES = ['placed', 'shipped', 'cancelled']

function assertByHand(value: Json, where: string): readonly Finding[] {
  if (!isJsonObject(value)) {
    return [{ code: 'body', message: `${where} is not an order object` }]
  }

  const findings: Finding[] = []
  const total = value['total']
  const status = value['status']

  if (typeof value['id'] !== 'string') findings.push({ code: 'body', message: `${where}.id is not a string` })

  if (typeof status !== 'string' || !HANDLED_STATUSES.includes(status)) {
    findings.push({ code: 'body', message: `${where}.status is not a state the client handles` })
  }

  if (!isJsonObject(total) || typeof total['amount'] !== 'number') {
    findings.push({ code: 'body', message: `${where}.total.amount is not a number` })
  }

  return findings
}

const handwritten: Strategy = {
  key: 'handwritten',
  blurb: 'Assertions on the three fields the client reads, written by hand.',
  check: (exchange) => {
    // Hand-written assertions are written for the happy path and are only run
    // on it. A test that asserted an order's shape against a 404 body would be
    // a broken test, not a conformance check, so the wiring skips anything that
    // is not the response the test was written for.
    if (exchange.response.status !== exchange.expectedStatus) return []

    const body = exchange.response.body

    if (body === undefined) return [{ code: 'body', message: 'the body did not parse as JSON' }]

    return isJsonArray(body)
      ? body.flatMap((item, index) => assertByHand(item, `[${index}]`))
      : assertByHand(body, 'body')
  },
}

/** The shared body-validation core of the four schema-driven wirings. */
function validateBody(exchange: Exchange, validators: Validators): readonly Finding[] {
  const resolved = resolveOperation(exchange.request.method, exchange.request.path, validators.document)

  if (resolved === null) return [{ code: 'unknown-operation', message: 'the document describes no such operation' }]

  const mediaType = baseMediaType(headerValue(exchange, 'content-type'))
  const validate = validators.responseBody(resolved.pathTemplate, resolved.method, exchange.response.status, mediaType)

  // The rule from the file header, in one line. Nothing to validate against is
  // not a failure here — `declaredResponse` is what makes it one.
  if (validate === null) return []

  const body = exchange.response.body

  if (body === undefined) return [{ code: 'body', message: 'the body did not parse as JSON' }]

  return validate(body).map((problem) => ({
    code: 'body' as const,
    message: `body${problem.at} ${problem.message}`,
  }))
}

const bodySchema: Strategy = {
  key: 'body-schema',
  blurb: 'The body against the schema for the status it came back with, as written.',
  check: (exchange, lenient) => validateBody(exchange, lenient),
}

const bodySchemaStrict: Strategy = {
  key: 'body-schema-strict',
  blurb: 'The same, with formats asserted and objects closed by the validator.',
  check: (exchange, _lenient, strict) => validateBody(exchange, strict),
}

/** Status, media type and required headers — the parts of a response that are not the body. */
function validateEnvelope(exchange: Exchange, validators: Validators): readonly Finding[] {
  const resolved = resolveOperation(exchange.request.method, exchange.request.path, validators.document)

  if (resolved === null) return [{ code: 'unknown-operation', message: 'the document describes no such operation' }]

  const response = resolved.operation.responses[String(exchange.response.status)]

  if (response === undefined) {
    return [
      {
        code: 'undeclared-status',
        message:
          `${exchange.response.status} is not declared on ${resolved.method.toUpperCase()} ${resolved.pathTemplate} ` +
          `(declared: ${Object.keys(resolved.operation.responses).join(', ')})`,
      },
    ]
  }

  const findings: Finding[] = []
  const mediaType = baseMediaType(headerValue(exchange, 'content-type'))
  const declaredTypes = Object.keys(response.content ?? {})

  if (declaredTypes.length > 0 && !declaredTypes.includes(mediaType)) {
    findings.push({
      code: 'undeclared-content-type',
      message: `content-type ${mediaType || '(absent)'} is not one of ${declaredTypes.join(', ')}`,
    })
  }

  for (const [name, header] of Object.entries(response.headers ?? {})) {
    const value = headerValue(exchange, name)

    if (value === undefined) {
      if (header.required) findings.push({ code: 'header', message: `required response header ${name} is absent` })
      continue
    }

    const validate = validators.responseHeader(resolved.pathTemplate, resolved.method, exchange.response.status, name)
    const problems = validate === null ? [] : validate(value)

    findings.push(
      ...problems.map((problem) => ({ code: 'header' as const, message: `header ${name} ${problem.message}` })),
    )
  }

  return findings
}

const fullResponse: Strategy = {
  key: 'full-response',
  blurb: 'Body, plus the status, media type and required headers the document declares.',
  check: (exchange, _lenient, strict) => {
    const envelope = validateEnvelope(exchange, strict)

    // An undeclared status means there is no response object to read a schema
    // out of. Reporting that once is the finding; also reporting "and the body
    // did not match a schema that does not exist" is noise.
    return envelope.some((finding) => finding.code === 'undeclared-status')
      ? envelope
      : [...envelope, ...validateBody(exchange, strict)]
  },
}

/** The request, against the operation the document declares for it. */
function validateRequest(exchange: Exchange, validators: Validators): readonly Finding[] {
  const resolved = resolveOperation(exchange.request.method, exchange.request.path, validators.document)

  if (resolved === null) return [{ code: 'unknown-operation', message: 'the document describes no such operation' }]

  const findings: Finding[] = []
  const parameters = resolved.operation.parameters ?? []
  const declaredQuery = parameters.filter((parameter) => parameter.in === 'query')

  for (const [name, value] of Object.entries(exchange.request.query)) {
    const declared = declaredQuery.find((parameter) => parameter.name === name)

    if (declared === undefined) {
      findings.push({
        code: 'request',
        message:
          `query parameter ${name} is not declared on ${resolved.method.toUpperCase()} ${resolved.pathTemplate} ` +
          `(declared: ${declaredQuery.map((parameter) => parameter.name).join(', ') || 'none'})`,
      })
      continue
    }

    const validate = validators.parameter(resolved.pathTemplate, resolved.method, name)

    findings.push(
      ...(validate === null ? [] : validate(value)).map((problem) => ({
        code: 'request' as const,
        message: `query parameter ${name} ${problem.message}`,
      })),
    )
  }

  for (const parameter of parameters) {
    if (!parameter.required) continue

    const present =
      parameter.in === 'path'
        ? resolved.pathParams[parameter.name] !== undefined
        : parameter.in === 'query'
          ? exchange.request.query[parameter.name] !== undefined
          : exchange.request.headers[parameter.name.toLowerCase()] !== undefined

    if (!present) findings.push({ code: 'request', message: `required ${parameter.in} parameter ${parameter.name} is absent` })
  }

  const requestBody = resolved.operation.requestBody

  if (requestBody !== undefined) {
    const mediaType = baseMediaType(exchange.request.headers['content-type'])

    if (exchange.request.body === undefined) {
      if (requestBody.required) findings.push({ code: 'request', message: 'a request body is required and none was sent' })
    } else {
      const validate = validators.requestBody(resolved.pathTemplate, resolved.method, mediaType)

      if (validate === null) {
        findings.push({
          code: 'request',
          message: `request media type ${mediaType || '(absent)'} is not one of ${Object.keys(requestBody.content).join(', ')}`,
        })
      } else {
        findings.push(
          ...validate(exchange.request.body).map((problem) => ({
            code: 'request' as const,
            message: `request body${problem.at} ${problem.message}`,
          })),
        )
      }
    }
  }

  return findings
}

const requestAndResponse: Strategy = {
  key: 'request-and-response',
  blurb: 'Everything above, and the request the test sent, against the same document.',
  check: (exchange, lenient, strict) => [
    ...validateRequest(exchange, strict),
    ...fullResponse.check(exchange, lenient, strict),
  ],
}

export const STRATEGIES: readonly Strategy[] = [
  statusOnly,
  handwritten,
  bodySchema,
  bodySchemaStrict,
  fullResponse,
  requestAndResponse,
]

/** Look one strategy up by key, for tests that name a column. */
export function strategyFor(key: string): Strategy {
  const strategy = STRATEGIES.find((candidate) => candidate.key === key)

  if (strategy === undefined) throw new Error(`No strategy named ${key}`)

  return strategy
}

/** Both dialects, compiled once. Compiling is the expensive part; judging is not. */
export interface Wiring {
  readonly lenient: Validators
  readonly strict: Validators
}

export const compileWiring = (): Wiring => ({
  lenient: compileDocument('lenient'),
  strict: compileDocument('strict'),
})
