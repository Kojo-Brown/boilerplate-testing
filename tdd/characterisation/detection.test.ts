// @vitest-environment node
/**
 * What each suite would actually have caught.
 *
 * Ten single behaviour changes are applied to the real legacy source, compiled
 * and loaded, and every suite is run against every one of them. The matrix
 * that comes out is compared to the one declared in `characterisation.ts` and
 * printed in `README.md`. Weaken the corpus, drop an observable, or edit the
 * table to make a favourite approach look better, and these tests stop
 * agreeing.
 *
 * The control comes first and matters more than the matrix. The legacy source
 * is compiled through the same pipeline with no edits at all: if that came out
 * different — a type that turned out to be load-bearing, a stale temporary
 * file, a cached module — then every mutant would look caught and the whole
 * table would be measuring the compiler rather than the tests.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { DETECTION, SUITES, SUITE_IDS, killsBy } from './characterisation'
import type { SuiteId } from './characterisation'
import { MUTANTS, loadMutant, loadUnmutated } from './mutants'
import type { MutantId } from './mutants'
import type { Subject } from './observe'

function suitesKilling(subject: Subject): SuiteId[] {
  return SUITES.filter((suite) => suite.kills(subject)).map((suite) => suite.id)
}

const killed = new Map<MutantId, SuiteId[]>()

beforeAll(async () => {
  for (const mutant of MUTANTS) {
    killed.set(mutant.id, suitesKilling(await loadMutant(mutant.id)))
  }
}, 60_000)

describe('the control', () => {
  it('is compiled from the legacy source through the same pipeline', async () => {
    const control = await loadUnmutated()

    expect(suitesKilling(control)).toEqual([])
  })
})

describe('the detection matrix', () => {
  for (const mutant of MUTANTS) {
    it(`is stopped by exactly the declared suites — ${mutant.id}`, () => {
      expect(killed.get(mutant.id)).toEqual([...DETECTION[mutant.id]])
    })
  }

  it('leaves no change unnoticed by everything', () => {
    // A mutant nothing catches is either an equivalent mutant — a change with
    // no observable effect, which proves nothing about any suite — or a hole in
    // every suite at once. Both are worth failing over.
    for (const mutant of MUTANTS) {
      expect(DETECTION[mutant.id].length, `${mutant.id} is caught by nothing`).toBeGreaterThan(0)
    }
  })

  it('orders the three suites strictly, each one seeing everything the last did', () => {
    // Unlike the doubles taxonomy, where the kinds trade off against each
    // other, these three nest: the columns are the same corpus watched through
    // progressively more of the system. That makes the comparison a statement
    // about *what you look at*, not about which technique is cleverer.
    const specification = killsBy('specification')
    const invoiceOnly = killsBy('golden-master:invoice')
    const everything = killsBy('golden-master:everything')

    expect(specification.filter((id) => !invoiceOnly.includes(id))).toEqual([])
    expect(invoiceOnly.filter((id) => !everything.includes(id))).toEqual([])
    expect(SUITE_IDS).toHaveLength(3)
  })
})

describe('the headline comparison', () => {
  it('has the specification suite stopping one change in ten', () => {
    expect(killsBy('specification')).toEqual(['TAX_ROUNDED_NOT_TRUNCATED'])
  })

  it('has that one being caught by accident, not by design', () => {
    // `requirements.md` states a tax rate and says nothing about rounding. The
    // suite pinned the rounding anyway, because asserting on a worked example
    // means writing down a number, and 7.25% of 90 is 6.525. Nobody decided
    // that tax truncates; the arithmetic decided it, and the assertion
    // recorded it. That is how specification suites acquire the coverage they
    // have — by accident, wherever their examples happen to land.
    const caught = MUTANTS.find((mutant) => mutant.id === 'TAX_ROUNDED_NOT_TRUNCATED')

    expect(caught?.matchesTheDocs).toBe(false)
  })

  it('has six of the ten changes agreeing with the documentation', () => {
    // The reason a characterisation suite is not paranoia. Six of these ten
    // are the code being brought into line with `requirements.md` — a diff any
    // reviewer would approve, and six different sets of invoices that change
    // overnight.
    expect(MUTANTS.filter((mutant) => mutant.matchesTheDocs)).toHaveLength(6)
  })

  it('has watching the return value alone missing two changes the corpus reached', () => {
    const missed = MUTANTS.map((mutant) => mutant.id).filter(
      (id) => !DETECTION[id].includes('golden-master:invoice'),
    )

    expect(missed).toEqual(['NO_WRITE_BACK_TO_CUSTOMER', 'WARNS_ON_EMPTY_COUPON'])
  })

  it('has the widest suite stopping all ten', () => {
    expect(killsBy('golden-master:everything')).toHaveLength(MUTANTS.length)
  })
})

describe('the mutants themselves', () => {
  it('each apply exactly once to the current legacy source', async () => {
    // `applyEdits` throws unless every replacement matches once, so loading all
    // ten is the assertion. Edit the legacy function in a way that breaks a
    // mutant and this fails, rather than the matrix quietly measuring nine.
    for (const mutant of MUTANTS) {
      await expect(loadMutant(mutant.id)).resolves.toBeDefined()
    }
  }, 60_000)

  it('carry a description each, and no duplicate identifiers', () => {
    expect(new Set(MUTANTS.map((mutant) => mutant.id)).size).toBe(MUTANTS.length)

    for (const mutant of MUTANTS) {
      expect(mutant.description.length, `${mutant.id} has no description`).toBeGreaterThan(20)
    }
  })
})
