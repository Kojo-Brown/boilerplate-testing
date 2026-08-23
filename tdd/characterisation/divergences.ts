/**
 * The five places `requirements.md` and `legacy/renewal.ts` disagree.
 *
 * Finding these is the first thing a characterisation exercise produces, and
 * it happens before any refactoring: you write a test from the documentation,
 * it goes red, and you have learned something. The temptation at that moment
 * is to fix the code, because the documentation is what everybody agreed to.
 * The reason not to is that the code is what customers have been invoiced from
 * for three years — every one of these disagreements is somebody's bill, and
 * some of them are somebody's bill in their favour.
 *
 * So the disagreement is recorded rather than resolved, and recorded as
 * something that runs. Each entry states what the sentence in the
 * documentation implies, what the code actually produces, and a probe that
 * produces it. `divergences.test.ts` runs all five and asserts both halves:
 * that the code gives the observed figure, and that the observed figure is not
 * the documented one. If somebody later fixes one of these deliberately, the
 * entry fails and has to be deleted — which is the correct amount of friction
 * for retiring a known bug.
 *
 * These five are also why `spec.test.ts` has the holes it has. A suite written
 * from this document cannot assert on any of these areas without going red, so
 * the areas got dropped, and `detection.test.ts` measures what dropping them
 * costs.
 */

import type { Customer } from './legacy/renewal'
import { renewalInvoice, resetTax } from './legacy/renewal'
import { NOW_ISO } from './corpus'

export const DIVERGENCE_IDS = [
  'VOLUME_TIER_BOUNDARY',
  'DISCOUNTS_COMPOUND',
  'CREDIT_BEFORE_COUPON',
  'TOTAL_MAY_BE_NEGATIVE',
  'GRANDFATHERING_BY_STRING',
] as const

export type DivergenceId = (typeof DIVERGENCE_IDS)[number]

export type Divergence = {
  readonly id: DivergenceId
  /** The rule as the README states it, in one readable sentence. */
  readonly documented: string
  /** The exact words in `requirements.md` the rule is read from, whitespace aside. */
  readonly quotedFrom: string
  /** What the code does instead, in one line. */
  readonly actual: string
  /** Which invoice figure the disagreement shows up in. */
  readonly figure: 'discounted' | 'payable' | 'total' | 'subtotal'
  /** What the documented rule would produce for the probe below. */
  readonly documentedValue: number
  /** What the legacy code produces. */
  readonly observedValue: number
  readonly probe: () => number
}

const FIXED_NOW = new Date(NOW_ISO)

/** A silent ambient: these probes are about arithmetic, not logging. */
function bill(customer: Customer): ReturnType<typeof renewalInvoice> {
  // The tax table is module-level and mutable, so a probe that did not reset it
  // would report a different figure depending on what ran before it.
  resetTax()

  return renewalInvoice(
    { ...customer },
    { now: () => FIXED_NOW, random: () => 1, warn: () => {}, trace: () => {} },
  )
}

function account(overrides: Partial<Customer>): Customer {
  return {
    id: 'D-000',
    createdAt: '2021-03-04',
    plan: 'basic',
    seats: 10,
    currency: 'USD',
    loyaltyYears: 0,
    ...overrides,
  }
}

export const DIVERGENCES: readonly Divergence[] = [
  {
    id: 'VOLUME_TIER_BOUNDARY',
    documented: 'Accounts with 100 seats or more receive 15%.',
    quotedFrom: '| 100 or more | 15% |',
    actual: 'the tiers are exclusive, so exactly 100 seats gets the 7% tier',
    figure: 'discounted',
    // 100 basic seats: 900 list, 765 under the documented rule, 837 in fact.
    documentedValue: 765,
    observedValue: 837,
    probe: () => bill(account({ seats: 100 })).discounted,
  },
  {
    id: 'DISCOUNTS_COMPOUND',
    documented: 'Volume and loyalty discounts are added together and applied once.',
    quotedFrom: 'Volume and loyalty discounts are added together and applied once.',
    actual: 'loyalty is applied to the already volume-discounted figure, so the two compound',
    figure: 'discounted',
    // 500 basic seats, five years: 4500 list. Summed: 80% = 3600.
    // Compounded: 4500 × 0.85 × 0.95 = 3633.75.
    documentedValue: 3600,
    observedValue: 3633.75,
    probe: () => bill(account({ seats: 500, loyaltyYears: 5 })).discounted,
  },
  {
    id: 'CREDIT_BEFORE_COUPON',
    documented: 'The coupon is applied to the discounted amount, and any account credit is deducted from the result.',
    quotedFrom: 'The coupon is applied to the discounted amount, and any account credit is deducted from the result.',
    actual: 'the credit is deducted first, so a percentage coupon discounts the smaller figure',
    figure: 'payable',
    // 90 due, 50 credit, SAVE10. Documented: 90 × 0.9 − 50 = 31.
    // In fact: (90 − 50) × 0.9 = 36 — the coupon is worth 4 instead of 9.
    documentedValue: 31,
    observedValue: 36,
    probe: () => bill(account({ creditCents: 5000, coupon: 'SAVE10' })).payable,
  },
  {
    id: 'TOTAL_MAY_BE_NEGATIVE',
    documented: 'An invoice total is never negative; unused credit is carried forward.',
    quotedFrom: 'An invoice total is never negative; unused credit is carried forward',
    actual: 'the credit runs the total below zero, and tax is charged on the negative figure',
    figure: 'total',
    // One basic seat, 50 of credit: −41 payable, −2.97 of USD tax on top.
    documentedValue: 0,
    observedValue: -43.97,
    probe: () => bill(account({ seats: 1, creditCents: 5000 })).total,
  },
  {
    id: 'GRANDFATHERING_BY_STRING',
    documented: 'Accounts created before 1 January 2019 keep their original price.',
    quotedFrom: 'Accounts created before 1 January 2019 keep their original price',
    actual: 'the cut-off compares dates as strings, so any non-ISO date sorts below it and is grandfathered',
    figure: 'subtotal',
    // Created 2 January 2019 — after the cut-off — but '01/02/2019' sorts
    // before '2019-01-01', so ten pro seats bill at 19 rather than 29.
    documentedValue: 290,
    observedValue: 190,
    probe: () => bill(account({ plan: 'pro', createdAt: '01/02/2019' })).subtotal,
  },
]

export function divergenceNamed(id: DivergenceId): Divergence {
  const divergence = DIVERGENCES.find((candidate) => candidate.id === id)

  if (divergence === undefined) {
    throw new Error(`no divergence named ${id}`)
  }

  return divergence
}
