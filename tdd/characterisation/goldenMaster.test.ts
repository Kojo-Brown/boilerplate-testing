// @vitest-environment node
/**
 * The pin itself: 128 recorded cases, and the legacy function still producing
 * every one of them.
 *
 * There is no specification in this file and no judgement about whether any of
 * these figures is correct. That is the discipline — a characterisation test
 * asserts that behaviour has not changed, which is a different claim from
 * asserting that behaviour is right, and mixing the two is how a refactoring
 * safety net turns into an argument about billing policy.
 *
 * Green here on the first run is expected, and is not a warning sign. It is the
 * same reason `tdd/README.md` gives the Gilded Rose a `pin` phase rather than
 * calling those steps `red`: a description of what the code already does cannot
 * honestly fail. What can fail is the arrangement around it — the fingerprint
 * check below is what stops the recording being quietly trimmed to fit.
 */

import { describe, expect, it } from 'vitest'

import * as legacy from './legacy/renewal'
import { CORPUS, fingerprint } from './corpus'
import { loadGoldenMaster, recordedFor } from './goldenMaster'
import { observe } from './observe'

const master = loadGoldenMaster()

describe('the recording', () => {
  it('was taken from the corpus this suite runs', () => {
    // Deleting the cases that a change happens to break, then re-approving the
    // rest, is the way a golden master stops being evidence. The fingerprint
    // covers every input of every case, so that edit fails here instead.
    expect(master.fingerprint).toBe(fingerprint(CORPUS))
    expect(master.caseCount).toBe(CORPUS.length)
    expect(master.recordedFrom).toBe('legacy/renewal.ts')
  })

  it('holds one entry per case and no others', () => {
    expect(Object.keys(master.cases).sort()).toEqual([...CORPUS].map((c) => c.id).sort())
  })

  it('cannot distinguish negative zero, and the observer admits it', () => {
    // The corpus really does produce `-0`: a zero-seat account renewed against
    // a future date prorates zero by a negative fraction. JSON cannot write
    // that down, so `observe` normalises it and this test is where the loss is
    // recorded rather than discovered by somebody chasing a comparison that
    // fails only after a round-trip.
    const raw = legacy.renewalInvoice(
      { id: 'Z-000', createdAt: '2021-03-04', plan: 'basic', seats: 0, currency: 'USD', loyaltyYears: 0, lastInvoicedAt: '2024-06-20' },
      { now: () => new Date('2024-06-15T12:00:00.000Z'), random: () => 1, warn: () => {}, trace: () => {} },
    )

    expect(Object.is(raw.discounted, -0)).toBe(true)
    expect(
      Object.is(observe(legacy, { id: 'z', customer: { id: 'Z-000', createdAt: '2021-03-04', plan: 'basic', seats: 0, currency: 'USD', loyaltyYears: 0, lastInvoicedAt: '2024-06-20' }, tax: null, nowIso: '2024-06-15T12:00:00.000Z', randomValue: 1 }).invoice.discounted, -0),
    ).toBe(false)
  })
})

describe('the legacy function', () => {
  it('reproduces every recorded case exactly', () => {
    const changed = CORPUS.filter(
      (testCase) =>
        JSON.stringify(observe(legacy, testCase)) !== JSON.stringify(recordedFor(master, testCase.id)),
    ).map((testCase) => testCase.id)

    expect(changed).toEqual([])
  })

  it('reproduces the invoice, the write-back and the log, case by case', () => {
    // The aggregate above is what fails fast; these three read the difference
    // out loud, because "one of 128 cases changed" is not a useful failure and
    // "the write-back changed on ofat:seats=101" is.
    for (const testCase of CORPUS) {
      const observed = observe(legacy, testCase)
      const recorded = recordedFor(master, testCase.id)

      expect(observed.invoice, `invoice for ${testCase.id}`).toEqual(recorded.invoice)
      expect(observed.customerAfter, `write-back for ${testCase.id}`).toEqual(recorded.customerAfter)
      expect(observed.warnings, `log for ${testCase.id}`).toEqual(recorded.warnings)
    }
  })

  it('takes the recorded path through the code for every case', () => {
    for (const testCase of CORPUS) {
      expect(observe(legacy, testCase).branches, `branches for ${testCase.id}`).toEqual(
        recordedFor(master, testCase.id).branches,
      )
    }
  })
})
