// @vitest-environment node
/**
 * The refactor, and the only argument for it that carries any weight.
 *
 * `refactored.ts` is the same invoicing written as eight named steps instead
 * of one running total. The claim being made is not that it reads better —
 * that is an opinion, and the pull request is where it belongs. The claim
 * checked here is that it is the *same function*: every corpus case, every
 * visible effect, both against the live legacy implementation and against the
 * recording taken before the refactor started.
 *
 * Both comparisons are worth having, and they fail in different ways. Against
 * the live legacy code, the two implementations are compared as they are
 * today, which catches a refactor that drifted. Against the recording, both
 * are compared to how the code behaved before anybody touched it, which
 * catches the subtler accident: a change made to *both* files at once,
 * agreeing with itself and with nothing else.
 *
 * `branches` is excluded, and that exclusion is the point rather than a
 * loophole. The refactored version does not have the legacy branch structure —
 * a `find` over a tier table replaces an if/else ladder — and a comparison
 * that demanded the same path through the code would forbid exactly the change
 * the pins were built to permit. Behaviour is what is held fixed; structure is
 * what is being changed.
 */

import { describe, expect, it } from 'vitest'

import * as legacy from './legacy/renewal'
import * as refactored from './refactored'
import { CORPUS } from './corpus'
import { loadGoldenMaster, recordedFor } from './goldenMaster'
import { observe, visible } from './observe'
import { SPEC_CHECKS } from './specSuite'

const master = loadGoldenMaster()

describe('the refactored implementation', () => {
  it('bills every corpus case exactly as the legacy implementation does', () => {
    const differing = CORPUS.filter(
      (testCase) =>
        JSON.stringify(visible(observe(refactored, testCase))) !==
        JSON.stringify(visible(observe(legacy, testCase))),
    ).map((testCase) => testCase.id)

    expect(differing).toEqual([])
  })

  it('reproduces the recording taken before the refactor began', () => {
    for (const testCase of CORPUS) {
      const observed = visible(observe(refactored, testCase))
      const recorded = recordedFor(master, testCase.id)

      expect(observed.invoice, `invoice for ${testCase.id}`).toEqual(recorded.invoice)
      expect(observed.customerAfter, `write-back for ${testCase.id}`).toEqual(recorded.customerAfter)
      expect(observed.warnings, `log for ${testCase.id}`).toEqual(recorded.warnings)
    }
  })

  it('keeps every quirk the divergences record, rather than tidying them away', () => {
    // Stated case by case because "all 128 match" would also be true of a
    // refactor that had quietly fixed a quirk no corpus case reached. These
    // five are the ones somebody would be tempted by.
    const bill = (customer: Parameters<typeof refactored.renewalInvoice>[0]) =>
      refactored.renewalInvoice(customer, {
        now: () => new Date('2024-06-15T12:00:00.000Z'),
        random: () => 1,
        warn: () => {},
        trace: () => {},
      })

    const base = {
      id: 'E-000',
      createdAt: '2021-03-04',
      plan: 'basic',
      seats: 10,
      currency: 'USD',
      loyaltyYears: 0,
    }

    expect(bill({ ...base, seats: 100 }).discounted).toBe(837)
    expect(bill({ ...base, seats: 500, loyaltyYears: 5 }).discounted).toBe(3633.75)
    expect(bill({ ...base, creditCents: 5000, coupon: 'SAVE10' }).payable).toBe(36)
    expect(bill({ ...base, seats: 1, creditCents: 5000 }).total).toBe(-43.97)
    expect(bill({ ...base, plan: 'pro', createdAt: '01/02/2019' }).subtotal).toBe(190)
  })

  it('still writes the billing date back onto the caller’s object', () => {
    const customer = {
      id: 'E-001',
      createdAt: '2021-03-04',
      plan: 'basic',
      seats: 10,
      currency: 'USD',
      loyaltyYears: 0,
    }

    refactored.renewalInvoice(customer, {
      now: () => new Date('2024-06-15T12:00:00.000Z'),
      random: () => 1,
      warn: () => {},
      trace: () => {},
    })

    expect(customer).toHaveProperty('lastInvoicedAt', '2024-06-15')
  })

})

describe('the specification suite against the refactored implementation', () => {
  // The same eighteen checks `spec.test.ts` runs against the legacy code. They
  // pass here too, and that is worth very little on its own: `detection.test.ts`
  // shows these eighteen missing nine of ten changes to this behaviour. They
  // are run against both implementations so that the comparison in that file
  // is between suites, not between subjects.
  for (const check of SPEC_CHECKS) {
    it(check.title, () => {
      check.run(refactored)
    })
  }
})
