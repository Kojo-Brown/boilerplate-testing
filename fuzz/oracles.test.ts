import { describe, expect, it } from 'vitest'

import {
  loadConfig,
  MAX_DEPTH,
  parseJson,
  validateConfig,
  type Config,
  type Json,
} from './config.ts'
import { sameRoundTrip, sameValue } from './equality.ts'
import type { Subject } from './load.ts'
import { isParseRefusal, ORACLES, ORACLE_IDS, oracleNamed, textualDepth } from './oracles.ts'

/**
 * The oracles, tested on the thing that makes an oracle worth anything: it
 * must be silent on correct code and loud on incorrect code, and the first
 * half is the one that gets skipped.
 *
 * A probe that fires on the control is worse than no probe. It costs a
 * campaign, it produces a report, and the report is wrong — which trains
 * whoever reads it to discount the next one, the same rubber-stamping spiral
 * `snapshot/README.md` measures around noisy snapshots. So every case below
 * comes in pairs: the honest subject stays quiet, a deliberately wrong one
 * does not.
 */

const honest: Subject = { parseJson, validateConfig, loadConfig }

/** A subject with exactly one thing wrong, built by wrapping the honest one. */
function wrapped(overrides: Partial<Subject>): Subject {
  return { ...honest, ...overrides }
}

describe('the oracle table', () => {
  it('lists every declared id exactly once', () => {
    expect(ORACLES.map((oracle) => oracle.id)).toStrictEqual([...ORACLE_IDS])
  })

  it('says what each one is blind to', () => {
    for (const oracle of ORACLES) {
      expect(oracle.blindTo.length).toBeGreaterThan(20)
      expect(oracle.description.length).toBeGreaterThan(20)
    }
  })

  it('refuses a name it does not know', () => {
    expect(() => oracleNamed('nonexistent' as 'crash')).toThrow(/no oracle named/)
  })
})

describe('every oracle is silent on the honest subject', () => {
  const inputs = ['{}', '[1,2]', 'nonsense', '', '{"a":', '-0', '"\\u0041"', '{"__proto__":1}']

  it.each(
    ORACLES.flatMap((oracle) => inputs.map((input) => [oracle.id, input, oracle] as const)),
  )('%s says nothing about %j', (_id, input, oracle) => {
    expect(oracle.check(honest, input)).toBeNull()
  })
})

describe('crash', () => {
  const crash = oracleNamed('crash')

  it('reports a subject that throws instead of returning', () => {
    const subject = wrapped({
      loadConfig: () => {
        throw new RangeError('Maximum call stack size exceeded')
      },
    })

    expect(crash.check(subject, '{}')).toMatchObject({ reason: 'THREW' })
  })

  it('says nothing about a subject that returns a wrong answer politely', () => {
    // The whole of the crash oracle's weakness in one case: the subject below
    // is completely broken and this probe has no opinion about it.
    const subject = wrapped({ loadConfig: () => ({ ok: false, stage: 'parse', code: 'EMPTY_INPUT', message: 'nope' }) })

    expect(crash.check(subject, '{"a":1}')).toBeNull()
  })
})

describe('roundtrip', () => {
  const roundtrip = oracleNamed('roundtrip')

  it('reports a parser whose own output it will not re-accept', () => {
    let calls = 0
    const subject = wrapped({
      parseJson: (text) => {
        calls += 1

        if (calls > 1) {
          throw Object.assign(new Error('no'), { name: 'JsonParseError', code: 'EMPTY_INPUT' })
        }

        return parseJson(text)
      },
    })

    expect(roundtrip.check(subject, '{"a":1}')).toMatchObject({ reason: 'REPARSE_REFUSED' })
  })

  it('reports a value that changes on the way back', () => {
    let calls = 0
    const subject = wrapped({
      parseJson: (text) => {
        calls += 1

        return calls === 1 ? parseJson(text) : ({ different: true } as Json)
      },
    })

    expect(roundtrip.check(subject, '{"a":1}')).toMatchObject({ reason: 'REPARSE_DIFFERS' })
  })

  it('reports a value the serialiser cannot write down', () => {
    const cyclic: Record<string, unknown> = {}

    cyclic.self = cyclic

    const subject = wrapped({ parseJson: () => cyclic as Json })

    expect(roundtrip.check(subject, '{}')).toMatchObject({ reason: 'SERIALISE_THREW' })
  })

  it('says nothing about a parser that is consistently wrong', () => {
    // Its structural weakness, stated as a test: this subject reads every
    // document as the number seven and round-trips perfectly.
    const subject = wrapped({ parseJson: () => 7 })

    expect(roundtrip.check(subject, '{"a":1}')).toBeNull()
  })

  it('tolerates negative zero, which no serialiser can preserve', () => {
    expect(roundtrip.check(honest, '-0')).toBeNull()
  })
})

describe('differential', () => {
  const differential = oracleNamed('differential')

  it('reports accepting what JSON.parse refuses', () => {
    const subject = wrapped({ parseJson: () => 1 })

    expect(differential.check(subject, '[1,]')).toMatchObject({
      reason: 'ACCEPTED_WHAT_JSON_REJECTS',
    })
  })

  it('reports refusing what JSON.parse accepts', () => {
    const subject = wrapped({
      parseJson: () => {
        throw Object.assign(new Error('no'), { name: 'JsonParseError', code: 'INVALID_NUMBER' })
      },
    })

    expect(differential.check(subject, '1e+5')).toMatchObject({
      reason: 'REJECTED_WHAT_JSON_ACCEPTS',
    })
  })

  it('reports a value that differs from the reference', () => {
    const subject = wrapped({ parseJson: () => ({ a: 2 }) })

    expect(differential.check(subject, '{"a":1}')).toMatchObject({ reason: 'VALUE_DIFFERS' })
  })

  it('sees a __proto__ key that has become a prototype', () => {
    const polluted = JSON.parse('{"a":1}') as Record<string, unknown>

    Object.setPrototypeOf(polluted, { admin: true })

    const subject = wrapped({ parseJson: () => polluted as Json })

    expect(differential.check(subject, '{"__proto__":{"admin":true},"a":1}')).toMatchObject({
      reason: 'VALUE_DIFFERS',
    })
  })

  it('excuses input past the declared depth limit', () => {
    // The hole in the strongest oracle, and it is a hole with a comment above
    // it: a subject that crashes on deep input is one this probe never runs.
    const subject = wrapped({
      parseJson: () => {
        throw new RangeError('Maximum call stack size exceeded')
      },
    })

    expect(differential.check(subject, '['.repeat(MAX_DEPTH + 1))).toBeNull()
  })
})

describe('invariant', () => {
  const invariant = oracleNamed('invariant')
  const document = '{"name":"a","retries":1,"timeoutMs":1,"tags":["b","a"],"limits":{"enabled":true,"ratio":1}}'

  it('reports a validator that modifies its argument', () => {
    const subject = wrapped({
      validateConfig: (value) => {
        ;(value as { tags: string[] }).tags.sort()

        return validateConfig(value)
      },
    })

    expect(invariant.check(subject, document)).toMatchObject({ reason: 'MUTATED_ITS_ARGUMENT' })
  })

  it('reports a validator that accepts a value the schema forbids', () => {
    const subject = wrapped({
      validateConfig: (value) => ({
        ok: true,
        value: { ...(value as Config), retries: 99 },
      }),
    })

    expect(invariant.check(subject, document)).toMatchObject({ reason: 'ACCEPTED_INVALID' })
  })

  it('reports a validator that swallows a field it does not know', () => {
    const withExtra = '{"name":"a","retries":1,"timeoutMs":1,"tags":[],"limits":{"enabled":true,"ratio":1},"x":1}'
    const subject = wrapped({
      validateConfig: (value) => {
        const { x: _x, ...rest } = value as Record<string, unknown>

        return validateConfig(rest)
      },
    })

    expect(invariant.check(subject, withExtra)).toMatchObject({ reason: 'ACCEPTED_UNKNOWN_KEYS' })
  })

  it('reports a validator that refuses without saying why', () => {
    const subject = wrapped({ validateConfig: () => ({ ok: false, errors: [] }) })

    expect(invariant.check(subject, '7')).toMatchObject({ reason: 'SILENT_REFUSAL' })
  })

  it('reports an error code outside the declared list', () => {
    const subject = wrapped({
      validateConfig: () => ({
        ok: false,
        errors: [{ code: 'MADE_UP' as 'WRONG_TYPE', path: 'name', message: 'no' }],
      }),
    })

    expect(invariant.check(subject, '7')).toMatchObject({ reason: 'UNDECLARED_ERROR_CODE' })
  })

  it('reports a validator whose output it will not accept a second time', () => {
    let calls = 0
    const subject = wrapped({
      validateConfig: (value) => {
        calls += 1

        return calls === 1 ? validateConfig(value) : { ok: false, errors: [] }
      },
    })

    expect(invariant.check(subject, document)).toMatchObject({ reason: 'NOT_IDEMPOTENT' })
  })

  it('says nothing about a validator that wrongly refuses a valid document', () => {
    // Fuzzing's structural blind spot, stated as a test. Every property this
    // oracle checks is about what the validator *accepts*, so a validator that
    // accepts nothing satisfies all of them.
    const subject = wrapped({
      validateConfig: () => ({
        ok: false,
        errors: [{ code: 'OUT_OF_RANGE', path: 'limits.ratio', message: 'no' }],
      }),
    })

    expect(invariant.check(subject, document)).toBeNull()
  })
})

describe('recognising a parse refusal', () => {
  it('accepts the shape the parser throws', () => {
    expect(isParseRefusal({ name: 'JsonParseError', code: 'EMPTY_INPUT' })).toBe(true)
  })

  it('rejects a RangeError, which is the whole point', () => {
    expect(isParseRefusal(new RangeError('Maximum call stack size exceeded'))).toBe(false)
  })

  it('rejects an error carrying a code the parser never declares', () => {
    expect(isParseRefusal({ name: 'JsonParseError', code: 'SOMETHING_ELSE' })).toBe(false)
  })

  it.each([null, undefined, 'text', 42])('rejects %j', (value) => {
    expect(isParseRefusal(value)).toBe(false)
  })
})

describe('counting nesting without parsing', () => {
  it.each([
    ['{}', 1],
    ['[]', 1],
    ['[[[]]]', 3],
    ['{"a":[{"b":1}]}', 3],
    ['1', 0],
    ['"[[[["', 0],
    ['"\\"[["', 0],
    ['[1],[2]', 1],
  ])('%j nests %i deep', (text, depth) => {
    expect(textualDepth(text)).toBe(depth)
  })

  it('over-counts rather than under-counts on malformed input', () => {
    // Deliberate: over-counting excuses more than necessary and can only
    // weaken the differential oracle. Under-counting would compare a document
    // the parser is entitled to refuse and report a false alarm.
    expect(textualDepth('[[[unterminated')).toBe(3)
  })
})

describe('structural equality', () => {
  it('separates an own property from an inherited one', () => {
    const inherited = Object.create({ a: 1 }) as Record<string, unknown>

    expect(sameValue(inherited, { a: 1 })).toBe(false)
  })

  it('counts the sign of zero for the differential comparison', () => {
    expect(sameValue(-0, 0)).toBe(false)
    expect(sameValue([-0], [0])).toBe(false)
  })

  it('ignores the sign of zero for the round-trip comparison', () => {
    expect(sameRoundTrip(-0, 0)).toBe(true)
  })

  it.each([
    [{ a: [1, { b: null }] }, { a: [1, { b: null }] }, true],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [[1, 2], [1, 2, 3], false],
    [[1, 2], { 0: 1, 1: 2 }, false],
    ['1', 1, false],
    [null, undefined, false],
  ])('%j against %j is %s', (left, right, equal) => {
    expect(sameValue(left, right)).toBe(equal)
  })
})
