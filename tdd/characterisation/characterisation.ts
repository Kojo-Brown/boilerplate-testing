/**
 * The claims `README.md` makes, as data.
 *
 * Three suites, ten mutants, and a matrix of which suite stops which change.
 * `detection.test.ts` derives the matrix by running everything against
 * everything and asserts it equals the one declared here;
 * `characterisation.test.ts` checks that the README prints this table and not
 * a nicer one. A number in that document that no test can reach is a number
 * that will be wrong within two commits.
 */

import type { Subject } from './observe'
import { observe, visible } from './observe'
import { BRANCHES } from './legacy/renewal'
import { CORPUS } from './corpus'
import { loadGoldenMaster, recordedFor } from './goldenMaster'
import { SPEC_CHECKS } from './specSuite'
import { MUTANT_IDS } from './mutants'
import type { MutantId } from './mutants'
import { DIVERGENCE_IDS } from './divergences'

export const SUITE_IDS = ['specification', 'golden-master:invoice', 'golden-master:everything'] as const

export type SuiteId = (typeof SUITE_IDS)[number]

export type Suite = {
  readonly id: SuiteId
  /** How the suite is described in the README's comparison. */
  readonly summary: string
  /** What it watches — the honest reason its column looks the way it does. */
  readonly watches: string
  /** True when the suite reports the change as a failure. */
  readonly kills: (subject: Subject) => boolean
}

const master = loadGoldenMaster()

function specificationFails(subject: Subject): boolean {
  for (const check of SPEC_CHECKS) {
    try {
      check.run(subject)
    } catch {
      return true
    }
  }

  return false
}

function invoiceDiffers(subject: Subject): boolean {
  return CORPUS.some(
    (testCase) =>
      JSON.stringify(observe(subject, testCase).invoice) !==
      JSON.stringify(recordedFor(master, testCase.id).invoice),
  )
}

function anythingVisibleDiffers(subject: Subject): boolean {
  return CORPUS.some((testCase) => {
    const observed = visible(observe(subject, testCase))
    const recorded = recordedFor(master, testCase.id)

    return (
      JSON.stringify(observed) !==
      JSON.stringify({
        invoice: recorded.invoice,
        customerAfter: recorded.customerAfter,
        warnings: recorded.warnings,
      })
    )
  })
}

export const SUITES: readonly Suite[] = [
  {
    id: 'specification',
    summary: `${SPEC_CHECKS.length} behaviours read out of requirements.md`,
    watches: 'the figures the documentation gives worked examples for',
    kills: specificationFails,
  },
  {
    id: 'golden-master:invoice',
    summary: `${CORPUS.length} recorded cases, compared on the returned invoice`,
    watches: 'every field of the returned invoice, and nothing else',
    kills: invoiceDiffers,
  },
  {
    id: 'golden-master:everything',
    summary: `${CORPUS.length} recorded cases, compared on every visible effect`,
    watches: 'the invoice, the write-back onto the argument, and the service log',
    kills: anythingVisibleDiffers,
  },
]

/**
 * Which suites stop which change. Derived by `detection.test.ts`, not asserted
 * here — this is the declaration that derivation is checked against.
 *
 * The row worth arguing about is `TAX_ROUNDED_NOT_TRUNCATED`, the only change
 * the specification suite catches. It catches it by accident: the document
 * gives a worked tax example, the example happens to land on a half-cent, and
 * the suite pinned the rounding without anybody deciding to. That is the
 * honest shape of most specification suites — they pin whatever their examples
 * happen to touch, which is not the same as pinning what the code does.
 */
export const DETECTION: Record<MutantId, readonly SuiteId[]> = {
  VOLUME_TIER_INCLUSIVE: ['golden-master:invoice', 'golden-master:everything'],
  LOYALTY_SUMMED_NOT_COMPOUNDED: ['golden-master:invoice', 'golden-master:everything'],
  COUPON_BEFORE_CREDIT: ['golden-master:invoice', 'golden-master:everything'],
  TAX_ROUNDED_NOT_TRUNCATED: [
    'specification',
    'golden-master:invoice',
    'golden-master:everything',
  ],
  TOTAL_FLOORED_AT_ZERO: ['golden-master:invoice', 'golden-master:everything'],
  NO_WRITE_BACK_TO_CUSTOMER: ['golden-master:everything'],
  COUPON_CASE_INSENSITIVE: ['golden-master:invoice', 'golden-master:everything'],
  GRANDFATHERING_BY_PARSED_DATE: ['golden-master:invoice', 'golden-master:everything'],
  WARNS_ON_EMPTY_COUPON: ['golden-master:everything'],
  PRORATION_IGNORES_FUTURE_DATES: ['golden-master:invoice', 'golden-master:everything'],
}

export function killsBy(suite: SuiteId): MutantId[] {
  return MUTANT_IDS.filter((id) => DETECTION[id].includes(suite))
}

/** The five figures the README quotes, so it cannot quote different ones. */
export const HEADLINE = {
  corpusSize: CORPUS.length,
  branches: BRANCHES.length,
  specificationChecks: SPEC_CHECKS.length,
  mutants: MUTANT_IDS.length,
  divergences: DIVERGENCE_IDS.length,
} as const

/**
 * The dependencies that had to be broken before a single call could be
 * repeated, and what each one costs if it is left alone.
 */
export const SEAMS: readonly { readonly name: string; readonly wasInlined: string; readonly problem: string }[] = [
  {
    name: 'now',
    wasInlined: 'new Date()',
    problem: 'proration and the billing date move every day the suite runs',
  },
  {
    name: 'random',
    wasInlined: 'Math.random()',
    problem: 'the audit flag disagrees with itself between two runs of the same case',
  },
  {
    name: 'warn',
    wasInlined: 'console.warn',
    problem: 'half the behaviour goes to a stream nothing is watching',
  },
  {
    name: 'trace',
    wasInlined: 'nothing — added as a sensor',
    problem: 'no way to state which branches the corpus reaches',
  },
]
