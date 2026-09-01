import { describe, expect, it } from 'vitest'

import { CONFIG_KEYS, loadConfig, MAX_DEPTH, parseJson, validateConfig } from './config.ts'
import { EXAMPLES, validDocument } from './examples.ts'
import { specViolation, unknownKeys } from './spec.ts'

/**
 * The subject, held to the four rules `config.ts` documents, plus the
 * twenty-six hand-written cases that double as a probe.
 *
 * The examples run here as ordinary tests as well as inside the detection
 * matrix. Running them twice is not duplication: this suite is what makes them
 * a real suite — one that goes red in `pnpm test` when the subject breaks —
 * and `detection.test.ts` is what makes them a *measured* suite. A comparison
 * against an example corpus nobody actually runs would be a comparison against
 * a corpus that has quietly stopped passing.
 */

const subject = { parseJson, validateConfig, loadConfig }

describe('the hand-written example corpus', () => {
  it.each(EXAMPLES.map((example) => [example.title, example] as const))('%s', (_title, example) => {
    expect(example.run(subject)).toBeNull()
  })

  it('carries no two cases under the same title', () => {
    const titles = EXAMPLES.map((example) => example.title)

    expect(new Set(titles).size).toBe(titles.length)
  })
})

describe('parseJson agrees with JSON.parse', () => {
  const documents = [
    '{}',
    '[]',
    '{"a":1}',
    '[1,2,3]',
    '"text"',
    'true',
    'false',
    'null',
    '-0',
    '0',
    '1e+5',
    '1E-5',
    '-1.5e10',
    '0.5',
    '"\\ud800"',
    '"\\u0000"',
    '{"a":{"b":{"c":[1,{"d":null}]}}}',
    '{"__proto__":{"admin":true}}',
    '{"a":1,"a":2}',
    ' \t\r\n{"a":1}\n',
  ]

  it.each(documents)('%s parses to the same value', (text) => {
    expect(parseJson(text)).toStrictEqual(JSON.parse(text) as unknown)
  })

  const refusals = [
    '',
    '   ',
    '[1,]',
    '{"a":1,}',
    '01',
    '+1',
    '1.',
    '.5',
    "'text'",
    '{a:1}',
    '{"a" 1}',
    '{"a":1',
    '[1',
    '"unterminated',
    '"\\x41"',
    '"\\u41"',
    '"a\tb"',
    'NaN',
    'Infinity',
    'undefined',
    '{} extra',
    '1 2',
  ]

  it.each(refusals)('%s is refused by both', (text) => {
    expect(() => parseJson(text)).toThrow()
    expect(() => JSON.parse(text) as unknown).toThrow()
  })
})

describe('the depth limit', () => {
  const wrap = (depth: number): string => `${'['.repeat(depth)}1${']'.repeat(depth)}`

  it(`accepts nesting of exactly ${MAX_DEPTH}`, () => {
    expect(() => parseJson(wrap(MAX_DEPTH))).not.toThrow()
  })

  it(`refuses nesting of ${MAX_DEPTH + 1}`, () => {
    expect(() => parseJson(wrap(MAX_DEPTH + 1))).toThrow(/DEPTH_EXCEEDED/)
  })

  it('refuses 30,000 levels rather than overflowing the stack', () => {
    const result = loadConfig('['.repeat(30_000))

    expect(result).toMatchObject({ ok: false, stage: 'parse', code: 'DEPTH_EXCEEDED' })
  })
})

describe('loadConfig is total', () => {
  // Rule 1 of the contract, on the inputs most likely to break it. The
  // campaign checks it over two thousand generated documents; these are the
  // ones a person would think of, kept separate so that a regression here
  // names itself instead of arriving as a fuzzing report.
  const hostile = [
    '',
    '\0'.repeat(100),
    '\ud800'.repeat(50),
    '"'.repeat(1_000),
    '['.repeat(50_000),
    '{'.repeat(50_000),
    `{"a":${'['.repeat(30_000)}`,
    '1'.repeat(10_000),
    `"${'\\'.repeat(999)}"`,
    '\\u0000',
    ' {}',
  ]

  it.each(hostile.map((input, index) => [index, input] as const))(
    'input %i returns rather than throwing',
    (_index, input) => {
      expect(() => loadConfig(input)).not.toThrow()
    },
  )
})

describe('validateConfig', () => {
  it('accepts the reference document', () => {
    expect(validateConfig(validDocument())).toStrictEqual({
      ok: true,
      value: validDocument(),
    })
  })

  it('reports every problem rather than stopping at the first', () => {
    const result = validateConfig({
      name: 'NOT VALID',
      retries: 99,
      timeoutMs: 'soon',
      tags: ['a', 'a'],
      limits: { enabled: 1, ratio: 5 },
      surplus: true,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errors.map((error) => error.path).sort()).toStrictEqual([
      'limits.enabled',
      'limits.ratio',
      'name',
      'retries',
      'surplus',
      'tags.1',
      'timeoutMs',
    ])
  })

  it('leaves the document it was handed untouched', () => {
    const document = { ...validDocument(), tags: ['prod', 'eu'] }

    validateConfig(document)

    expect(document.tags).toStrictEqual(['prod', 'eu'])
  })

  it('returns a tags array the caller cannot reach', () => {
    const document = validDocument()
    const result = validateConfig(document)

    expect(result.ok && result.value.tags).not.toBe(document.tags)
  })

  const boundaries: [string, unknown, boolean][] = [
    ['retries at 0', { ...validDocument(), retries: 0 }, true],
    ['retries at 10', { ...validDocument(), retries: 10 }, true],
    ['retries at 11', { ...validDocument(), retries: 11 }, false],
    ['retries at -1', { ...validDocument(), retries: -1 }, false],
    ['timeoutMs at 1', { ...validDocument(), timeoutMs: 1 }, true],
    ['timeoutMs at 0', { ...validDocument(), timeoutMs: 0 }, false],
    ['timeoutMs at 60000', { ...validDocument(), timeoutMs: 60_000 }, true],
    ['timeoutMs at 60001', { ...validDocument(), timeoutMs: 60_001 }, false],
    ['ratio at 0', { ...validDocument(), limits: { enabled: true, ratio: 0 } }, true],
    ['ratio at 1', { ...validDocument(), limits: { enabled: true, ratio: 1 } }, true],
    ['ratio just over 1', { ...validDocument(), limits: { enabled: true, ratio: 1.0000001 } }, false],
    ['eight tags', { ...validDocument(), tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }, true],
    ['nine tags', { ...validDocument(), tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }, false],
  ]

  it.each(boundaries)('%s', (_title, document, accepted) => {
    expect(validateConfig(document).ok).toBe(accepted)
  })
})

describe('the schema key list', () => {
  it('matches the object the validator builds from it', () => {
    const accepted = validateConfig(validDocument())

    expect(accepted.ok && Object.keys(accepted.value).sort()).toStrictEqual([...CONFIG_KEYS].sort())
  })
})

describe('the independent specification', () => {
  it('agrees with the validator on the reference document', () => {
    expect(specViolation(validDocument())).toBeNull()
  })

  it('names the field it objects to', () => {
    expect(specViolation({ ...validDocument(), retries: 99 })).toContain('retries')
  })

  it('finds the keys the schema does not know', () => {
    expect(unknownKeys({ ...validDocument(), debug: 1, limits: { enabled: true, ratio: 0, x: 2 } }))
      .toStrictEqual(['debug', 'limits.x'])
  })

  it('says nothing about a document that carries only known keys', () => {
    expect(unknownKeys(validDocument())).toStrictEqual([])
  })
})
