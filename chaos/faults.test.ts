// The catalogue, audited as a closed table.
//
// Everything here is cheap and none of it needs a socket, which is the point:
// the expensive half of this directory measures what the faults *do*, and the
// cheap half makes sure the catalogue still describes what it says it does.

import { describe, expect, it } from 'vitest'

import { CATEGORIES, FAULTS, FAULT_IDS, type Category, fault, faultsIn } from './faults.ts'

describe('the fault catalogue', () => {
  it('declares exactly the faults the id list names, in the same order', () => {
    expect(FAULTS.map((entry) => entry.id)).toEqual([...FAULT_IDS])
  })

  it('has no duplicate ids', () => {
    expect(new Set(FAULT_IDS).size).toBe(FAULT_IDS.length)
  })

  it.each([...FAULT_IDS])('%s carries a category, an injection and a reason', (id) => {
    const entry = fault(id)

    expect(CATEGORIES).toContain(entry.category)
    expect(entry.injects.length).toBeGreaterThan(10)
    expect(entry.why.length).toBeGreaterThan(40)
  })

  it('refuses an id it does not know', () => {
    // @ts-expect-error — the point of the guard is the case the types forbid.
    expect(() => fault('not-a-fault')).toThrow('unknown fault')
  })

  // The three categories the SPEC item names, plus the control. A category
  // with one fault in it cannot separate two wirings — which is the argument
  // the header comment in `faults.ts` makes — so the shape of this grouping is
  // worth asserting rather than leaving to a reader's count.
  it('covers latency, errors and outages with more than one fault each', () => {
    const counts = Object.fromEntries(
      CATEGORIES.map((category) => [category, faultsIn(category).length]),
    ) as Record<Category, number>

    expect(counts).toEqual({ control: 1, latency: 2, error: 3, outage: 3 })
  })

  it('puts every fault in exactly one category', () => {
    const grouped = CATEGORIES.flatMap((category) => faultsIn(category).map((entry) => entry.id))

    expect([...grouped].sort()).toEqual([...FAULT_IDS].sort())
  })

  // `healthy` first is load-bearing for the published tables: it is the control
  // column, and a reader checks it before reading anything to its right.
  it('leads with the control', () => {
    expect(FAULT_IDS[0]).toBe('healthy')
    expect(fault('healthy').category).toBe('control')
  })
})
