/**
 * Twenty-six cases somebody sat down and wrote.
 *
 * The control the fuzzing campaign is measured against, and the reason it is
 * here rather than only in `config.test.ts` is that a comparison needs both
 * sides run against the same corpus of faults. `detection.test.ts` treats this
 * list as a fifth probe: hand it a subject, it reports the first case that
 * fails.
 *
 * ---------------------------------------------------------------------------
 * How these were chosen, which is the honest caveat
 * ---------------------------------------------------------------------------
 * They were written from the schema and from the JSON grammar, before the
 * campaign was run and — this is the part worth being careful about — by the
 * same person who wrote `edits.ts`. `property/README.md` names the same
 * problem and it applies here unchanged: a corpus of faults and a corpus of
 * examples produced by one person's idea of what goes wrong will agree with
 * each other for reasons that have nothing to do with either technique.
 *
 * So the number to read out of the matrix is not "examples caught eleven".
 * It is the *disagreement*: which faults the examples catch that no automated
 * probe does, and which the probes catch that no reasonable list of examples
 * would contain. Both columns turn out to be non-empty, and the first one has
 * exactly one entry.
 *
 * Each case returns a sentence on failure and `null` on success, rather than
 * asserting, so that the same code can be a Vitest suite and a probe. Only the
 * first failure of a subject is reported: what is being measured is whether
 * the fault is noticed at all.
 */

import type { Subject } from './load.ts'
import { isParseRefusal } from './oracles.ts'
import { sameValue } from './equality.ts'

export interface Example {
  /** Reads as a test title, because `config.test.ts` uses it as one. */
  readonly title: string
  readonly run: (subject: Subject) => string | null
}

function parses(subject: Subject, text: string, expected: unknown): string | null {
  let value: unknown

  try {
    value = subject.parseJson(text)
  } catch (error) {
    return `${JSON.stringify(text)} was refused: ${isParseRefusal(error) ? error.code : String(error)}`
  }

  return sameValue(value, expected)
    ? null
    : `${JSON.stringify(text)} parsed to ${JSON.stringify(value)}, expected ${JSON.stringify(expected)}`
}

function refused(subject: Subject, text: string, code: string): string | null {
  try {
    const value: unknown = subject.parseJson(text)

    return `${JSON.stringify(text)} was accepted as ${JSON.stringify(value)}, expected ${code}`
  } catch (error) {
    if (!isParseRefusal(error)) {
      throw error
    }

    return error.code === code ? null : `${JSON.stringify(text)} was refused as ${error.code}, expected ${code}`
  }
}

/** A config with every field valid, which individual cases then spoil. */
export function validDocument(): Record<string, unknown> {
  return {
    name: 'payments',
    retries: 3,
    timeoutMs: 2_500,
    tags: ['eu', 'prod'],
    limits: { enabled: true, ratio: 0.25 },
  }
}

function accepts(subject: Subject, document: unknown, why: string): string | null {
  const result = subject.validateConfig(document)

  return result.ok ? null : `${why} was refused: ${result.errors.map((error) => error.code).join(', ')}`
}

function refuses(subject: Subject, document: unknown, code: string, path: string): string | null {
  const result = subject.validateConfig(document)

  if (result.ok) {
    return `expected ${code} at "${path}", but the document was accepted`
  }

  return result.errors.some((error) => error.code === code && error.path === path)
    ? null
    : `expected ${code} at "${path}", got ${result.errors.map((error) => `${error.code}@${error.path}`).join(', ')}`
}

export const EXAMPLES: readonly Example[] = [
  // -------------------------------------------------------------------------
  // The parser, on documents it must accept
  // -------------------------------------------------------------------------
  {
    title: 'an empty object and an empty array are documents',
    run: (subject) => parses(subject, '{}', {}) ?? parses(subject, '[]', []),
  },
  {
    title: 'whitespace is allowed around every token',
    run: (subject) => parses(subject, ' { "a" : [ 1 , 2 ] } ', { a: [1, 2] }),
  },
  {
    title: 'an exponent may carry an explicit plus sign',
    run: (subject) => parses(subject, '1e+5', 100_000),
  },
  {
    title: 'negative zero keeps its sign',
    run: (subject) => parses(subject, '-0', -0),
  },
  {
    title: 'a four-digit unicode escape becomes one character',
    run: (subject) => parses(subject, '"\\u0041\\u00e9"', 'Aé'),
  },
  {
    title: 'the eight single-character escapes decode',
    run: (subject) => parses(subject, '"\\"\\\\\\/\\b\\f\\n\\r\\t"', '"\\/\b\f\n\r\t'),
  },
  {
    title: 'a repeated key keeps the last value, as every other JSON parser does',
    run: (subject) => parses(subject, '{"a":1,"a":2}', { a: 2 }),
  },
  {
    title: '__proto__ arrives as an ordinary property and not as a prototype',
    run: (subject) => {
      let value: unknown

      try {
        value = subject.parseJson('{"__proto__":{"admin":true}}')
      } catch (error) {
        return `refused: ${isParseRefusal(error) ? error.code : String(error)}`
      }

      if (typeof value !== 'object' || value === null) {
        return `parsed to ${String(value)}`
      }

      if (!Object.hasOwn(value, '__proto__')) {
        return 'the __proto__ key did not become an own property'
      }

      return Object.getPrototypeOf(value) === Object.prototype
        ? null
        : 'the prototype of the parsed object was replaced'
    },
  },
  {
    title: 'nesting is allowed up to the documented limit',
    run: (subject) => parses(subject, `${'['.repeat(64)}1${']'.repeat(64)}`, nest(64)),
  },

  // -------------------------------------------------------------------------
  // The parser, on documents it must refuse
  // -------------------------------------------------------------------------
  {
    title: 'an empty document is refused',
    run: (subject) => refused(subject, '   ', 'EMPTY_INPUT'),
  },
  {
    title: 'a trailing comma in an array is refused',
    run: (subject) => refused(subject, '[1,]', 'UNEXPECTED_CHARACTER'),
  },
  {
    title: 'content after the document is refused',
    run: (subject) => refused(subject, '{} and then some', 'TRAILING_CONTENT'),
  },
  {
    title: 'a leading zero is refused',
    run: (subject) => refused(subject, '010', 'TRAILING_CONTENT'),
  },
  {
    title: 'a raw tab inside a string is refused',
    run: (subject) => refused(subject, '"a\tb"', 'UNESCAPED_CONTROL_CHARACTER'),
  },
  {
    title: 'an unrecognised escape is refused',
    run: (subject) => refused(subject, '"\\x41"', 'INVALID_ESCAPE'),
  },
  {
    title: 'a unicode escape with fewer than four hex digits is refused',
    run: (subject) => refused(subject, '"\\u41"', 'INVALID_UNICODE_ESCAPE'),
  },
  {
    title: 'nesting past the documented limit is refused rather than overflowing the stack',
    run: (subject) => refused(subject, '['.repeat(20_000), 'DEPTH_EXCEEDED'),
  },

  // -------------------------------------------------------------------------
  // The validator
  // -------------------------------------------------------------------------
  {
    title: 'a document with every field in range is accepted',
    run: (subject) => accepts(subject, validDocument(), 'the reference document'),
  },
  {
    title: 'a ratio of exactly 1 is inside the inclusive bound',
    run: (subject) =>
      accepts(subject, { ...validDocument(), limits: { enabled: true, ratio: 1 } }, 'ratio 1'),
  },
  {
    title: 'a name of exactly one character is a name',
    run: (subject) => accepts(subject, { ...validDocument(), name: 'a' }, 'a one-character name'),
  },
  {
    title: 'a name with a character the pattern does not allow is refused',
    run: (subject) =>
      refuses(subject, { ...validDocument(), name: 'svc";DROP' }, 'PATTERN_MISMATCH', 'name'),
  },
  {
    title: 'a fractional retry count is refused',
    run: (subject) => refuses(subject, { ...validDocument(), retries: 2.5 }, 'NOT_AN_INTEGER', 'retries'),
  },
  {
    title: 'a timeout one millisecond over the maximum is refused',
    run: (subject) =>
      refuses(subject, { ...validDocument(), timeoutMs: 60_001 }, 'OUT_OF_RANGE', 'timeoutMs'),
  },
  {
    title: 'a field the schema does not know is refused rather than dropped',
    run: (subject) => refuses(subject, { ...validDocument(), debug: true }, 'UNKNOWN_KEY', 'debug'),
  },
  {
    title: 'a repeated tag is refused',
    run: (subject) =>
      refuses(subject, { ...validDocument(), tags: ['eu', 'eu'] }, 'DUPLICATE_ENTRY', 'tags.1'),
  },
  {
    title: 'validation leaves the document it was given alone',
    run: (subject) => {
      const document = { ...validDocument(), tags: ['prod', 'eu'] }
      const before = structuredClone(document)

      subject.validateConfig(document)

      return sameValue(document, before)
        ? null
        : `the document became ${JSON.stringify(document)}`
    },
  },
]

/** `[[[…1…]]]`, nested to the given depth, for the boundary case above. */
function nest(depth: number): unknown {
  let value: unknown = 1

  for (let level = 0; level < depth; level += 1) {
    value = [value]
  }

  return value
}

/** The first case this subject fails, or `null` if it passes all of them. */
export function firstExampleFailure(subject: Subject): { title: string; detail: string } | null {
  for (const example of EXAMPLES) {
    const failure = example.run(subject)

    if (failure !== null) {
      return { title: example.title, detail: failure }
    }
  }

  return null
}
