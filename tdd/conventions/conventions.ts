/**
 * The two conventions, as data.
 *
 * `README.md` is this folder's deliverable, and it makes two kinds of claim
 * that prose is bad at keeping: what each lint rule decides, and — more
 * importantly — what it does not. The second kind is the one that rots
 * dangerously. A README that overstates a linter teaches readers to stop
 * reviewing the thing the linter never checked.
 *
 * So both lists live here, `conventions.test.ts` checks the README against
 * them, and `eslint.config.js` is checked against them too: a rule renamed, or
 * switched off, or documented as deciding something it does not, fails
 * `pnpm test`.
 */

import { BEHAVIOURS, GIVEN_CONTEXTS } from './behaviours'
import { rules } from './eslint-plugin/index'

export const CONVENTION_IDS = ['aaa', 'gwt'] as const

export type ConventionId = (typeof CONVENTION_IDS)[number]

export interface Convention {
  readonly id: ConventionId
  /** Its usual name, spelled the way the README spells it. */
  readonly name: string
  /** Where the three phases are written down. */
  readonly structureLivesIn: string
  /** The file in this folder that demonstrates it. */
  readonly demonstration: string
  /** The rule that enforces it, as ESLint names it. */
  readonly ruleId: string
  /** Everything the rule decides. Each appears verbatim in the README. */
  readonly decides: readonly string[]
  /** The honest limit, in one sentence. Appears verbatim in the README. */
  readonly cannotDecide: string
}

export const CONVENTIONS: readonly Convention[] = [
  {
    id: 'aaa',
    name: 'Arrange-Act-Assert',
    structureLivesIn: 'the body, as marker comments',
    demonstration: 'aaa.test.ts',
    ruleId: 'test-conventions/aaa-structure',
    decides: [
      'the `Act` and `Assert` markers are present',
      'no marker appears twice, and none appears out of order',
      'every marker has at least one statement under it',
      'no `expect(…)` runs before the `Assert` marker',
    ],
    cannotDecide:
      'whether the statements under `// Act` are one action — a body can put three unrelated calls under that marker and no rule reading the text will know.',
  },
  {
    id: 'gwt',
    name: 'Given-When-Then',
    structureLivesIn: 'the titles, as nested describes',
    demonstration: 'gwt.test.ts',
    ruleId: 'test-conventions/title-scheme',
    decides: [
      'the outermost describe opens with `Given `',
      'the level inside a `Given` opens with `When `',
      'there is no third level of describe',
      'every case opens with `then ` and sits inside a `When`',
    ],
    cannotDecide:
      'whether the sentence is true — the rule reads `Given a delivered order` as a well-formed clause, not as a fact about the fixture underneath it.',
  },
]

export function convention(id: ConventionId): Convention {
  const found = CONVENTIONS.find((candidate) => candidate.id === id)

  if (found === undefined) {
    throw new Error(`no convention named ${id}`)
  }

  return found
}

/**
 * The rule the whole repository runs, as opposed to the two demonstrated here.
 *
 * It is deliberately the weaker of the plugin's two: a naming rule can be
 * switched on across 41 existing test files, and a rule about the shape of
 * every test body cannot.
 */
export const REPO_WIDE_RULE = 'test-conventions/title-scheme'

/** Every rule id this plugin publishes, as ESLint spells them. */
export const RULE_IDS: readonly string[] = Object.keys(rules).map(
  (name) => `test-conventions/${name}`,
)

/**
 * How much scaffolding each shape needs for the same eight behaviours.
 *
 * Counted from `behaviours.ts` rather than typed into the README, because the
 * ratio is the argument rather than an illustration of it: Given/When/Then
 * buys its structure with blocks, and on this feature every one of its `When`
 * blocks turns out to wrap exactly one case.
 */
export const SHAPE_COUNTS = {
  behaviours: BEHAVIOURS.length,
  givenBlocks: GIVEN_CONTEXTS.length,
  whenBlocks: new Set(BEHAVIOURS.map((entry) => `${entry.gwt.given}|${entry.gwt.when}`)).size,
  /** `When` blocks that wrap exactly one case. */
  soleOccupantWhenBlocks: (() => {
    const occupancy = new Map<string, number>()

    for (const entry of BEHAVIOURS) {
      const key = `${entry.gwt.given}|${entry.gwt.when}`

      occupancy.set(key, (occupancy.get(key) ?? 0) + 1)
    }

    return [...occupancy.values()].filter((count) => count === 1).length
  })(),
  /** `Given` blocks that wrap exactly one case. */
  soleOccupantGivenBlocks: (() => {
    const occupancy = new Map<string, number>()

    for (const entry of BEHAVIOURS) {
      occupancy.set(entry.gwt.given, (occupancy.get(entry.gwt.given) ?? 0) + 1)
    }

    return [...occupancy.values()].filter((count) => count === 1).length
  })(),
} as const
