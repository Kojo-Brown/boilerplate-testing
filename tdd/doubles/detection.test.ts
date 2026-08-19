// @vitest-environment node
/**
 * The guide's central claim, executed.
 *
 * Every kind of double is run against every fault. What comes out is a matrix
 * of which kinds see which class of defect, and it is compared to the one
 * declared in `taxonomy.ts` and printed in `README.md`. Weaken a probe, make a
 * double stricter, or edit the table to flatter a favourite kind, and these
 * tests stop agreeing.
 *
 * The control matters as much as the matrix: a probe that failed against the
 * *correct* system would look like a superb detector while being worthless, so
 * every probe is first shown green on `createRegisterUser`.
 */

import { describe, it, expect } from 'vitest'

import { FAULTS } from './faults'
import type { FaultId } from './faults'
import { createRegisterUser } from './registerUser'
import type { SystemFactory } from './registerUser'
import type { Probe } from './probes'
import { DETECTION, DOUBLE_KINDS, TAXONOMY } from './taxonomy'
import type { DoubleKind } from './taxonomy'

function faultsCaughtBy(kind: DoubleKind): FaultId[] {
  return Object.entries(DETECTION)
    .filter(([, kinds]) => kinds.includes(kind))
    .map(([id]) => id as FaultId)
}

async function detects(probe: Probe, build: SystemFactory): Promise<boolean> {
  try {
    await probe(build)
    return false
  } catch {
    return true
  }
}

describe('every probe', () => {
  for (const entry of TAXONOMY) {
    it(`passes against the correct system — ${entry.kind}`, async () => {
      expect(await detects(entry.probe, createRegisterUser)).toBe(false)
    })
  }
})

describe('the detection matrix', () => {
  for (const fault of FAULTS) {
    it(`is caught by exactly the declared kinds — ${fault.id}`, async () => {
      const caught: DoubleKind[] = []

      for (const entry of TAXONOMY) {
        if (await detects(entry.probe, fault.build)) caught.push(entry.kind)
      }

      expect(caught).toEqual([...DETECTION[fault.id]])
    })
  }

  it('leaves no fault uncaught and no kind idle', () => {
    // Two ways this folder would quietly stop being a comparison: a fault
    // nothing detects (the row proves nothing), or a kind that catches nothing
    // (the column is decoration).
    for (const [id, kinds] of Object.entries(DETECTION)) {
      expect(kinds.length, `${id} is caught by nothing`).toBeGreaterThan(0)
    }

    for (const kind of DOUBLE_KINDS) {
      expect(faultsCaughtBy(kind).length, `${kind} catches nothing`).toBeGreaterThan(0)
    }
  })

  it('contains exactly one domination, and it is the mock over the spy', () => {
    // Worth stating plainly rather than hiding: on this feature the mock sees
    // everything the spy sees and one thing more, because it also rules out
    // the calls nobody wrote an assertion for. That is a fact about detection
    // power alone. The README argues the other half — that the same strictness
    // is what makes mock-heavy suites break on changes that broke nothing —
    // and no test can settle that one for you.
    const dominations: string[] = []

    for (const outer of DOUBLE_KINDS) {
      for (const inner of DOUBLE_KINDS) {
        if (outer === inner) continue

        const weaker = faultsCaughtBy(inner)
        const stronger = faultsCaughtBy(outer)

        if (weaker.every((fault) => stronger.includes(fault))) {
          dominations.push(`${outer} > ${inner}`)
        }
      }
    }

    expect(dominations).toEqual(['mock > spy'])
  })
})
