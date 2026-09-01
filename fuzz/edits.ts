/**
 * Sixteen single-behaviour changes to `config.ts`: ten in the parser, six in
 * the validator.
 *
 * ---------------------------------------------------------------------------
 * Why the corpus is split down the middle
 * ---------------------------------------------------------------------------
 * The split is the experiment. A parser implements somebody else's grammar, so
 * `JSON.parse` is a free, exact, complete oracle for it — the strongest kind
 * of oracle there is, and one that costs a line to write. A validator
 * implements *this program's* rules, so there is no reference to differ
 * against and no amount of cleverness will produce one.
 *
 * Every guide to fuzzing demonstrates on a parser. `detection.test.ts` runs
 * both halves through the same probes to show what that demonstration hides:
 * the technique's headline result is a property of the subject, not of the
 * technique, and the half of a real service that fuzzing is worst at is the
 * half where the bugs are business logic.
 *
 * ---------------------------------------------------------------------------
 * Why edits to the real source
 * ---------------------------------------------------------------------------
 * The same reason `snapshot/edits.ts` and `tdd/characterisation/mutants.ts` do
 * it. A copy of the subject rots the first time the original changes, and
 * nothing says so; a flag threaded through the real implementation puts the
 * fault list into production code. An edit is neither: `applyEdits` requires
 * every `from` below to match exactly once in the file on disk, so a change to
 * `config.ts` that invalidates one of these fails the suite loudly instead of
 * quietly measuring nothing.
 *
 * ---------------------------------------------------------------------------
 * Why some of these are false rejections
 * ---------------------------------------------------------------------------
 * `EXPONENT_PLUS_REJECTED` and `RATIO_UPPER_BOUND_EXCLUSIVE` refuse input that
 * is perfectly good. They are here because they are the faults an oracle built
 * out of invariants cannot see by construction: "everything this accepts
 * satisfies the schema" is trivially true of a function that accepts nothing.
 * A corpus of only over-acceptance bugs would report that invariant oracles
 * are stronger than they are, and it is the mistake most comparisons of this
 * kind make.
 */

export const VARIANT_IDS = [
  // ---- parser -----------------------------------------------------------
  'TRAILING_COMMA_IN_ARRAY_ACCEPTED',
  'TRAILING_CONTENT_IGNORED',
  'LEADING_ZERO_ACCEPTED',
  'EXPONENT_PLUS_REJECTED',
  'CONTROL_CHARACTER_ACCEPTED',
  'UNKNOWN_ESCAPE_PASSTHROUGH',
  'SHORT_UNICODE_ESCAPE',
  'DUPLICATE_KEY_FIRST_WINS',
  'PROTOTYPE_POLLUTION',
  'NO_DEPTH_LIMIT',
  // ---- validator --------------------------------------------------------
  'NAME_PATTERN_UNANCHORED',
  'INTEGER_CHECK_DROPPED',
  'INTEGER_UPPER_BOUND_UNCHECKED',
  'RATIO_UPPER_BOUND_EXCLUSIVE',
  'UNKNOWN_KEY_IGNORED',
  'TAGS_SORTED_IN_PLACE',
] as const

export type VariantId = (typeof VARIANT_IDS)[number]

/** Which half of the subject the fault lives in. */
export type VariantHalf = 'parser' | 'validator'

/**
 * Whether the fault makes the subject too generous or too strict.
 *
 * Worth recording separately from the half, because it is what decides which
 * *kind* of oracle can see a fault at all, and the two do not line up: there
 * is an over-strict fault on each side.
 */
export type VariantDirection = 'over-accepts' | 'over-rejects' | 'wrong-value'

interface Edit {
  readonly from: string
  readonly to: string
}

export interface Variant {
  readonly id: VariantId
  readonly half: VariantHalf
  readonly direction: VariantDirection
  /** One line, as it would read in a pull request. */
  readonly description: string
  readonly edits: readonly Edit[]
}

export const VARIANTS: readonly Variant[] = [
  // -------------------------------------------------------------------------
  // Parser
  // -------------------------------------------------------------------------
  {
    id: 'TRAILING_COMMA_IN_ARRAY_ACCEPTED',
    half: 'parser',
    direction: 'over-accepts',
    description: 'an array may end with a comma, as in JavaScript but not in JSON',
    edits: [
      {
        from: `      if (separator === ',') {
        index += 1

        continue
      }

      if (separator === ']') {`,
        to: `      if (separator === ',') {
        index += 1
        skipWhitespace()

        if (source[index] === ']') {
          index += 1

          return items
        }

        continue
      }

      if (separator === ']') {`,
      },
    ],
  },
  {
    id: 'TRAILING_CONTENT_IGNORED',
    half: 'parser',
    direction: 'over-accepts',
    description: 'anything after the first value is discarded, so `{} DROP TABLE` parses',
    edits: [
      {
        from: `  if (index < length) {
    fail('TRAILING_CONTENT', \`unexpected "\${source[index]}" after the document\`)
  }

`,
        to: '',
      },
    ],
  },
  {
    id: 'LEADING_ZERO_ACCEPTED',
    half: 'parser',
    direction: 'over-accepts',
    description: 'numbers may carry leading zeros, so `010` parses as ten',
    edits: [
      {
        from: `    if (source[index] === '0') {
      index += 1
    } else if (DIGITS.has(source[index] as string)) {`,
        to: `    if (DIGITS.has(source[index] as string)) {`,
      },
    ],
  },
  {
    id: 'EXPONENT_PLUS_REJECTED',
    half: 'parser',
    direction: 'over-rejects',
    description: 'a positive exponent sign is refused, so `1e+5` fails to parse',
    edits: [
      {
        from: `      if (source[index] === '+' || source[index] === '-') {`,
        to: `      if (source[index] === '-') {`,
      },
    ],
  },
  {
    id: 'CONTROL_CHARACTER_ACCEPTED',
    half: 'parser',
    direction: 'over-accepts',
    description: 'raw tabs, newlines and escapes may sit unescaped inside a string',
    edits: [{ from: '      if (code < 0x20) {', to: '      if (code < 0x09) {' }],
  },
  {
    id: 'UNKNOWN_ESCAPE_PASSTHROUGH',
    half: 'parser',
    direction: 'over-accepts',
    description: 'an unrecognised escape yields the character itself, so `\\x` is `x`',
    edits: [
      {
        from: `        if (replacement === undefined) {
          fail('INVALID_ESCAPE', \`\\\\\${escaped} is not an escape sequence\`)
        }

        out += replacement`,
        to: `        out += replacement ?? escaped`,
      },
    ],
  },
  {
    // Three edits, one behaviour: the escape reads two hex digits instead of
    // four. Splitting a single change across the lines that implement it is
    // what `snapshot/edits.ts` does too — what must stay true is that the
    // subject differs in one *behaviour*, not that it differs in one line.
    id: 'SHORT_UNICODE_ESCAPE',
    half: 'parser',
    direction: 'wrong-value',
    description: '`\\u` consumes two hex digits instead of four, so `\\u0041` is NUL then "41"',
    edits: [
      {
        from: '          const hex = source.slice(index + 2, index + 6)',
        to: '          const hex = source.slice(index + 2, index + 4)',
      },
      { from: '          if (hex.length < 4 ||', to: '          if (hex.length < 2 ||' },
      {
        from: `          out += String.fromCharCode(Number.parseInt(hex, 16))
          index += 6`,
        to: `          out += String.fromCharCode(Number.parseInt(hex, 16))
          index += 4`,
      },
    ],
  },
  {
    id: 'DUPLICATE_KEY_FIRST_WINS',
    half: 'parser',
    direction: 'wrong-value',
    description: 'a repeated object key keeps the first value; every other parser keeps the last',
    edits: [
      {
        from: `        members[key] = value
      }`,
        to: `        if (!Object.hasOwn(members, key)) {
          members[key] = value
        }
      }`,
      },
    ],
  },
  {
    // The security bug of the sixteen. `{"__proto__": {"admin": true}}` stops
    // being data and becomes a change to the object's prototype, which is
    // invisible in every field-by-field comparison of the result.
    id: 'PROTOTYPE_POLLUTION',
    half: 'parser',
    direction: 'wrong-value',
    description: 'a `__proto__` key sets the prototype instead of becoming a property',
    edits: [
      {
        from: `      if (key === '__proto__') {
        // \`members[key] = value\` would set the object's prototype instead of
        // adding a property to it, which is a real vulnerability and also a
        // disagreement with \`JSON.parse\` — that creates an ordinary own
        // property here, and so must this. \`PROTOTYPE_POLLUTION\` is the
        // variant that deletes these three lines.
        Object.defineProperty(members, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      } else {
        members[key] = value
      }`,
        to: `      members[key] = value`,
      },
    ],
  },
  {
    // The only fault in the corpus that takes the process down rather than
    // returning a wrong answer, and therefore the only one a crash-only
    // campaign can find. It is also the one the differential oracle is
    // explicitly told to ignore, because the depth limit is a *declared*
    // divergence from `JSON.parse`. See `oracles.ts`.
    id: 'NO_DEPTH_LIMIT',
    half: 'parser',
    direction: 'over-accepts',
    description: 'the nesting guard is gone, so deep input overflows the stack',
    edits: [
      {
        from: `      // The guard sits here rather than at the top of the function so that
      // \`MAX_DEPTH\` counts containers, which is what "nested 64 deep" means to
      // a reader. A check over every value would make a scalar cost a level
      // and put the real limit at 63.
      if (depth > MAX_DEPTH) {
        fail('DEPTH_EXCEEDED', \`nesting deeper than \${MAX_DEPTH} levels\`)
      }

`,
        to: '',
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Validator
  // -------------------------------------------------------------------------
  {
    id: 'NAME_PATTERN_UNANCHORED',
    half: 'validator',
    direction: 'over-accepts',
    description: 'the name pattern loses its `$`, so `svc"; DROP` passes as `svc`',
    edits: [
      {
        from: 'export const NAME_PATTERN = /^[a-z][a-z0-9-]*$/',
        to: 'export const NAME_PATTERN = /^[a-z][a-z0-9-]*/',
      },
    ],
  },
  {
    id: 'INTEGER_CHECK_DROPPED',
    half: 'validator',
    direction: 'over-accepts',
    description: 'retries and timeoutMs may be fractional, so `2.5` retries is a valid config',
    edits: [
      {
        from: `  if (!Number.isInteger(raw)) {
    reject('NOT_AN_INTEGER', key, \`\${key} must be a whole number\`)

    return
  }

`,
        to: '',
      },
    ],
  },
  {
    id: 'INTEGER_UPPER_BOUND_UNCHECKED',
    half: 'validator',
    direction: 'over-accepts',
    description: 'half the range check is gone, so a ten-minute timeout is accepted',
    edits: [
      {
        from: '  if (raw < range.min || raw > range.max) {',
        to: '  if (raw < range.min) {',
      },
    ],
  },
  {
    id: 'RATIO_UPPER_BOUND_EXCLUSIVE',
    half: 'validator',
    direction: 'over-rejects',
    description: 'the documented inclusive upper bound is enforced exclusively, so ratio 1 fails',
    edits: [
      {
        from: '    } else if (ratio < RATIO_RANGE.min || ratio > RATIO_RANGE.max) {',
        to: '    } else if (ratio < RATIO_RANGE.min || ratio >= RATIO_RANGE.max) {',
      },
    ],
  },
  {
    id: 'UNKNOWN_KEY_IGNORED',
    half: 'validator',
    direction: 'over-accepts',
    description: 'unknown fields are ignored, so a typo silently drops the setting it meant',
    edits: [
      {
        from: `  for (const key of Object.keys(value)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      reject('UNKNOWN_KEY', key, \`"\${key}" is not a config field\`)
    }
  }

`,
        to: '',
      },
    ],
  },
  {
    // The fault that only exists below `loadConfig`. Nothing observable
    // changes when the pipeline parses its own input, because the array being
    // reordered was allocated a microsecond earlier and belongs to nobody. It
    // is a real bug for every caller that validates an object it still holds,
    // and only a probe that calls `validateConfig` directly can see it.
    id: 'TAGS_SORTED_IN_PLACE',
    half: 'validator',
    direction: 'wrong-value',
    description: "tags are sorted in place, reordering the caller's own array",
    edits: [{ from: '      tags: [...accepted.tags],', to: '      tags: accepted.tags.sort(),' }],
  },
]

const BY_ID = new Map(VARIANTS.map((variant) => [variant.id, variant]))

export function variantNamed(id: VariantId): Variant {
  const variant = BY_ID.get(id)

  if (variant === undefined) {
    throw new Error(`no variant named ${id}`)
  }

  return variant
}

/**
 * Apply a variant's edits to the source, insisting each matches exactly once.
 *
 * Exactly once in both directions. Zero matches means the edit has rotted
 * against a change to `config.ts` and the variant is no longer the bug it
 * claims to be. More than one means the edit is ambiguous and the variant may
 * be a different bug from run to run. Both are the same failure — a
 * measurement that has quietly stopped measuring what it says — so both throw.
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let result = source

  for (const edit of edits) {
    const occurrences = result.split(edit.from).length - 1

    if (occurrences !== 1) {
      throw new Error(
        `edit matched ${occurrences} times, expected exactly 1:\n${edit.from.slice(0, 120)}`,
      )
    }

    result = result.replace(edit.from, () => edit.to)
  }

  return result
}
