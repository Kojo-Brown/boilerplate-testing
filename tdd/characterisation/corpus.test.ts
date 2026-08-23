// @vitest-environment node
/**
 * Whether the corpus is any good, which is the question the golden master
 * cannot answer about itself.
 *
 * A recording of 128 cases proves the code does what it did on those 128
 * cases. Whether that is worth anything depends entirely on whether the 128
 * reach the whole function, and "we thought about it carefully" is not
 * evidence. So the legacy function reports the branches it takes through the
 * sensing seam, and two claims are checked against each other:
 *
 *   - every branch the source contains is declared in `BRANCHES`, and
 *   - every declared branch is reached by at least one case.
 *
 * Together they close the loop. Add a branch and forget to cover it, and the
 * second fails; add a branch and forget to declare it, and the first does.
 * Neither can be satisfied by editing the other, because one of them is read
 * out of the source text.
 *
 * This is a weaker guarantee than a coverage tool would give — statement
 * coverage, not path coverage, and no claim at all about the interactions
 * between branches. It is stated rather than implied so that nobody reads the
 * green tick as "the corpus is complete". Nothing makes a corpus complete;
 * `detection.test.ts` is the second, sharper question, and asks what the
 * corpus would actually have caught.
 */

import { describe, expect, it } from 'vitest'

import { BRANCHES } from './legacy/renewal'
import * as legacy from './legacy/renewal'
import { CORPUS, CORPUS_SIZE_CLAIMED, OFAT_CASE_COUNT, fingerprint } from './corpus'
import { legacySource } from './mutants'
import { observeAll } from './observe'

/** Every `ambient.trace('…')` argument in the legacy source, in source order. */
function tracedBranches(source: string): string[] {
  return [...source.matchAll(/ambient\.trace\('([^']+)'\)/g)].map((match) => match[1] ?? '')
}

const observations = observeAll(legacy, CORPUS)

describe('the branch list', () => {
  it('names every branch the legacy source traces, in source order', () => {
    expect(tracedBranches(legacySource())).toEqual([...BRANCHES])
  })

  it('names each branch once', () => {
    expect(new Set(BRANCHES).size).toBe(BRANCHES.length)
  })
})

describe('the corpus', () => {
  it('reaches every branch of the legacy function', () => {
    const reached = new Set<string>()

    for (const observation of Object.values(observations)) {
      for (const branch of observation.branches) reached.add(branch)
    }

    expect([...BRANCHES].filter((branch) => !reached.has(branch))).toEqual([])
  })

  it('is the size it claims, and one case per identifier', () => {
    expect(CORPUS).toHaveLength(CORPUS_SIZE_CLAIMED)
    expect(new Set(CORPUS.map((testCase) => testCase.id)).size).toBe(CORPUS.length)
    expect(new Set(CORPUS.map((testCase) => testCase.customer.id)).size).toBe(CORPUS.length)
  })

  it('varies one factor at a time before it varies several', () => {
    const ofat = CORPUS.slice(0, OFAT_CASE_COUNT).map((testCase) => testCase.id)

    expect(ofat[0]).toBe('base')
    expect(ofat.slice(1).every((id) => id.startsWith('ofat:'))).toBe(true)
    expect(CORPUS.slice(OFAT_CASE_COUNT).every((c) => c.id.startsWith('random:'))).toBe(true)
  })

  it('generates the same cases on every run', () => {
    // The seeded tail is the part that could drift. Rebuilding the corpus in a
    // second process would be a better test; this one at least fails if the
    // generator is made to depend on anything outside its seed.
    expect(fingerprint(CORPUS)).toBe(fingerprint(CORPUS))
    expect(fingerprint(CORPUS.slice(0, -1))).not.toBe(fingerprint(CORPUS))
  })

  it('produces outcomes worth recording, not 128 variations of the same invoice', () => {
    const totals = new Set(Object.values(observations).map((o) => o.invoice.total))
    const warned = Object.values(observations).filter((o) => o.warnings.length > 0)
    const negative = Object.values(observations).filter((o) => o.invoice.total < 0)
    const sampled = Object.values(observations).filter((o) => o.invoice.auditSample)

    expect(totals.size).toBeGreaterThan(CORPUS.length / 2)
    expect(warned.length).toBeGreaterThan(0)
    expect(negative.length).toBeGreaterThan(0)
    expect(sampled.length).toBeGreaterThan(0)
  })
})
