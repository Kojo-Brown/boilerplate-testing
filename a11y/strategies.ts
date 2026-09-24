/**
 * The five ways a suite can be pointed at "accessibility in the journey", and
 * the difference between them is the measurement.
 *
 * `per-page-on-load` is the implementation the item's own phrase — *axe per
 * page* — produces, and it is what almost every guide shows: navigate to each
 * URL, `analyze()`, assert `violations` is empty. The four below it each undo
 * exactly one of the four distinct mechanisms by which that implementation
 * under-reports, in the order the mechanisms cost a reader more to discover:
 *
 *   1. it only looks at states a navigation can produce;
 *   2. it only looks at states a navigation can produce *once the data is in*;
 *   3. it throws away `results.incomplete`, and it never runs the rules
 *      axe ships disabled;
 *   4. it cannot express a defect that is not in the DOM at all.
 *
 * Each strategy is a superset of the one above it, which is what makes the
 * score column readable as a cost: the four steps are not alternatives, they
 * are four things that all have to be true before "the journey is accessible"
 * is a sentence anybody should believe.
 *
 * Nothing here decides a verdict. Whether axe reports a given defect is a fact
 * about Chromium recorded in `hazards.ts` and re-derived by `journey.spec.ts`;
 * this file only says which facts each strategy is in a position to observe.
 */

import { HAZARDS, type Hazard } from './hazards.ts'
import { JOURNEY_STATES, type JourneyState } from './states.ts'

export const STRATEGY_NAMES = [
  'per-page-on-load',
  'per-page-settled',
  'per-state',
  'per-state-full-axe',
  'per-state-and-journey',
] as const

export type StrategyName = (typeof STRATEGY_NAMES)[number]

export interface Strategy {
  readonly name: StrategyName
  /** One line, as the README's first table prints it. */
  readonly describes: string
  /** The journey states this strategy ever runs a scan in. */
  readonly observes: readonly JourneyState[]
  /** Whether it turns on the rules axe-core ships `enabled: false`. */
  readonly enablesDisabledRules: boolean
  /** Whether a result in `incomplete` fails it, rather than being discarded. */
  readonly failsOnIncomplete: boolean
  /** Whether it makes assertions about focus, announcement and the keyboard. */
  readonly assertsJourney: boolean
}

/**
 * Both per-page strategies also load `/details` directly, which this list does
 * not name — deliberately, and `journey.spec.ts` checks the claim rather than
 * assuming it. The fixture's script reads `location.pathname`, so that
 * navigation does render the details markup; what it cannot render is the
 * *transition* into it, and both defects filed under `route-changed` are
 * properties of the transition. Scanning the second URL is real and buys
 * nothing, which is a more useful thing to have measured than to have argued.
 */
export const STRATEGIES: readonly Strategy[] = [
  {
    name: 'per-page-on-load',
    describes: 'goto each URL, analyze() at once, assert violations is empty',
    observes: ['landing-load'],
    enablesDisabledRules: false,
    failsOnIncomplete: false,
    assertsJourney: false,
  },
  {
    name: 'per-page-settled',
    describes: 'the same, after waiting for the page’s data to arrive',
    observes: ['landing-load', 'landing-settled'],
    enablesDisabledRules: false,
    failsOnIncomplete: false,
    assertsJourney: false,
  },
  {
    name: 'per-state',
    describes: 'drive the journey, analyze() in every state it passes through',
    observes: JOURNEY_STATES,
    enablesDisabledRules: false,
    failsOnIncomplete: false,
    assertsJourney: false,
  },
  {
    name: 'per-state-full-axe',
    describes: 'per-state, plus the disabled rules turned on and incomplete treated as failure',
    observes: JOURNEY_STATES,
    enablesDisabledRules: true,
    failsOnIncomplete: true,
    assertsJourney: false,
  },
  {
    name: 'per-state-and-journey',
    describes: 'everything above, plus assertions about focus, announcement and the keyboard',
    observes: JOURNEY_STATES,
    enablesDisabledRules: true,
    failsOnIncomplete: true,
    assertsJourney: true,
  },
]

export function strategy(name: StrategyName): Strategy {
  const found = STRATEGIES.find((candidate) => candidate.name === name)

  if (!found) {
    throw new Error(`no strategy named ${name}`)
  }

  return found
}

/**
 * Whether `strategy` finds `hazard`.
 *
 * Two independent conditions, and keeping them separate is what stops the
 * table from being a tautology: the strategy has to be looking at the state
 * the defect lives in, *and* it has to be willing to act on what axe said
 * about it.
 */
export function catches(subject: Strategy, hazard: Hazard): boolean {
  if (!subject.observes.includes(hazard.state)) {
    return false
  }

  switch (hazard.verdict) {
    case 'violation':
      return true
    case 'incomplete':
      return subject.failsOnIncomplete
    case 'disabled':
      return subject.enablesDisabledRules
    case 'none':
      return subject.assertsJourney
  }
}

export function caughtBy(subject: Strategy): readonly Hazard[] {
  return HAZARDS.filter((hazard) => catches(subject, hazard))
}

export function missedBy(subject: Strategy): readonly Hazard[] {
  return HAZARDS.filter((hazard) => !catches(subject, hazard))
}

export function scoreOf(subject: Strategy): number {
  return caughtBy(subject).length
}

// ---------------------------------------------------------------------------
// Rendering
//
// The README's tables are printed from these, not checked against them — the
// discipline `intercept/readme.test.ts` established and `matrix/` continued.
// There is no version of `readme.test.ts` that agrees with a published table
// holding a wrong cell or a row somebody reordered.
// ---------------------------------------------------------------------------

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ]

  return lines.join('\n')
}

/** The catalogue: what is planted where, and what axe does with it. */
export function renderHazardTable(): string {
  return table(
    ['hazard', 'state', 'WCAG', 'axe rule', 'verdict'],
    HAZARDS.map((hazard) => [
      `\`${hazard.id}\``,
      `\`${hazard.state}\``,
      hazard.wcag,
      hazard.rule === null ? '—' : `\`${hazard.rule}\``,
      `\`${hazard.verdict}\``,
    ]),
  )
}

/** The strategies and what each one scores. */
export function renderScoreTable(): string {
  return table(
    ['strategy', 'what it does', 'score'],
    STRATEGIES.map((subject) => [
      `\`${subject.name}\``,
      subject.describes,
      `**${scoreOf(subject)} / ${HAZARDS.length}**`,
    ]),
  )
}

/** The full grid: every hazard against every strategy. */
export function renderMatrix(): string {
  return table(
    ['hazard', ...STRATEGIES.map((subject) => `\`${subject.name}\``)],
    HAZARDS.map((hazard) => [
      `\`${hazard.id}\``,
      ...STRATEGIES.map((subject) => (catches(subject, hazard) ? 'found' : '·')),
    ]),
  )
}
