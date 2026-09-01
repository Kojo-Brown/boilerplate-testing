/**
 * The subject: a strict JSON parser and a config validator, in that order.
 *
 * This is the shape almost every service has at its edge — bytes arrive, a
 * parser turns them into a value, a validator decides whether the value is
 * one this program can act on — and it is the shape fuzzing is aimed at,
 * because both halves are total functions over hostile input and neither is
 * allowed to have an opinion about what it is given.
 *
 * Two halves, deliberately, because they fail in different ways and are
 * *checkable* in different ways. The parser implements a published grammar, so
 * a reference implementation exists and disagreement with it is a bug by
 * definition. The validator implements this program's own rules, so no
 * reference exists, will ever exist, or could be written without writing the
 * validator again. `README.md` is mostly about what that difference costs.
 *
 * ---------------------------------------------------------------------------
 * The contract a fuzzer is entitled to rely on
 * ---------------------------------------------------------------------------
 *   1. `loadConfig` is total. For every string — every string, including
 *      invalid UTF-16, 40KB of NUL bytes and 30,000 nested arrays — it
 *      returns. It does not throw, and it does not recurse without limit.
 *   2. `loadConfig` never returns `ok: true` with a value that violates the
 *      schema documented below.
 *   3. `parseJson` agrees with `JSON.parse` on every input, accepting exactly
 *      what it accepts and producing an equal value, with one declared
 *      exception: input nested deeper than `MAX_DEPTH`, which this parser
 *      rejects and `JSON.parse` does not. That exception is the entire reason
 *      rule 1 can be kept, and `oracles.ts` documents what it costs.
 *   4. `validateConfig` does not modify the value it is given.
 *
 * Every rule above is a thing a fuzzer can check without a human deciding what
 * the right answer was for a particular input, which is the property that
 * makes fuzzing worth running at all. A rule nobody wrote down here is a rule
 * no campaign in this directory can find a bug in — measured, in
 * `detection.test.ts`, as the one fault that only a hand-written example
 * catches.
 *
 * ---------------------------------------------------------------------------
 * Why the file has no imports
 * ---------------------------------------------------------------------------
 * `load.ts` compiles sixteen single-behaviour variants of this file by editing
 * its source text and importing the result out of a temporary directory. A
 * relative import would not resolve from there. Keeping the subject
 * self-contained is the price of measuring faults against the real source
 * rather than against a copy that rots.
 */

// ---------------------------------------------------------------------------
// JSON values
// ---------------------------------------------------------------------------

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/**
 * How deep a document may nest before the parser refuses it.
 *
 * A recursive-descent parser with no limit is a stack overflow with a grammar
 * attached: `'['.repeat(30000)` is 30KB and takes the process down. Sixty-four
 * is well past anything a configuration file has and well short of the
 * engine's stack, and rejecting beyond it is the difference between a
 * `RangeError` escaping into a request handler and a 400 response.
 *
 * This is the one place the parser knowingly disagrees with `JSON.parse`, and
 * `oracles.ts#differential` has to be told about it. Every entry on a list
 * like that is a hole in an oracle, and `NO_DEPTH_LIMIT` is the fault that
 * lives in this one.
 */
export const MAX_DEPTH = 64

/**
 * Every way the parser can refuse an input.
 *
 * A closed list, exported, because it is what `reach.ts` counts. "Did the
 * fuzzer find a bug" is the question everyone asks of a campaign and the one
 * it is worst at answering; "which of the parser's thirteen refusals did this
 * generator ever manage to provoke" is answerable, cheap, and the number that
 * actually distinguishes the generators from each other.
 */
export const PARSE_ERROR_CODES = [
  'EMPTY_INPUT',
  'UNEXPECTED_CHARACTER',
  'UNEXPECTED_END',
  'TRAILING_CONTENT',
  'INVALID_NUMBER',
  'INVALID_ESCAPE',
  'INVALID_UNICODE_ESCAPE',
  'UNESCAPED_CONTROL_CHARACTER',
  'UNTERMINATED_STRING',
  'EXPECTED_KEY',
  'EXPECTED_COLON',
  'EXPECTED_COMMA_OR_CLOSE',
  'DEPTH_EXCEEDED',
] as const

export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number]

/**
 * What the parser throws, carrying where and why.
 *
 * Consumers must not use `instanceof` on this: `load.ts` imports sixteen
 * separate copies of this module, and a `JsonParseError` from one of them is
 * not an `instanceof` the class from another. `oracles.ts` recognises it
 * structurally instead, which is the only thing that works across module
 * copies and — as it happens — the only thing that works across a package
 * boundary in production either.
 */
export class JsonParseError extends Error {
  readonly code: ParseErrorCode
  readonly offset: number

  constructor(code: ParseErrorCode, offset: number, detail: string) {
    super(`${code} at offset ${offset}: ${detail}`)
    this.name = 'JsonParseError'
    this.code = code
    this.offset = offset
  }
}

const DIGITS = new Set('0123456789')
const HEX_DIGITS = new Set('0123456789abcdefABCDEF')

/** JSON's whitespace, which is four characters and not `\v`, `\f` or U+00A0. */
const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

const SINGLE_CHARACTER_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/**
 * Parse a JSON document, strictly.
 *
 * Strictly means: no comments, no trailing commas, no leading zeros, no
 * unquoted keys, no single quotes, no raw control characters inside strings,
 * no trailing content, and no `NaN` or `Infinity`. Every one of those is a
 * thing some JSON parser somewhere accepts, and every one of them is a place
 * two parsers reading the same bytes reach different conclusions — which is
 * the class of bug this directory is about.
 */
export function parseJson(text: string): Json {
  const source = text
  const length = source.length
  let index = 0

  function fail(code: ParseErrorCode, detail: string): never {
    throw new JsonParseError(code, index, detail)
  }

  function skipWhitespace(): void {
    while (index < length && WHITESPACE.has(source[index] as string)) {
      index += 1
    }
  }

  function scanString(): string {
    // The opening quote has been seen by the caller but not consumed.
    index += 1

    let out = ''

    for (;;) {
      if (index >= length) {
        fail('UNTERMINATED_STRING', 'the document ended inside a string')
      }

      const character = source[index] as string

      if (character === '"') {
        index += 1

        return out
      }

      if (character === '\\') {
        const escaped = source[index + 1]

        if (escaped === undefined) {
          fail('UNTERMINATED_STRING', 'the document ended inside an escape sequence')
        }

        if (escaped === 'u') {
          const hex = source.slice(index + 2, index + 6)

          if (hex.length < 4 || ![...hex].every((digit) => HEX_DIGITS.has(digit))) {
            fail('INVALID_UNICODE_ESCAPE', `\\u must be followed by four hex digits, got "${hex}"`)
          }

          out += String.fromCharCode(Number.parseInt(hex, 16))
          index += 6

          continue
        }

        const replacement = SINGLE_CHARACTER_ESCAPES[escaped]

        if (replacement === undefined) {
          fail('INVALID_ESCAPE', `\\${escaped} is not an escape sequence`)
        }

        out += replacement
        index += 2

        continue
      }

      const code = source.charCodeAt(index)

      if (code < 0x20) {
        fail(
          'UNESCAPED_CONTROL_CHARACTER',
          `U+${code.toString(16).padStart(4, '0')} must be escaped inside a string`,
        )
      }

      out += character
      index += 1
    }
  }

  function scanNumber(): number {
    const start = index

    if (source[index] === '-') {
      index += 1
    }

    if (source[index] === '0') {
      index += 1
    } else if (DIGITS.has(source[index] as string)) {
      while (DIGITS.has(source[index] as string)) {
        index += 1
      }
    } else {
      fail('INVALID_NUMBER', 'a number needs at least one digit before the decimal point')
    }

    if (source[index] === '.') {
      index += 1

      if (!DIGITS.has(source[index] as string)) {
        fail('INVALID_NUMBER', 'a decimal point needs at least one digit after it')
      }

      while (DIGITS.has(source[index] as string)) {
        index += 1
      }
    }

    if (source[index] === 'e' || source[index] === 'E') {
      index += 1

      if (source[index] === '+' || source[index] === '-') {
        index += 1
      }

      if (!DIGITS.has(source[index] as string)) {
        fail('INVALID_NUMBER', 'an exponent needs at least one digit')
      }

      while (DIGITS.has(source[index] as string)) {
        index += 1
      }
    }

    // `Number` rather than a hand-rolled accumulation. The grammar above has
    // already decided what is a number; the value of a number that matches the
    // grammar is exactly what the engine says it is, and computing it a second
    // way could only introduce a disagreement with `JSON.parse` that has no
    // upside.
    return Number(source.slice(start, index))
  }

  function parseLiteral(word: string, value: Json): Json {
    if (source.slice(index, index + word.length) !== word) {
      fail('UNEXPECTED_CHARACTER', `expected ${word}`)
    }

    index += word.length

    return value
  }

  function parseArray(depth: number): Json[] {
    // The opening bracket has been seen but not consumed.
    index += 1

    const items: Json[] = []

    skipWhitespace()

    if (source[index] === ']') {
      index += 1

      return items
    }

    for (;;) {
      items.push(parseValue(depth + 1))
      skipWhitespace()

      const separator = source[index]

      if (separator === ',') {
        index += 1

        continue
      }

      if (separator === ']') {
        index += 1

        return items
      }

      if (separator === undefined) {
        fail('UNEXPECTED_END', 'the document ended inside an array')
      }

      fail('EXPECTED_COMMA_OR_CLOSE', `expected "," or "]" inside an array, got "${separator}"`)
    }
  }

  function parseObject(depth: number): { [key: string]: Json } {
    // The opening brace has been seen but not consumed.
    index += 1

    const members: { [key: string]: Json } = {}

    skipWhitespace()

    if (source[index] === '}') {
      index += 1

      return members
    }

    for (;;) {
      skipWhitespace()

      if (source[index] !== '"') {
        if (index >= length) {
          fail('UNEXPECTED_END', 'the document ended inside an object')
        }

        fail('EXPECTED_KEY', 'an object key must be a quoted string')
      }

      const key = scanString()

      skipWhitespace()

      if (source[index] !== ':') {
        fail('EXPECTED_COLON', 'an object key must be followed by ":"')
      }

      index += 1

      const value = parseValue(depth + 1)

      if (key === '__proto__') {
        // `members[key] = value` would set the object's prototype instead of
        // adding a property to it, which is a real vulnerability and also a
        // disagreement with `JSON.parse` — that creates an ordinary own
        // property here, and so must this. `PROTOTYPE_POLLUTION` is the
        // variant that deletes these three lines.
        Object.defineProperty(members, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      } else {
        members[key] = value
      }

      skipWhitespace()

      const separator = source[index]

      if (separator === ',') {
        index += 1

        continue
      }

      if (separator === '}') {
        index += 1

        return members
      }

      if (separator === undefined) {
        fail('UNEXPECTED_END', 'the document ended inside an object')
      }

      fail('EXPECTED_COMMA_OR_CLOSE', `expected "," or "}" inside an object, got "${separator}"`)
    }
  }

  function parseValue(depth: number): Json {
    skipWhitespace()

    const character = source[index]

    if (character === undefined) {
      fail('UNEXPECTED_END', 'a value was expected')
    }

    if (character === '{' || character === '[') {
      // The guard sits here rather than at the top of the function so that
      // `MAX_DEPTH` counts containers, which is what "nested 64 deep" means to
      // a reader. A check over every value would make a scalar cost a level
      // and put the real limit at 63.
      if (depth > MAX_DEPTH) {
        fail('DEPTH_EXCEEDED', `nesting deeper than ${MAX_DEPTH} levels`)
      }

      return character === '{' ? parseObject(depth) : parseArray(depth)
    }

    if (character === '"') {
      return scanString()
    }

    if (character === '-' || DIGITS.has(character)) {
      return scanNumber()
    }

    if (character === 't') {
      return parseLiteral('true', true)
    }

    if (character === 'f') {
      return parseLiteral('false', false)
    }

    if (character === 'n') {
      return parseLiteral('null', null)
    }

    fail('UNEXPECTED_CHARACTER', `"${character}" cannot begin a value`)
  }

  skipWhitespace()

  if (index >= length) {
    fail('EMPTY_INPUT', 'a JSON document must contain a value')
  }

  const value = parseValue(1)

  skipWhitespace()

  if (index < length) {
    fail('TRAILING_CONTENT', `unexpected "${source[index]}" after the document`)
  }

  return value
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

/**
 * The configuration this service accepts.
 *
 * Small on purpose. Every field below exists because it fails differently:
 * a pattern, two integer ranges, a float range with an inclusive upper bound
 * that is easy to get wrong, a bounded unique collection, and one level of
 * nesting so that a path in an error message has more than one segment.
 */
export interface Config {
  readonly name: string
  readonly retries: number
  readonly timeoutMs: number
  readonly tags: readonly string[]
  readonly limits: {
    readonly enabled: boolean
    readonly ratio: number
  }
}

export const NAME_PATTERN = /^[a-z][a-z0-9-]*$/
export const NAME_MAX_LENGTH = 64
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const MAX_TAGS = 8
export const RETRIES_RANGE = { min: 0, max: 10 } as const
export const TIMEOUT_MS_RANGE = { min: 1, max: 60_000 } as const
export const RATIO_RANGE = { min: 0, max: 1 } as const

/** Every key the schema knows, and therefore every key it permits. */
export const CONFIG_KEYS = ['name', 'retries', 'timeoutMs', 'tags', 'limits'] as const
export const LIMITS_KEYS = ['enabled', 'ratio'] as const

/**
 * Every way the validator can refuse a value.
 *
 * The parser's list is dictated by a published grammar; this one is dictated
 * by nothing but this program's own rules, which is exactly why no reference
 * implementation can check it. Counted by `reach.ts` alongside the parse
 * codes, where the interesting result is that the generator which reaches
 * almost all of one list reaches almost none of the other.
 */
export const VALIDATION_ERROR_CODES = [
  'NOT_AN_OBJECT',
  'MISSING_KEY',
  'UNKNOWN_KEY',
  'WRONG_TYPE',
  'PATTERN_MISMATCH',
  'NOT_AN_INTEGER',
  'OUT_OF_RANGE',
  'TOO_LONG',
  'DUPLICATE_ENTRY',
] as const

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number]

export interface ValidationError {
  readonly code: ValidationErrorCode
  /** Dotted path to the offending field, `''` for the document itself. */
  readonly path: string
  readonly message: string
}

export type ValidationResult =
  | { readonly ok: true; readonly value: Config }
  | { readonly ok: false; readonly errors: readonly ValidationError[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check a parsed value against the schema, collecting every problem.
 *
 * Collecting rather than failing fast, for two reasons that both matter here.
 * A caller gets one round trip instead of five, which is the ordinary
 * argument; and an oracle gets to assert that a rejected document names *the*
 * offending field rather than the first one, which is the property that stops
 * a validator degenerating into `return { ok: false }`.
 */
export function validateConfig(value: unknown): ValidationResult {
  const errors: ValidationError[] = []

  const reject = (code: ValidationErrorCode, path: string, message: string): void => {
    errors.push({ code, path, message })
  }

  if (!isPlainObject(value)) {
    reject('NOT_AN_OBJECT', '', `a config must be a JSON object, got ${describe(value)}`)

    return { ok: false, errors }
  }

  for (const key of Object.keys(value)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      reject('UNKNOWN_KEY', key, `"${key}" is not a config field`)
    }
  }

  for (const key of CONFIG_KEYS) {
    if (!Object.hasOwn(value, key)) {
      reject('MISSING_KEY', key, `"${key}" is required`)
    }
  }

  const name = value.name

  if (Object.hasOwn(value, 'name')) {
    if (typeof name !== 'string') {
      reject('WRONG_TYPE', 'name', `name must be a string, got ${describe(name)}`)
    } else if (name.length > NAME_MAX_LENGTH) {
      reject('TOO_LONG', 'name', `name must be at most ${NAME_MAX_LENGTH} characters`)
    } else if (!NAME_PATTERN.test(name)) {
      reject('PATTERN_MISMATCH', 'name', `name must match ${String(NAME_PATTERN)}`)
    }
  }

  checkInteger(value, 'retries', RETRIES_RANGE, reject)
  checkInteger(value, 'timeoutMs', TIMEOUT_MS_RANGE, reject)

  const rawTags = value.tags

  if (Object.hasOwn(value, 'tags')) {
    if (!Array.isArray(rawTags)) {
      reject('WRONG_TYPE', 'tags', `tags must be an array, got ${describe(rawTags)}`)
    } else if (rawTags.length > MAX_TAGS) {
      reject('TOO_LONG', 'tags', `at most ${MAX_TAGS} tags are allowed`)
    } else {
      const seen = new Set<string>()

      rawTags.forEach((tag, position) => {
        if (typeof tag !== 'string') {
          reject('WRONG_TYPE', `tags.${position}`, `a tag must be a string, got ${describe(tag)}`)

          return
        }

        if (!TAG_PATTERN.test(tag)) {
          reject('PATTERN_MISMATCH', `tags.${position}`, `a tag must match ${String(TAG_PATTERN)}`)

          return
        }

        if (seen.has(tag)) {
          reject('DUPLICATE_ENTRY', `tags.${position}`, `"${tag}" appears more than once`)
        }

        seen.add(tag)
      })
    }
  }

  const limits = value.limits

  if (Object.hasOwn(value, 'limits')) {
    if (!isPlainObject(limits)) {
      reject('WRONG_TYPE', 'limits', `limits must be an object, got ${describe(limits)}`)
    } else {
      for (const key of Object.keys(limits)) {
        if (!(LIMITS_KEYS as readonly string[]).includes(key)) {
          reject('UNKNOWN_KEY', `limits.${key}`, `"${key}" is not a limits field`)
        }
      }

      if (!Object.hasOwn(limits, 'enabled')) {
        reject('MISSING_KEY', 'limits.enabled', '"enabled" is required')
      } else if (typeof limits.enabled !== 'boolean') {
        reject(
          'WRONG_TYPE',
          'limits.enabled',
          `enabled must be a boolean, got ${describe(limits.enabled)}`,
        )
      }

      const ratio = limits.ratio

      if (!Object.hasOwn(limits, 'ratio')) {
        reject('MISSING_KEY', 'limits.ratio', '"ratio" is required')
      } else if (typeof ratio !== 'number') {
        reject('WRONG_TYPE', 'limits.ratio', `ratio must be a number, got ${describe(ratio)}`)
      } else if (ratio < RATIO_RANGE.min || ratio > RATIO_RANGE.max) {
        reject(
          'OUT_OF_RANGE',
          'limits.ratio',
          `ratio must be between ${RATIO_RANGE.min} and ${RATIO_RANGE.max} inclusive`,
        )
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const accepted = value as unknown as Config

  // A fresh array rather than the caller's. `validateConfig` is not entitled
  // to touch what it was handed — rule 4 of the contract — and the copy is
  // what keeps that true when a later change wants the tags sorted.
  return {
    ok: true,
    value: {
      name: accepted.name,
      retries: accepted.retries,
      timeoutMs: accepted.timeoutMs,
      tags: [...accepted.tags],
      limits: { enabled: accepted.limits.enabled, ratio: accepted.limits.ratio },
    },
  }
}

function checkInteger(
  value: Record<string, unknown>,
  key: 'retries' | 'timeoutMs',
  range: { readonly min: number; readonly max: number },
  reject: (code: ValidationErrorCode, path: string, message: string) => void,
): void {
  if (!Object.hasOwn(value, key)) {
    return
  }

  const raw = value[key]

  if (typeof raw !== 'number') {
    reject('WRONG_TYPE', key, `${key} must be a number, got ${describe(raw)}`)

    return
  }

  if (!Number.isInteger(raw)) {
    reject('NOT_AN_INTEGER', key, `${key} must be a whole number`)

    return
  }

  if (raw < range.min || raw > range.max) {
    reject('OUT_OF_RANGE', key, `${key} must be between ${range.min} and ${range.max} inclusive`)
  }
}

/** A short, safe description of an arbitrary value, for an error message. */
function describe(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'an array'
  }

  return typeof value
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export type LoadResult =
  | { readonly ok: true; readonly value: Config }
  | {
      readonly ok: false
      readonly stage: 'parse'
      readonly code: ParseErrorCode
      readonly message: string
    }
  | {
      readonly ok: false
      readonly stage: 'validate'
      readonly errors: readonly ValidationError[]
    }

/**
 * Text in, a decision out, always.
 *
 * The one function a fuzzer needs, and the only one with a *total* contract:
 * whatever the bytes are, this returns. Everything the campaign in this
 * directory does is an elaboration of calling it in a loop and asking a
 * better question than "did it throw".
 */
export function loadConfig(text: string): LoadResult {
  let parsed: Json

  try {
    parsed = parseJson(text)
  } catch (error) {
    if (error instanceof JsonParseError) {
      return { ok: false, stage: 'parse', code: error.code, message: error.message }
    }

    throw error
  }

  const validated = validateConfig(parsed)

  if (!validated.ok) {
    return { ok: false, stage: 'validate', errors: validated.errors }
  }

  return { ok: true, value: validated.value }
}
