import { describe, expect, it } from 'vitest'

import { PARSE_ERROR_CODES, VALIDATION_ERROR_CODES } from './config.ts'
import { GENERATOR_IDS, type GeneratorId } from './generators.ts'
import { coverage, measureReach, type Reach } from './reach.ts'
import { CAMPAIGN_BUDGET, SEED } from './settings.ts'

/**
 * What each generator reaches, and the shape of the answer.
 *
 * The counts themselves live in `README.md` and are checked there against a
 * live measurement. What is asserted here is the *structure* — which is the
 * part that would still be the point if every number moved:
 *
 *   - the naive generator never gets past the lexer,
 *   - the structure-aware one never gets *into* the lexer,
 *   - the mutation fuzzer is the only single generator that reaches both, and
 *     it still leaves a third of the validator's refusals unreached,
 *   - and only the rotation covers everything.
 *
 * Ranges rather than exact equalities on purpose. An exact count would pin
 * this suite to the arithmetic of one seed and go red on an honest change to a
 * mutation weight, which trains whoever hits it to update the number without
 * reading it. The claims that matter are ordinal.
 */

const reach: Record<GeneratorId, Reach> = {
  random: measureReach('random', SEED, CAMPAIGN_BUDGET),
  mutate: measureReach('mutate', SEED, CAMPAIGN_BUDGET),
  grammar: measureReach('grammar', SEED, CAMPAIGN_BUDGET),
  mixed: measureReach('mixed', SEED, CAMPAIGN_BUDGET),
}

describe('the naive generator', () => {
  const random = reach.random

  it('provokes fewer of the parser refusals than a corpus-driven fuzzer does', () => {
    expect(random.parseCodes.length).toBeLessThan(reach.mutate.parseCodes.length)
  })

  it('never reaches a branch that needs a backslash', () => {
    // The clean statement of what uniform characters cannot do. An escape
    // sequence is two specific characters in a specific order inside a string
    // that is otherwise well formed, and a draw over 132 characters does not
    // assemble one — not at this budget and not at a thousand times it.
    expect(random.parseCodes).not.toContain('INVALID_ESCAPE')
    expect(random.parseCodes).not.toContain('INVALID_UNICODE_ESCAPE')
  })

  it('gets a document past the parser about once in a thousand tries', () => {
    expect(random.parsed).toBeLessThan(CAMPAIGN_BUDGET * 0.01)
    expect(random.accepted).toBe(0)
  })

  it('reaches the validator only far enough to be told it is not an object', () => {
    expect(random.validationCodes).toStrictEqual(['NOT_AN_OBJECT'])
  })

  it('never nests deeply enough to reach the depth check', () => {
    expect(random.parseCodes).not.toContain('DEPTH_EXCEEDED')
  })
})

describe('the mutation fuzzer', () => {
  const mutate = reach.mutate

  it('provokes every refusal the parser has', () => {
    expect(mutate.parseCodes).toStrictEqual([...PARSE_ERROR_CODES])
  })

  it('reaches the validator, because its seeds are real documents', () => {
    expect(mutate.validationCodes.length).toBeGreaterThan(3)
    expect(mutate.parsed).toBeGreaterThan(CAMPAIGN_BUDGET * 0.05)
  })

  it('still leaves refusals the structure-aware generator reaches trivially', () => {
    const missed = VALIDATION_ERROR_CODES.filter((code) => !mutate.validationCodes.includes(code))

    expect(missed.length).toBeGreaterThan(0)
    expect(missed.every((code) => reach.grammar.validationCodes.includes(code))).toBe(true)
  })
})

describe('the structure-aware generator', () => {
  const grammar = reach.grammar

  it('provokes every refusal the validator has', () => {
    expect(grammar.validationCodes).toStrictEqual([...VALIDATION_ERROR_CODES])
  })

  it('provokes exactly one refusal from the parser, and that one only by nesting', () => {
    expect(grammar.parseCodes).toStrictEqual(['DEPTH_EXCEEDED'])
  })

  it('gets almost everything past the parser', () => {
    expect(grammar.parsed).toBeGreaterThan(CAMPAIGN_BUDGET * 0.9)
  })
})

describe('the rotation', () => {
  const mixed = reach.mixed

  it('covers the whole declared surface, which no single generator does', () => {
    expect(mixed.parseCodes).toStrictEqual([...PARSE_ERROR_CODES])
    expect(mixed.validationCodes).toStrictEqual([...VALIDATION_ERROR_CODES])

    const complete = GENERATOR_IDS.filter(
      (id) =>
        reach[id].parseCodes.length === PARSE_ERROR_CODES.length &&
        reach[id].validationCodes.length === VALIDATION_ERROR_CODES.length,
    )

    expect(complete).toStrictEqual(['mixed'])
  })
})

describe('the coverage figures', () => {
  it.each(GENERATOR_IDS)('%s reports a fraction of each declared list', (id) => {
    const measured = coverage(reach[id])

    expect(measured.parse).toMatch(new RegExp(`^\\d+/${PARSE_ERROR_CODES.length}$`))
    expect(measured.validation).toMatch(new RegExp(`^\\d+/${VALIDATION_ERROR_CODES.length}$`))
  })

  it('is a deterministic function of the seed', () => {
    expect(measureReach('mutate', SEED, 500)).toStrictEqual(measureReach('mutate', SEED, 500))
  })

  it('counts codes in the order they are declared', () => {
    const declared = [...PARSE_ERROR_CODES]
    const observed = reach.mixed.parseCodes

    expect(observed).toStrictEqual(declared.filter((code) => observed.includes(code)))
  })
})
