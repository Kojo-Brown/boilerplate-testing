/**
 * Turning what the caller saw into the word that goes in a cell.
 *
 * Kept apart from the runs for the reason `intercept/outcomes.ts` states: this
 * is where a measurement could flatter itself. "The call failed" is not one
 * outcome, and a classifier that collapsed a timeout, a refused connection and
 * a parser error into `failed` would make the two broken wirings in
 * `policies.ts` score exactly like the two correct ones — which is the whole
 * reading this directory exists to argue against.
 *
 * So the rules are functions over plain data, here, and `outcomes.test.ts`
 * puts the awkward cases to them directly: a 200 whose body stops mid-token, a
 * socket that died with a successful status already sent, a wiring that never
 * returned at all.
 *
 * ---------------------------------------------------------------------------
 * `other` is a failure, not a bucket
 * ---------------------------------------------------------------------------
 * Every outcome word below is a thing one of the six wirings is known to do.
 * `other` is what an unrecognised throw classifies as, and no published cell
 * holds it: `runs.test.ts` fails on one. An open vocabulary would quietly
 * absorb the next Node release changing an error shape, and the table would
 * keep rendering while meaning something else.
 */

import type { FaultId } from './faults.ts'
import type { PolicyId } from './policies.ts'
import { DEADLINE_MS, WAITED_OUT_FLOOR_MS } from './timings.ts'

/** The body a healthy dependency answers with, and the only one that is `ok`. */
export const HEALTHY_BODY = { dependency: 'ledger', ok: true } as const

export const OUTCOMES = [
  'ok',
  'wrong-body',
  'http-error',
  'malformed',
  'aborted',
  'refused',
  'reset',
  'breaker-open',
  'hung',
  'other',
] as const

export type Outcome = (typeof OUTCOMES)[number]

export const OUTCOME_NOTES: Readonly<Record<Outcome, string>> = {
  ok: 'The dependency\'s own body came back, parsed.',
  'wrong-body':
    'Something parsed, and it was not what the dependency answers when it is well. The cell a wiring with no status check earns on a 500: an error payload is valid JSON.',
  'http-error': 'The wiring rejected the response on its status.',
  malformed: 'The status said 200 and the parser disagreed.',
  aborted: 'A timeout fired — the wiring gave up on its own terms.',
  refused: 'The connection never opened.',
  reset: 'The connection opened, answered, and died with the body unfinished.',
  'breaker-open': 'The wiring declined to call at all.',
  hung: 'The wiring never settled, and the harness\'s deadline ended the call. Not a verdict the wiring earned: a verdict about the wiring.',
  other: 'Unrecognised. Never a published cell — a cell reading this fails the suite.',
}

/** A thrown value, flattened to the three fields any of these rules reads. */
export interface ErrorShape {
  readonly name: string
  readonly message: string
  /** `cause.code` where the runtime set one — `ECONNREFUSED`, `UND_ERR_SOCKET`. */
  readonly causeCode: string | null
}

/** What one call did, as plain data the classifier can be tested against. */
export type Observation =
  | { readonly settled: 'resolved'; readonly body: unknown; readonly elapsedMs: number }
  | { readonly settled: 'rejected'; readonly error: ErrorShape; readonly elapsedMs: number }
  | { readonly settled: 'deadline'; readonly elapsedMs: number }

/** Whether a parsed body is the one a healthy dependency sends. */
export function isHealthyBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false

  const record = body as Record<string, unknown>

  return record['dependency'] === HEALTHY_BODY.dependency && record['ok'] === HEALTHY_BODY.ok
}

/**
 * The classifier.
 *
 * The order of the branches is load-bearing in one place: a `TypeError` is
 * both how undici reports a refused connection and how it reports a socket
 * that died mid-body, and the two are told apart by `cause.code` rather than
 * by the message, which reads `fetch failed` for the first and `terminated`
 * for the second. Keying on the message would work today and is one Node
 * release from being wrong, so the code is the key and the message is not read
 * at all.
 */
export function classify(observation: Observation): Outcome {
  if (observation.settled === 'deadline') return 'hung'

  if (observation.settled === 'resolved') {
    return isHealthyBody(observation.body) ? 'ok' : 'wrong-body'
  }

  const { name, causeCode } = observation.error

  if (name === 'TimeoutError') return 'aborted'
  if (name === 'BreakerOpenError') return 'breaker-open'
  if (name === 'HttpStatusError') return 'http-error'
  if (name === 'SyntaxError') return 'malformed'

  if (name === 'TypeError') {
    if (causeCode === 'ECONNREFUSED') return 'refused'
    if (causeCode === 'UND_ERR_SOCKET') return 'reset'
  }

  return 'other'
}

/**
 * How long the call took, as a band rather than a number.
 *
 * No published cell is a duration — see `timings.ts` — but *whether the call
 * sat through the fault* is the difference between a timeout that fired and
 * one that did not, and that is worth a column. `waited-out` is the band that
 * earns its place: it is what a wiring scores when it settled only because it
 * endured the entire injected latency, which is exactly what `race-timeout`
 * does to `slow-body` and is completely invisible in the outcome column, where
 * that cell reads a cheerful `ok`.
 *
 * The boundary is `WAITED_OUT_FLOOR_MS` rather than `INJECTED_MS`, which is
 * not a detail: see the derivation there, and the band that flipped between
 * two runs before it existed.
 *
 * Three bands and not four. An earlier draft had a `within-budget` band
 * between `prompt` and `waited-out`, to separate "returned at once" from
 * "timed out on schedule". It was deleted because the outcome column already
 * says which of those happened — `ok` against `aborted` — and because its
 * lower boundary sat at `BUDGET_MS`, which is 100ms: close enough to a healthy
 * loopback call that a loaded runner could have moved a cell, and a band
 * boundary that can move is a flake with a table around it.
 */
export const BANDS = ['prompt', 'waited-out', 'deadline'] as const

export type Band = (typeof BANDS)[number]

export const BAND_NOTES: Readonly<Record<Band, string>> = {
  prompt: 'Settled before the injected fault could have elapsed.',
  'waited-out': 'Settled only after sitting through the whole injected fault.',
  deadline: 'Did not settle at all; the harness ended the call.',
}

export function band(elapsedMs: number): Band {
  if (elapsedMs >= DEADLINE_MS) return 'deadline'
  if (elapsedMs >= WAITED_OUT_FLOOR_MS) return 'waited-out'

  return 'prompt'
}

/**
 * One cell of one table.
 *
 * Declared here rather than beside the runs that produce it, and the reason is
 * `shape/boundaries.ts`: `runs.ts` reaches a TCP socket, so anything importing
 * it is an integration test. The cells, the words in them and the tables they
 * sit in are ordinary data, and keeping their types in a module that imports
 * nothing but other pure modules is what lets the whole derivation half of
 * this directory — the findings, the renderer, the README audit — stay in the
 * unit layer where it belongs.
 */
export interface Cell {
  /** What the last call in the series did. */
  readonly outcome: Outcome
  /** Which side of the injected fault the last call settled on. */
  readonly band: Band
  /** Requests the whole series made. */
  readonly requests: number
}

/** One layer's cells: a row per policy, a column per fault. */
export type Table = Readonly<Record<PolicyId, Readonly<Record<FaultId, Cell>>>>

/** Whether two cells agree in every column. */
export const sameCell = (left: Cell, right: Cell): boolean =>
  left.outcome === right.outcome && left.band === right.band && left.requests === right.requests
