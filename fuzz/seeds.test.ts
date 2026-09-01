// @vitest-environment node
//
// Compiles variants of `config.ts` and imports them off disk, which needs the
// node environment for the same reason `snapshot/detection.test.ts` does:
// jsdom's `import.meta.url` is not a file URL, so `fileURLToPath` throws
// before a single test runs.
import { describe, expect, it } from 'vitest'

import { probeOnce } from './campaign.ts'
import { mutationStream, SEED_CORPUS } from './generators.ts'
import { loadVariant } from './load.ts'
import { SEED } from './settings.ts'

/**
 * What one seed is worth.
 *
 * The folklore about mutation fuzzing is that the corpus matters. That is
 * true, it is repeated everywhere, and it is almost never quantified — so it
 * lands as a vague instruction to have a good corpus rather than as a fact
 * about what a bad one costs. This file makes it a number.
 *
 * `EXPONENT_PLUS_REJECTED` is one character of the JSON grammar: the parser
 * refuses `1e+5`, which is a perfectly good number. The differential oracle
 * would catch it instantly — the reference accepts what the subject refuses,
 * which is exactly the comparison it makes — and across the whole detection
 * matrix it is one of two faults nothing automated finds.
 *
 * Nothing is wrong with the oracle. `+` is in the mutation alphabet and `e` is
 * in three seeds, and the mutation fuzzer still never assembles a valid
 * exponent with a sign in it, because assembling one requires several
 * coincident edits and the search is not looking for anything in particular.
 * Add a single seed containing `1e+5` and the same fuzzer, the same oracle and
 * the same seed number find it in 45 inputs.
 *
 * The seed is deliberately absent from `SEED_CORPUS`. Adding it would raise
 * the differential oracle from eight faults to nine and cost the
 * demonstration, and it would not change the lesson: the next spelling nobody
 * thought of is still missing, and there is no report anywhere that says so.
 * A campaign's blind spots are invisible from inside the campaign — the only
 * thing that makes them visible is a coverage measure like `reach.ts`, or an
 * injected fault like this one.
 */

const CAMPAIGN = 20_000

describe('a fault the corpus cannot reach', () => {
  it('survives twenty thousand mutations of the corpus as it stands', async () => {
    const subject = await loadVariant('EXPONENT_PLUS_REJECTED')

    let found = 0

    for (const input of mutationStream(SEED_CORPUS, SEED, CAMPAIGN)) {
      if (probeOnce(subject, 'differential', input) !== null) {
        found += 1
      }
    }

    expect(found).toBe(0)
  }, 30_000)

  it('falls to the same fuzzer in under a hundred inputs once one seed is added', async () => {
    const subject = await loadVariant('EXPONENT_PLUS_REJECTED')

    let firstAt = 0
    let index = 0

    for (const input of mutationStream([...SEED_CORPUS, '1e+5'], SEED, CAMPAIGN)) {
      index += 1

      if (firstAt === 0 && probeOnce(subject, 'differential', input) !== null) {
        firstAt = index
      }
    }

    expect(firstAt).toBeGreaterThan(0)
    expect(firstAt).toBeLessThan(100)
  }, 30_000)

  it('is not a fault the oracle is incapable of seeing', async () => {
    // The distinction the two cases above rest on. `RATIO_UPPER_BOUND_EXCLUSIVE`
    // is invisible in principle — there is no reference implementation of this
    // service's own rules, so nothing can tell a wrongly-refused config from a
    // rightly-refused one. This fault is invisible only in practice, and the
    // witness is one line long.
    const subject = await loadVariant('EXPONENT_PLUS_REJECTED')

    expect(probeOnce(subject, 'differential', '1e+5')).toMatchObject({
      reason: 'REJECTED_WHAT_JSON_ACCEPTS',
    })
  })

  it('leaves the honest subject alone on the same witness', async () => {
    const subject = await loadVariant('LEADING_ZERO_ACCEPTED')

    expect(probeOnce(subject, 'differential', '1e+5')).toBeNull()
  })
})
