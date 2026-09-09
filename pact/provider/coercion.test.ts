/**
 * The one finding in this directory that is about pact rather than about a
 * pipeline: `MatchersV3.integer()` coerces.
 *
 * `pipeline/`'s matrix records `USER_ID_STRINGIFIED` as missed by all four
 * wirings, which is a strong claim — `"id": 1` becoming `"id": "1"` is the
 * breaking change an ORM upgrade makes by itself, and "contract testing does
 * not catch it" is the kind of sentence that should not stand on one
 * observation.
 *
 * Two runs settle it. The same interaction, the same matcher, the same
 * verifier: `"1"` passes and `"abc"` fails. So the field *is* being matched
 * and the rule is "parses as an integer" rather than "is a JSON number" —
 * which means no selector, gate or broker can change the answer, and the
 * matrix's four missed cells are a property of the matcher.
 *
 * If a later pact release tightens this, the second assertion goes red and the
 * README's paragraph is wrong rather than merely out of date.
 */

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONSUMER_PACT_FILE } from '../pact.config'
import { CORRECT } from './app'
import { verifyProvider } from './verify'

describe('The integer matcher', () => {
  it('accepts a numeric string where the contract says integer', async () => {
    expect(existsSync(CONSUMER_PACT_FILE)).toBe(true)

    const outcome = await verifyProvider({
      source: { kind: 'files', paths: [CONSUMER_PACT_FILE] },
      flags: { ...CORRECT, stringifyUserId: true },
    })

    expect(outcome).toEqual({ kind: 'passed' })
  }, 60_000)

  it('rejects a string that is not a number, in the same field', async () => {
    const outcome = await verifyProvider({
      source: { kind: 'files', paths: [CONSUMER_PACT_FILE] },
      flags: { ...CORRECT, bogusUserId: true },
    })

    // The control. Without this the first assertion is equally well explained
    // by the id never being matched at all.
    expect(outcome.kind).toBe('failed')
  }, 60_000)
})
