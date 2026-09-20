/**
 * Turning what the page saw into the word that goes in a cell.
 *
 * Kept apart from both the specs and the matrix for one reason: this is where
 * a measurement could flatter itself. "The response arrived" is not the same
 * claim as "the response is the one the origin would send today", and a
 * classifier that collapsed the two would make every HAR wiring look perfect —
 * which is exactly the reading this directory exists to argue against.
 *
 * So the rules are written once, here, as functions over data, and
 * `outcomes.test.ts` puts the awkward cases to them directly: a 503 that was
 * answered, a body with no stamp, a schema from the future, an echo of a word
 * nobody sent.
 */

import type { FetchOutcome, RetryOutcome } from './client.ts'
import { CURRENT_SCHEMA } from './origin.ts'

/** The `source` stamp on a JSON body, or `null` when there is not one. */
export function sourceOf(body: unknown): 'origin' | 'stub' | null {
  if (typeof body !== 'object' || body === null || !('source' in body)) {
    return null
  }

  const source = (body as { source: unknown }).source

  return source === 'origin' || source === 'stub' ? source : null
}

/** The `schema` field of a feed body, or `null` when it carries none. */
export function schemaOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('schema' in body)) {
    return null
  }

  const schema = (body as { schema: unknown }).schema

  return typeof schema === 'number' ? schema : null
}

/**
 * The plain case: a GET that either answered or did not.
 *
 * A non-2xx counts as `failed`. That is a judgement rather than an obvious
 * mapping, and it is the conservative one — a 404 from an origin and an
 * aborted request are different events, but no wiring here produces the first,
 * so distinguishing them would add a word to the vocabulary that no cell could
 * ever hold.
 */
export function classifyFetch(outcome: FetchOutcome): 'origin' | 'stub' | 'failed' {
  if (outcome.failed || outcome.status < 200 || outcome.status >= 300) {
    return 'failed'
  }

  return sourceOf(outcome.body) === 'stub' ? 'stub' : 'origin'
}

/**
 * The drift case: the same rules, plus the one question the stamp cannot
 * answer on its own.
 *
 * A body stamped `origin` whose schema is older than the one the origin serves
 * today did come from the origin — a while ago. `stale` is the only cell value
 * in this directory that describes a *successful* response as a problem, and
 * it is the one a suite reading the recording would never see.
 */
export function classifyDrift(outcome: FetchOutcome): 'origin' | 'stale' | 'stub' | 'failed' {
  const plain = classifyFetch(outcome)

  if (plain !== 'origin') {
    return plain
  }

  const schema = schemaOf(outcome.body)

  return schema !== null && schema < CURRENT_SCHEMA ? 'stale' : 'origin'
}

/** The `echoed` field of an echo body, or `null` when it carries none. */
export function echoedWord(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('echoed' in body)) {
    return null
  }

  const echoed = (body as { echoed: unknown }).echoed

  return typeof echoed === 'string' ? echoed : null
}

/**
 * The echo case: whose word came back.
 *
 * `sent` and `recorded` are passed in rather than imported so the rule is
 * stated in terms of the two words the caller actually used — a classifier
 * that knew the constants would still agree with itself after somebody changed
 * one of them in the spec and not in the recording.
 */
export function classifyEcho(
  outcome: FetchOutcome,
  words: { sent: string; recorded: string },
): 'echoes-sent' | 'echoes-recorded' | 'stub' | 'failed' {
  const plain = classifyFetch(outcome)

  if (plain !== 'origin') {
    return plain
  }

  const echoed = echoedWord(outcome.body)

  if (echoed === words.sent.toUpperCase()) {
    return 'echoes-sent'
  }

  if (echoed === words.recorded.toUpperCase()) {
    return 'echoes-recorded'
  }

  return 'failed'
}

/**
 * The retry case, which is about the attempt count rather than the body.
 *
 * `first-try` is not a success and not a failure. It is the answer that says
 * the client's retry branch was never entered, which is a fact about the fake
 * and is invisible to every assertion anybody writes about the response.
 */
export function classifyRetry(outcome: RetryOutcome): 'recovered' | 'first-try' | 'failed' {
  if (outcome.failed || outcome.status < 200 || outcome.status >= 300) {
    return 'failed'
  }

  return outcome.attempts > 1 ? 'recovered' : 'first-try'
}

/** The colour the fixture stylesheet sets when it arrives. */
export const STYLED_COLOUR = 'rgb(17, 17, 17)'

/** Whether the document's stylesheet reached the page. */
export const classifyStylesheet = (colour: string): 'origin' | 'failed' =>
  colour === STYLED_COLOUR ? 'origin' : 'failed'

/** Whether a path appears in the origin's ledger. */
export const classifyReach = (log: readonly string[], path: string): 'reached' | 'not-reached' =>
  log.some((entry) => entry === `GET ${path}`) ? 'reached' : 'not-reached'
