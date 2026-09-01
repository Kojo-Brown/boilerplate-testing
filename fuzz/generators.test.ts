import { describe, expect, it } from 'vitest'

import { loadConfig, MAX_TAGS } from './config.ts'
import {
  GENERATOR_IDS,
  GENERATORS,
  generatorNamed,
  inputStream,
  type GeneratorId,
  mutationStream,
  SEED_CORPUS,
} from './generators.ts'
import { createRng } from './random.ts'
import { CAMPAIGN_BUDGET, DEEP_NESTING, SEED } from './settings.ts'

/**
 * The generators, held to the two things a campaign's reproducibility rests
 * on and the one structural promise each of them makes.
 *
 * Determinism first, because everything else in this directory is a property
 * of a seed. A committed corpus of witnesses, a matrix pinned in `corpus.ts`
 * and a README full of counts are all worthless the moment the same seed stops
 * producing the same campaign — and the failure would not look like a broken
 * generator, it would look like an intermittent detection matrix, which is the
 * hardest kind of red to read.
 */

describe('a stream is a pure function of its seed', () => {
  it.each(GENERATOR_IDS)('%s repeats exactly', (id) => {
    const first = [...inputStream(id, SEED, 200)]
    const second = [...inputStream(id, SEED, 200)]

    expect(second).toStrictEqual(first)
  })

  it.each(GENERATOR_IDS)('%s produces something else from another seed', (id) => {
    const first = [...inputStream(id, SEED, 200)]
    const second = [...inputStream(id, SEED + 1, 200)]

    expect(second).not.toStrictEqual(first)
  })

  it('mixed keeps its rotation across separate streams', () => {
    // The rotation counter lives in the stream, not in the generator. A
    // closure would make the second campaign of a process differ from the
    // first, and every recorded `inputsTried` in `corpus.ts` would drift by
    // however many campaigns happened to run before it.
    const once = [...inputStream('mixed', SEED, 30)]
    const twice = [...inputStream('mixed', SEED, 30)]

    expect(twice).toStrictEqual(once)
  })

  it('yields exactly the number of inputs asked for', () => {
    expect([...inputStream('mutate', SEED, 37)]).toHaveLength(37)
  })
})

describe('mixed rotates rather than sampling', () => {
  it('takes its inputs from the other three in turn', () => {
    const rotation: readonly GeneratorId[] = ['random', 'mutate', 'grammar']
    const rng = createRng(SEED)
    const expected = Array.from({ length: 12 }, (_unused, index) =>
      generatorNamed(rotation[index % rotation.length] as GeneratorId).next(rng, index),
    )

    expect([...inputStream('mixed', SEED, 12)]).toStrictEqual(expected)
  })
})

describe('the structure-aware generator', () => {
  const inputs = [...inputStream('grammar', SEED, CAMPAIGN_BUDGET)]

  it('emits well-formed JSON every time', () => {
    const malformed = inputs.filter((input) => {
      try {
        JSON.parse(input)

        return false
      } catch {
        return true
      }
    })

    expect(malformed).toStrictEqual([])
  })

  it('reaches the deep-nesting case, which nothing else can', () => {
    const deep = inputs.filter((input) => input.length === DEEP_NESTING * 2)

    expect(deep.length).toBeGreaterThan(0)
  })

  it('produces a document the validator accepts often enough to exercise it', () => {
    // The number that had to be measured rather than assumed. An earlier
    // version of `grammarInput` drew each field independently and landed at
    // 0.4%, which left every invariant about accepted configs effectively
    // untested. A floor here is what stops that regressing quietly.
    const accepted = inputs.filter((input) => loadConfig(input).ok)

    expect(accepted.length / inputs.length).toBeGreaterThan(0.2)
  })

  it('produces a rejected document at least as often as an accepted one', () => {
    const accepted = inputs.filter((input) => loadConfig(input).ok)

    expect(accepted.length).toBeLessThan(inputs.length / 2)
  })

  it('writes a key twice sometimes, which no JavaScript object can express', () => {
    const duplicated = inputs.filter((input) => (input.match(/"retries":/g) ?? []).length > 1)

    expect(duplicated.length).toBeGreaterThan(0)
  })

  it('emits __proto__ as a key rather than setting a prototype', () => {
    // The bug the generator had, and the reason `PERTURBATIONS` uses
    // `defineProperty`: `document.__proto__ = value` sets the prototype, the
    // key never reaches the serialised text, and the generator silently loses
    // the only input that can expose `PROTOTYPE_POLLUTION`.
    expect(inputs.filter((input) => input.includes('"__proto__"')).length).toBeGreaterThan(0)
  })
})

describe('the naive generator', () => {
  const inputs = [...inputStream('random', SEED, CAMPAIGN_BUDGET)]

  const parses = (input: string): boolean => {
    const result = loadConfig(input)

    return result.ok || result.stage === 'validate'
  }

  it('produces a document that parses in under one input in a hundred', () => {
    // The number behind "fuzzing does not work". Uniform characters reach the
    // first byte of the lexer and stop, so a campaign of two thousand inputs
    // exercises almost nothing and reports the same clean bill of health a
    // thorough one would.
    expect(inputs.filter(parses).length / inputs.length).toBeLessThan(0.01)
  })

  it('never produces a document the validator accepts', () => {
    expect(inputs.filter((input) => loadConfig(input).ok)).toStrictEqual([])
  })
})

describe('the seed corpus', () => {
  it('holds only documents worth mutating', () => {
    expect(SEED_CORPUS.length).toBeGreaterThan(5)
  })

  it('carries the escape and exponent spellings a mutation needs to reach', () => {
    const joined = SEED_CORPUS.join('\n')

    expect(joined).toContain('\\u00e9')
    expect(joined).toContain('\\t')
    expect(joined).toContain('e1')
    expect(joined).toContain('e-3')
  })

  it('carries one document nested past the parser limit and short of the stack', () => {
    const deep = SEED_CORPUS.filter((seed) => seed.startsWith('[['))

    expect(deep).toHaveLength(1)
    expect(loadConfig(deep[0] as string)).toMatchObject({ code: 'DEPTH_EXCEEDED' })
  })

  it('holds no duplicates', () => {
    expect(new Set(SEED_CORPUS).size).toBe(SEED_CORPUS.length)
  })
})

describe('a mutation stream over an arbitrary corpus', () => {
  it('draws only from the corpus it was given', () => {
    const inputs = [...mutationStream(['{}'], SEED, 50)]

    // Every input is one to four edits of `{}`, so nothing can be long.
    expect(Math.max(...inputs.map((input) => input.length))).toBeLessThan(40)
  })

  it('repeats exactly for the same corpus and seed', () => {
    expect([...mutationStream(SEED_CORPUS, SEED, 50)]).toStrictEqual([
      ...mutationStream(SEED_CORPUS, SEED, 50),
    ])
  })
})

describe('the generator table', () => {
  it('lists every declared id exactly once', () => {
    expect(GENERATORS.map((generator) => generator.id)).toStrictEqual([...GENERATOR_IDS])
  })

  it('gives every generator a description', () => {
    for (const generator of GENERATORS) {
      expect(generator.description.length).toBeGreaterThan(20)
    }
  })

  it('refuses a name it does not know', () => {
    expect(() => generatorNamed('nonexistent' as 'random')).toThrow(/no generator named/)
  })
})

describe('the tag pool', () => {
  it('holds enough distinct tags to fill a document to its limit', () => {
    const withTags = [...inputStream('grammar', SEED, 400)]
      .map((input) => loadConfig(input))
      .filter((result) => result.ok)

    expect(Math.max(...withTags.map((result) => (result.ok ? result.value.tags.length : 0)))).toBe(
      MAX_TAGS,
    )
  })
})
