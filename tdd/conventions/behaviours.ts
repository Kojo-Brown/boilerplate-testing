/**
 * The eight things this folder says about `refundPolicy.ts`, and the title
 * each convention gives them.
 *
 * `aaa.test.ts` and `gwt.test.ts` are meant to be the same suite in two
 * shapes. Meant to be is not much of a guarantee: the easy way for a
 * comparison like this to rot is for one side to quietly grow a ninth case, or
 * for a title to be reworded on one side only, after which the two files are
 * still both green and no longer comparable.
 *
 * So the behaviours live here, with the exact title each side must use, and
 * `conventions.test.ts` parses both suites and checks them against this list —
 * every behaviour stated once on each side, spelled the way it is spelled
 * here, and nothing stated that is not on the list. A case added to one file
 * fails `pnpm test` until it is added to the other.
 *
 * The same data drives the README's comparison table, so the counts printed
 * there (five Given blocks, eight When blocks, eight cases) are counted rather
 * than claimed.
 */

export const BEHAVIOUR_IDS = [
  'finalSaleDenied',
  'undeliveredRefundsInFull',
  'unopenedInWindowRefundsInFull',
  'afterWindowDenied',
  'openedInWindowWithholdsFee',
  'feeRoundsToWholeCents',
  'perishableWindowCloses',
  'openedPerishableRefundsInFull',
] as const

export type BehaviourId = (typeof BEHAVIOUR_IDS)[number]

/** The three clauses of a Given/When/Then title, without their prefixes. */
export interface GwtTitle {
  /** The context. Shared by more than one behaviour wherever it can be. */
  readonly given: string
  /** The action. */
  readonly when: string
  /** The outcome. */
  readonly then: string
}

export interface Behaviour {
  readonly id: BehaviourId
  /** What the policy does, in one sentence. Appears verbatim in the README. */
  readonly statement: string
  /** The title `aaa.test.ts` gives it. */
  readonly aaaTitle: string
  /** The clauses `gwt.test.ts` splits it across. */
  readonly gwt: GwtTitle
}

export const BEHAVIOURS: readonly Behaviour[] = [
  {
    id: 'finalSaleDenied',
    statement: 'A final-sale order is never refundable, whatever its state.',
    aaaTitle: 'denies a refund on a final-sale order',
    gwt: {
      given: 'a final-sale order',
      when: 'a refund is requested the day after delivery',
      then: 'it is denied',
    },
  },
  {
    id: 'undeliveredRefundsInFull',
    statement: 'An order that has not been delivered is cancellable in full.',
    aaaTitle: 'refunds an undelivered order in full',
    gwt: {
      given: 'a standard order that has not been delivered',
      when: 'a refund is requested',
      then: 'the full price comes back',
    },
  },
  {
    id: 'unopenedInWindowRefundsInFull',
    statement: 'An unopened order inside its return window is refundable in full.',
    aaaTitle: 'refunds an unopened order in full inside the return window',
    gwt: {
      given: 'a delivered, unopened standard order',
      when: 'a refund is requested inside the 30-day window',
      then: 'the full price comes back',
    },
  },
  {
    id: 'afterWindowDenied',
    statement: 'Once the return window has closed, the answer is no.',
    aaaTitle: 'denies a refund once the return window has closed',
    gwt: {
      given: 'a delivered, unopened standard order',
      when: 'a refund is requested after the 30-day window',
      then: 'it is denied',
    },
  },
  {
    id: 'openedInWindowWithholdsFee',
    statement: 'An opened order is refunded less a 15% restocking fee.',
    aaaTitle: 'withholds a restocking fee on an opened order',
    gwt: {
      given: 'a delivered, opened standard order',
      when: 'a refund is requested inside the 30-day window',
      then: 'a restocking fee is withheld',
    },
  },
  {
    id: 'feeRoundsToWholeCents',
    statement: 'The restocking fee never leaves a fraction of a cent behind.',
    aaaTitle: 'rounds the restocking fee to whole cents',
    gwt: {
      given: 'a delivered, opened standard order',
      when: 'the price makes the fee land on half a cent',
      then: 'the refund is a whole number of cents',
    },
  },
  {
    id: 'perishableWindowCloses',
    statement: 'A perishable order gets 48 hours, not 30 days.',
    aaaTitle: 'denies a perishable refund once its 48-hour window has closed',
    gwt: {
      given: 'a delivered perishable order',
      when: 'a refund is requested 72 hours after delivery',
      then: 'it is denied',
    },
  },
  {
    id: 'openedPerishableRefundsInFull',
    statement: 'Opening a perishable costs nothing: the short window already prices it in.',
    aaaTitle: 'refunds an opened perishable in full inside its window',
    gwt: {
      given: 'a delivered perishable order',
      when: 'it was opened and a refund is requested inside the 48-hour window',
      then: 'the full price comes back',
    },
  },
]

export function behaviour(id: BehaviourId): Behaviour {
  const found = BEHAVIOURS.find((candidate) => candidate.id === id)

  if (found === undefined) {
    throw new Error(`no behaviour named ${id}`)
  }

  return found
}

/** The distinct `Given` contexts, in the order they first appear. */
export const GIVEN_CONTEXTS: readonly string[] = [
  ...new Set(BEHAVIOURS.map((entry) => entry.gwt.given)),
]
