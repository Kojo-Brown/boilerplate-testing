/**
 * The words the rules are opinionated about.
 *
 * Kept apart from the rules themselves so `../conventions.ts` can publish them
 * to the README audit without importing an ESLint rule module, and so the one
 * list that decides `pnpm lint`'s behaviour is the one list the documentation
 * is checked against.
 */

/**
 * Openers a test title may not start with, under the `behaviour` scheme.
 *
 * Three families, and it is worth being clear that they are banned for
 * different reasons:
 *
 *   - **Modals** (`should`, `must`, `will`, …). "should return 404" describes
 *     an intention; "returns 404" describes the system. The word costs a
 *     reader nothing and buys them nothing, but it is also the tell for a
 *     test written before anyone knew whether the behaviour was real — the
 *     suite ends up full of sentences nobody has to stand behind.
 *   - **The runner's own name** (`it`, `test`, `tests`, `testing`). Vitest
 *     already prints `it`, so `it('it returns …')` reads as "it it returns".
 *   - **Meta-verbs** (`verify`, `check`, `ensure`, `expect`, `assert`). These
 *     name the activity of testing rather than the behaviour under test, and
 *     a title that describes the test instead of the system is the one that
 *     survives unchanged when the system's behaviour changes underneath it.
 *
 * What is *not* here matters as much. The rule does not require a lowercase
 * first letter: this repository's own titles legitimately open with `POST`,
 * `Sulfuras`, `TypedTest.json()` and `CSS`, and a rule that made proper nouns
 * illegal would be a rule people turn off.
 */
export const BANNED_OPENERS: readonly string[] = [
  'should',
  'shall',
  'must',
  'will',
  'would',
  'can',
  'could',
  'it',
  'test',
  'tests',
  'testing',
  'verify',
  'verifies',
  'check',
  'checks',
  'ensure',
  'ensures',
  'expect',
  'expects',
  'assert',
  'asserts',
]

const BANNED_OPENER_SET = new Set(BANNED_OPENERS)

export function isBannedOpener(word: string): boolean {
  return BANNED_OPENER_SET.has(word)
}

/**
 * The three prefixes of the Given/When/Then scheme, in the exact casing the
 * rule accepts.
 *
 * The casing is not decoration. Vitest prints the ancestry of a failing case
 * as `Given a delivered order > When 40 days pass > then it is denied`, so
 * capitalising the two describes and lowercasing the case makes the failure
 * line one sentence. Allowing any casing would make the rule cheaper to pass
 * and the output worse, which is the wrong trade for a convention whose whole
 * value is in how the report reads.
 */
export const GWT_PREFIXES = {
  given: 'Given ',
  when: 'When ',
  then: 'then ',
} as const

/** Marker comments that divide an Arrange-Act-Assert body, in order. */
export const AAA_PHASES = ['Arrange', 'Act', 'Assert'] as const

export type AaaPhase = (typeof AAA_PHASES)[number]

/**
 * Which phases a body must actually have.
 *
 * `Arrange` is optional because plenty of honest tests have nothing to set up,
 * and a marker over zero statements is noise. `Act` and `Assert` are required:
 * a test with no act is asserting on a fixture, and a test with no assert is
 * asserting nothing at all.
 */
export const REQUIRED_AAA_PHASES: readonly AaaPhase[] = ['Act', 'Assert']

/**
 * Recognise `// Arrange`, `// Act`, `// Assert` and their annotated forms
 * (`// Arrange: two orders, one already refunded`), and nothing else.
 *
 * Anchored at the start of the comment so a sentence that merely mentions
 * arranging is not mistaken for a marker.
 */
export function markerPhase(commentText: string): AaaPhase | null {
  const match = /^(arrange|act|assert)\b/i.exec(commentText.trim())

  if (match === null) {
    return null
  }

  const word = (match[1] ?? '').toLowerCase()

  return AAA_PHASES.find((phase) => phase.toLowerCase() === word) ?? null
}
