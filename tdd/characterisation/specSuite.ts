/**
 * The suite a careful engineer writes from `requirements.md`, held as data.
 *
 * This is the control arm. It is what you get when you open the documentation,
 * work through it heading by heading, and turn each stated rule into a test at
 * the example the document itself uses. Eighteen behaviours, all green, and
 * nothing obviously missing — it is a suite that would pass review.
 *
 * ---------------------------------------------------------------------------
 * The holes, and how they got there
 * ---------------------------------------------------------------------------
 * Five of the document's sentences cannot be tested as written, because the
 * code disagrees with them (`divergences.ts`). Writing those tests is how the
 * disagreements were found: each one went red. What happened next is the
 * realistic part and the reason this suite is worth keeping as a comparison —
 * the cases were **dropped**, not rewritten. Rewriting a red test to match the
 * observed figure would have meant deciding, in the middle of an unrelated
 * task, that a three-year-old billing quirk is now the specification. Nobody
 * has that authority on a Tuesday afternoon, so the tests went away and a
 * ticket got written.
 *
 * That is the difference between this and a characterisation suite, and it is
 * not a difference in diligence. A specification suite pins the behaviour
 * somebody decided on. A characterisation suite pins the behaviour that is
 * actually there, including the parts nobody has decided about yet — and it is
 * exactly those parts that a refactor changes without anyone noticing.
 * `detection.test.ts` puts a number on the difference.
 *
 * Held as data rather than as `it()` calls so the same eighteen checks can be
 * run twice: against the real thing in `spec.test.ts`, where they read as an
 * ordinary suite, and against every mutant in `detection.test.ts`.
 */

import { expect } from 'vitest'

import type { Customer } from './legacy/renewal'
import type { Subject } from './observe'
import { observe } from './observe'
import { NOW_ISO } from './corpus'
import type { Case } from './corpus'

export type SpecCheck = {
  readonly title: string
  readonly run: (subject: Subject) => void
}

/** `randomValue` well above the audit rate, so the flag is off unless a case says otherwise. */
const NEVER_SAMPLED = 0.99

function billing(customer: Customer, randomValue = NEVER_SAMPLED): Case {
  return { id: 'spec', customer, tax: null, nowIso: NOW_ISO, randomValue }
}

function account(overrides: Partial<Customer>): Customer {
  return {
    id: 'S-000',
    createdAt: '2021-03-04',
    plan: 'basic',
    seats: 10,
    currency: 'USD',
    loyaltyYears: 0,
    ...overrides,
  }
}

export const SPEC_CHECKS: readonly SpecCheck[] = [
  {
    title: 'a basic seat costs nine',
    run: (subject) => {
      expect(observe(subject, billing(account({ plan: 'basic' }))).invoice.subtotal).toBe(90)
    },
  },
  {
    title: 'a pro seat costs twenty-nine',
    run: (subject) => {
      expect(observe(subject, billing(account({ plan: 'pro' }))).invoice.subtotal).toBe(290)
    },
  },
  {
    title: 'an enterprise seat costs ninety-nine',
    run: (subject) => {
      expect(observe(subject, billing(account({ plan: 'enterprise' }))).invoice.subtotal).toBe(990)
    },
  },
  {
    title: 'an unrecognised plan is billed at the basic rate and reported',
    run: (subject) => {
      const observation = observe(subject, billing(account({ plan: 'starter' })))

      expect(observation.invoice.subtotal).toBe(90)
      expect(observation.warnings).toContain('unknown plan starter, billing at the basic rate')
    },
  },
  {
    title: 'five hundred seats are discounted by fifteen per cent',
    run: (subject) => {
      expect(observe(subject, billing(account({ seats: 500 }))).invoice.discounted).toBe(3825)
    },
  },
  {
    title: 'thirty seats are discounted by seven per cent',
    run: (subject) => {
      expect(observe(subject, billing(account({ seats: 30 }))).invoice.discounted).toBe(251.1)
    },
  },
  {
    title: 'ten seats are not volume-discounted',
    run: (subject) => {
      expect(observe(subject, billing(account({ seats: 10 }))).invoice.discounted).toBe(90)
    },
  },
  {
    title: 'five years of loyalty takes five per cent off',
    run: (subject) => {
      expect(observe(subject, billing(account({ loyaltyYears: 5 }))).invoice.discounted).toBe(85.5)
    },
  },
  {
    title: 'loyalty stops counting after five years',
    run: (subject) => {
      expect(observe(subject, billing(account({ loyaltyYears: 9 }))).invoice.discounted).toBe(85.5)
    },
  },
  {
    title: 'a renewal ten days into the period is charged for ten days',
    run: (subject) => {
      const observation = observe(subject, billing(account({ lastInvoicedAt: '2024-06-05' })))

      expect(observation.invoice.discounted).toBe(30)
    },
  },
  {
    title: 'a renewal after a full period is charged in full',
    run: (subject) => {
      const observation = observe(subject, billing(account({ lastInvoicedAt: '2024-01-01' })))

      expect(observation.invoice.discounted).toBe(90)
    },
  },
  {
    title: 'SAVE10 takes ten per cent off',
    run: (subject) => {
      expect(observe(subject, billing(account({ coupon: 'SAVE10' }))).invoice.payable).toBe(81)
    },
  },
  {
    title: 'WELCOME takes twenty off',
    run: (subject) => {
      expect(observe(subject, billing(account({ coupon: 'WELCOME' }))).invoice.payable).toBe(70)
    },
  },
  {
    title: 'an unrecognised coupon is reported and the invoice charged in full',
    run: (subject) => {
      const observation = observe(subject, billing(account({ coupon: 'FREESTUFF' })))

      expect(observation.invoice.payable).toBe(90)
      expect(observation.warnings).toContain('unknown coupon FREESTUFF')
    },
  },
  {
    title: 'account credit is deducted from the amount due',
    run: (subject) => {
      expect(observe(subject, billing(account({ creditCents: 1250 }))).invoice.payable).toBe(77.5)
    },
  },
  {
    title: 'tax is charged at the rate for the invoice currency',
    run: (subject) => {
      const observation = observe(subject, billing(account({})))

      expect(observation.invoice.tax).toBe(6.52)
      expect(observation.invoice.total).toBe(96.52)
    },
  },
  {
    title: 'a currency with no registered rate is billed untaxed and reported',
    run: (subject) => {
      const observation = observe(subject, billing(account({ currency: 'GBP' })))

      expect(observation.invoice.tax).toBe(0)
      expect(observation.warnings).toContain('no tax rate for GBP')
    },
  },
  {
    title: 'roughly one invoice in twenty is flagged for audit',
    run: (subject) => {
      expect(observe(subject, billing(account({}), 0.01)).invoice.auditSample).toBe(true)
      expect(observe(subject, billing(account({}), 0.5)).invoice.auditSample).toBe(false)
    },
  },
]
