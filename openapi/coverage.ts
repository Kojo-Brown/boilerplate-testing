/**
 * The gate none of the six wirings is: which of the document's operations and
 * responses anything ever produced.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a seventh column
 * ---------------------------------------------------------------------------
 * Every wiring in `strategies.ts` is a function of one exchange. Coverage is a
 * function of the *set* of exchanges, and the difference is not bookkeeping: a
 * per-exchange check can only ever answer "was this response right", and the
 * response that is most often wrong is the one no test provoked. Put coverage
 * in the matrix as a column and eleven of its twelve cells would be the same
 * meaningless value.
 *
 * `DELETE /orders/{orderId}` is the demonstration. It is declared in `spec.ts`,
 * implemented in `service.ts`, and its implementation returns
 * `{ "cancelled": true }` where the document promises an `Order` — every
 * required property absent, one undeclared property present. Five of the six
 * wirings would report it in a millisecond, and the sixth — `status-only` — is
 * quiet only because the status is the one thing about that response that is
 * correct. All six score a clean sheet on it, because the corpus never sends it
 * a request, and a check that is never run catches nothing.
 *
 * ---------------------------------------------------------------------------
 * What to gate on
 * ---------------------------------------------------------------------------
 * Operation coverage — every `(method, path)` was exercised at least once — is
 * a floor worth failing a build on, and this module's is at 100% only because
 * `coverage.test.ts` sends the request the matrix does not.
 *
 * Response coverage — every declared `(method, path, status)` was observed — is
 * the more useful number and the wrong thing to gate on at 100%. A document
 * that declares a 503 for a dependency outage is describing something a test
 * suite can only reach by faking the outage, and a team held to 100% here
 * deletes the 503 from the document. That is a gate making the spec worse.
 * Report it, read it, and gate on the operations.
 */

import type { Exchange } from './exchange.ts'
import { declaredResponses, resolveOperation, SPEC, type Document } from './spec.ts'

/** A `(method, path)` or `(method, path, status)` key, spelled the way the report prints it. */
export type CoverageKey = string

export interface Coverage {
  /** Every `METHOD /path` the document declares. */
  readonly operations: readonly CoverageKey[]
  /** Those of them no exchange exercised. */
  readonly untouchedOperations: readonly CoverageKey[]
  /** Every `METHOD /path <status>` the document declares. */
  readonly responses: readonly CoverageKey[]
  /** Those of them no exchange produced. */
  readonly unobservedResponses: readonly CoverageKey[]
}

/**
 * What a set of exchanges covered.
 *
 * An exchange whose request resolves to no operation in the document covers
 * nothing — deliberately. Counting it would let a request to a path the
 * document has never heard of improve the coverage of the paths it has.
 */
export function coverageOf(exchanges: readonly Exchange[], document: Document = SPEC): Coverage {
  const touchedOperations = new Set<CoverageKey>()
  const observedResponses = new Set<CoverageKey>()

  for (const exchange of exchanges) {
    const resolved = resolveOperation(exchange.request.method, exchange.request.path, document)

    if (resolved === null) continue

    const operation = `${resolved.method.toUpperCase()} ${resolved.pathTemplate}`

    touchedOperations.add(operation)
    observedResponses.add(`${operation} ${exchange.response.status}`)
  }

  const responses = declaredResponses(document)
  const operations = [...new Set(responses.map((key) => key.split(' ').slice(0, 2).join(' ')))]

  return {
    operations,
    untouchedOperations: operations.filter((key) => !touchedOperations.has(key)),
    responses,
    unobservedResponses: responses.filter((key) => !observedResponses.has(key)),
  }
}

/** Covered out of declared, as a percentage rounded to one place. */
export const percentage = (covered: number, declared: number): number =>
  declared === 0 ? 100 : Math.round((covered / declared) * 1000) / 10
