/**
 * Four ways of deciding whether an input just found a bug.
 *
 * ---------------------------------------------------------------------------
 * The oracle is the hard part
 * ---------------------------------------------------------------------------
 * Every introduction to fuzzing is about the generator. Generators are the fun
 * half, they are what the tools ship, and they are not where the difficulty
 * is. A campaign runs a million inputs a minute and then has to answer, for
 * each one, *was that answer right* — with no human in the loop, because the
 * whole premise is that nobody looked at the input. That question is the
 * oracle problem, and every technique below is a different, partial,
 * differently-blind answer to it.
 *
 * Ordered here by how much they cost to write, which is very nearly the
 * reverse of how much they find:
 *
 *   1. `crash` — did it throw. One line. Requires knowing nothing about the
 *      subject, and it is what "we fuzzed it" almost always means.
 *   2. `roundtrip` — parse, serialise, parse again, compare. Self-consistency:
 *      no reference implementation needed, and no ability to notice that the
 *      subject is consistently wrong.
 *   3. `differential` — compare against `JSON.parse`. Nearly perfect, free,
 *      and available only because somebody else already implemented this
 *      grammar. Carries a list of intended divergences, and every entry on
 *      that list is a hole.
 *   4. `invariant` — properties the answer must satisfy, written out by hand
 *      from the documented schema. The only one that can see the validator at
 *      all, and the most work by a wide margin.
 *
 * `detection.test.ts` runs all four against all sixteen faults over one fixed
 * generator, so the table below is a measurement of oracles and not a
 * measurement of luck.
 *
 * ---------------------------------------------------------------------------
 * Why a probe returns a finding instead of asserting
 * ---------------------------------------------------------------------------
 * The same reason `property/probes.ts` gives: a probe is asked a question two
 * thousand times and has to keep going either way. `expect` is the wrong
 * control flow for a loop, and catching a thrown assertion in order to read it
 * as a boolean is how a suite ends up unable to tell "the subject is broken"
 * from "the probe is broken". Each probe reports *which* check fired, because
 * that is the half of the answer a report is read for.
 */

import { MAX_DEPTH, PARSE_ERROR_CODES, VALIDATION_ERROR_CODES, type Json } from './config.ts'
import { sameRoundTrip, sameValue } from './equality.ts'
import type { Subject } from './load.ts'
import { specViolation, unknownKeys } from './spec.ts'

export const ORACLE_IDS = ['crash', 'roundtrip', 'differential', 'invariant'] as const

export type OracleId = (typeof ORACLE_IDS)[number]

/** What a probe says when an input reveals something. */
export interface Finding {
  /** Which check fired, in a form that can be counted. */
  readonly reason: string
  /** What it saw, for the report. */
  readonly detail: string
}

export interface Oracle {
  readonly id: OracleId
  /** One sentence, quoted by `README.md` and checked by `readme.test.ts`. */
  readonly description: string
  /** What this one cannot see, by construction rather than by accident. */
  readonly blindTo: string
  readonly check: (subject: Subject, input: string) => Finding | null
}

// ---------------------------------------------------------------------------
// Recognising a parse failure across a module boundary
// ---------------------------------------------------------------------------

const PARSE_CODES = new Set<string>(PARSE_ERROR_CODES)
const VALIDATION_CODES = new Set<string>(VALIDATION_ERROR_CODES)

/**
 * Whether a thrown value is the parser saying no, rather than the parser
 * falling over.
 *
 * Structural, not `instanceof`, and the distinction is the entire crash
 * oracle: `load.ts` holds seventeen copies of `config.ts`, so the class
 * identity a naive check relies on is not shared. A probe written with
 * `instanceof` would classify every refusal as a crash and report all sixteen
 * faults as caught — the most flattering possible result, produced by a bug in
 * the measurement.
 */
export function isParseRefusal(error: unknown): error is { code: string; message: string } {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  const candidate = error as { name?: unknown; code?: unknown }

  return (
    candidate.name === 'JsonParseError' &&
    typeof candidate.code === 'string' &&
    PARSE_CODES.has(candidate.code)
  )
}

type ParseOutcome =
  | { readonly ok: true; readonly value: Json }
  | { readonly ok: false; readonly code: string }

/**
 * Parse, separating "refused" from "fell over".
 *
 * A crash is rethrown rather than reported as a refusal, so that only the
 * crash oracle decides what a crash means. Three of the four probes here are
 * about *answers*, and an oracle that quietly absorbed a `RangeError` into its
 * own idea of rejection would be reporting on a subject that never ran.
 */
function attemptParse(subject: Subject, input: string): ParseOutcome {
  try {
    return { ok: true, value: subject.parseJson(input) }
  } catch (error) {
    if (isParseRefusal(error)) {
      return { ok: false, code: error.code }
    }

    throw error
  }
}

/**
 * How deeply the text nests, counted without parsing it.
 *
 * The differential oracle needs this because the parser's depth limit is a
 * declared divergence from `JSON.parse`, and inputs past the limit have to be
 * excused before the comparison rather than after it. Which is the awkward
 * part of a differential oracle nobody mentions: *the excuse list needs its
 * own parser*. This one is deliberately crude — it tracks strings and escapes
 * and nothing else, so on malformed input it over-counts, which excuses more
 * than strictly necessary and can only ever weaken the oracle. Erring the
 * other way would produce false alarms on the control, and an oracle that
 * cries wolf is worse than one that is quiet.
 */
export function textualDepth(text: string): number {
  let depth = 0
  let deepest = 0
  let inString = false
  let escaped = false

  for (const character of text) {
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }

      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '[' || character === '{') {
      depth += 1
      deepest = Math.max(deepest, depth)
    } else if (character === ']' || character === '}') {
      depth -= 1
    }
  }

  return deepest
}

// ---------------------------------------------------------------------------
// crash
// ---------------------------------------------------------------------------

/**
 * Rule 1 of the contract: `loadConfig` returns, whatever it is given.
 *
 * Note what this probe does *not* check: that `loadConfig` returns in a
 * reasonable time. A hang needs a watchdog on another thread, and in this
 * repository that watchdog is Vitest's own test timeout — which is a real
 * answer, but a coarse one, and worth naming rather than pretending the loop
 * below covers it.
 */
const CRASH: Oracle = {
  id: 'crash',
  description: 'the pipeline returned rather than throwing',
  blindTo: 'every wrong answer that is returned politely, which is fifteen of the sixteen faults',
  check: (subject, input) => {
    try {
      subject.loadConfig(input)

      return null
    } catch (error) {
      const thrown = error instanceof Error ? `${error.name}: ${error.message}` : String(error)

      return { reason: 'THREW', detail: thrown.slice(0, 120) }
    }
  },
}

// ---------------------------------------------------------------------------
// roundtrip
// ---------------------------------------------------------------------------

/**
 * Parse, serialise, parse again — the answer must not have moved.
 *
 * The oracle you reach for when no reference implementation exists, and the
 * one whose weakness is structural rather than incidental: it compares the
 * subject against itself, so a parser that is *consistently* wrong sails
 * through. `LEADING_ZERO_ACCEPTED` is the clean example — `010` parses to ten,
 * serialises to `10`, parses to ten, and every step agrees with every other.
 */
const ROUNDTRIP: Oracle = {
  id: 'roundtrip',
  description: 'parse → serialise → parse produced the same value',
  blindTo: 'any error the subject makes consistently, which is most of them',
  check: (subject, input) => {
    const first = attemptParse(subject, input)

    if (!first.ok) {
      return null
    }

    let serialised: string

    try {
      serialised = JSON.stringify(first.value) as string
    } catch (error) {
      // The subject produced a value the serialiser cannot write down. That is
      // a finding about the subject — nothing `parseJson` may return is
      // unserialisable — even though the throw came from `JSON.stringify`.
      return {
        reason: 'SERIALISE_THREW',
        detail: error instanceof Error ? error.message.slice(0, 120) : String(error),
      }
    }

    const second = attemptParse(subject, serialised)

    if (!second.ok) {
      return { reason: 'REPARSE_REFUSED', detail: `its own output was refused: ${second.code}` }
    }

    if (!sameRoundTrip(first.value, second.value)) {
      return {
        reason: 'REPARSE_DIFFERS',
        detail: `${JSON.stringify(first.value)?.slice(0, 60)} became ${JSON.stringify(second.value)?.slice(0, 60)}`,
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// differential
// ---------------------------------------------------------------------------

/**
 * Rule 3 of the contract: agree with `JSON.parse`, except where declared.
 *
 * The strongest oracle available for this half of the subject and the cheapest
 * to write, and both of those facts have the same cause — the grammar is
 * published and somebody else already implemented it. That is the condition
 * under which fuzzing looks miraculous, and it is worth being precise that it
 * is a property of the *problem*: nothing about the technique carries over to
 * the half of `config.ts` that implements rules nobody else has.
 *
 * The declared divergence is the depth limit, and it is a genuine hole rather
 * than a technicality — `NO_DEPTH_LIMIT` is the fault that lives in it, and
 * this oracle cannot see it however long the campaign runs.
 */
const DIFFERENTIAL: Oracle = {
  id: 'differential',
  description: 'accepted exactly what `JSON.parse` accepts, with an equal value',
  blindTo: 'the declared divergence — anything nested past MAX_DEPTH',
  check: (subject, input) => {
    if (textualDepth(input) > MAX_DEPTH) {
      return null
    }

    const mine = attemptParse(subject, input)

    let reference: { ok: true; value: unknown } | { ok: false }

    try {
      reference = { ok: true, value: JSON.parse(input) as unknown }
    } catch {
      reference = { ok: false }
    }

    if (mine.ok !== reference.ok) {
      return {
        reason: mine.ok ? 'ACCEPTED_WHAT_JSON_REJECTS' : 'REJECTED_WHAT_JSON_ACCEPTS',
        detail: mine.ok ? 'the subject accepted it' : `the subject refused it: ${mine.code}`,
      }
    }

    if (mine.ok && reference.ok && !sameValue(mine.value, reference.value)) {
      return {
        reason: 'VALUE_DIFFERS',
        detail: `${JSON.stringify(mine.value)?.slice(0, 60)} vs ${JSON.stringify(reference.value)?.slice(0, 60)}`,
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// invariant
// ---------------------------------------------------------------------------

/**
 * Five properties of `validateConfig`, checked on every parsed value.
 *
 * This is the only probe that can see the validator, and writing it is the
 * only way to get a fuzzer anywhere near business logic. It is also five
 * separate decisions about what the validator promises, and the faults it
 * misses are exactly the promises nobody wrote down — which `README.md` argues
 * is the general case rather than an accident of this schema.
 *
 * It calls `validateConfig` directly rather than going through `loadConfig`,
 * which is not a shortcut: `TAGS_SORTED_IN_PLACE` is a bug for every caller
 * that holds the object it validates, and it is invisible end-to-end because
 * the pipeline's input was allocated by the parser a microsecond earlier and
 * belongs to nobody. A probe pointed only at the outermost entry point cannot
 * see a contract that exists one layer in.
 */
const INVARIANT: Oracle = {
  id: 'invariant',
  description: 'the validator kept its five documented promises',
  blindTo: 'a rule nobody wrote down, and anything the validator wrongly refuses',
  check: (subject, input) => {
    const parsed = attemptParse(subject, input)

    if (!parsed.ok) {
      return null
    }

    const before = structuredClone(parsed.value)
    const result = subject.validateConfig(parsed.value)

    // 1. Rule 4 of the contract: the caller's value is not the validator's to
    //    modify.
    if (!sameValue(parsed.value, before)) {
      return {
        reason: 'MUTATED_ITS_ARGUMENT',
        detail: `${JSON.stringify(before)?.slice(0, 60)} became ${JSON.stringify(parsed.value)?.slice(0, 60)}`,
      }
    }

    if (result.ok) {
      // 2. Rule 2: an accepted value satisfies the schema it was checked
      //    against.
      const violation = specViolation(result.value)

      if (violation !== null) {
        return { reason: 'ACCEPTED_INVALID', detail: violation }
      }

      // 3. Acceptance loses nothing. The result is rebuilt from the schema's
      //    own field list, so a dropped unknown key is only visible on the way
      //    in.
      const extra = unknownKeys(parsed.value)

      if (extra.length > 0) {
        return { reason: 'ACCEPTED_UNKNOWN_KEYS', detail: `kept nothing of [${extra.join(', ')}]` }
      }

      // 4. Validating an accepted value accepts it again, unchanged. A
      //    validator that normalises has to be idempotent or the second save
      //    of a settings page is not the first.
      const again = subject.validateConfig(result.value)

      if (!again.ok || !sameValue(again.value, result.value)) {
        return { reason: 'NOT_IDEMPOTENT', detail: 'revalidating the accepted value changed it' }
      }

      return null
    }

    // 5. A refusal says what is wrong, with a code from the declared list and
    //    a path. `return { ok: false }` is a validator that passes every
    //    property above and helps nobody.
    if (result.errors.length === 0) {
      return { reason: 'SILENT_REFUSAL', detail: 'refused with no errors' }
    }

    for (const error of result.errors) {
      if (!VALIDATION_CODES.has(error.code)) {
        return { reason: 'UNDECLARED_ERROR_CODE', detail: error.code }
      }
    }

    return null
  },
}

export const ORACLES: readonly Oracle[] = [CRASH, ROUNDTRIP, DIFFERENTIAL, INVARIANT]

const BY_ID = new Map(ORACLES.map((oracle) => [oracle.id, oracle]))

export function oracleNamed(id: OracleId): Oracle {
  const oracle = BY_ID.get(id)

  if (oracle === undefined) {
    throw new Error(`no oracle named ${id}`)
  }

  return oracle
}
