// @vitest-environment node
//
// The third direction of the findings audit, and the one that keeps a
// predicate from being decoration.
//
// `readme.test.ts` checks that every finding holds and that the README carries
// its heading. Neither of those would notice a predicate that returned `true`
// unconditionally. This suite hands each finding a copy of the measurement
// with one cell moved and requires it to say so — a finding that cannot be
// broken is not measuring anything.

import { describe, expect, it } from 'vitest'

import { FAULT_IDS, type FaultId } from './faults.ts'
import { GATE_IDS, type GateId } from './gates.ts'
import { RUNS } from './matrix.ts'
import { FINDINGS, MEASURED, type Measurement } from './render.ts'

/** The measurement with one cell replaced. */
function withCell(gateId: GateId, faultId: FaultId, value: number): Measurement {
  return {
    ...MEASURED,
    table: {
      ...MEASURED.table,
      [gateId]: { ...MEASURED.table[gateId], [faultId]: value },
    },
  }
}

/** The measurement with one file's noise replaced. */
function withNoise(file: string, spread: number): Measurement {
  return {
    ...MEASURED,
    noise: MEASURED.noise.map((entry) =>
      entry.file === file ? { ...entry, spread } : entry,
    ),
  }
}

describe('every finding', () => {
  it('holds against the measurement as published', () => {
    for (const finding of FINDINGS) {
      expect(finding.holds(MEASURED), finding.heading).toBe(true)
    }
  })

  it('carries a heading that reads as a claim rather than a label', () => {
    for (const finding of FINDINGS) {
      expect(finding.heading.length).toBeGreaterThan(30)
      expect(finding.heading).toMatch(/\s/)
    }
  })

  it('has a distinct heading', () => {
    const headings = FINDINGS.map((finding) => finding.heading)

    expect(new Set(headings).size).toBe(headings.length)
  })
})

describe('a moved cell breaks the finding that depends on it', () => {
  it('stops claiming the percentage gate fails clean builds once it does not', () => {
    const finding = byHeading('A per-file percentage gate fails pull requests that changed nothing')

    expect(finding.holds(withCell('file-percent', 'none', 0))).toBe(false)
  })

  it('stops claiming the floored gate gives up detection once it catches more', () => {
    const finding = byHeading(
      'Flooring the percentage buys silence by giving up almost every detection',
    )

    expect(finding.holds(withCell('file-percent-floored', 'creep', RUNS))).toBe(false)
  })

  it('stops claiming the absolute gate flaps once it fires on every run', () => {
    const finding = byHeading('A threshold set near the size of the regression is a coin flip')

    expect(finding.holds(withCell('file-absolute', 'large-tenth', RUNS))).toBe(false)
    expect(finding.holds(withCell('file-absolute', 'large-tenth', 0))).toBe(false)
  })

  it('stops claiming only the total sees creep once a per-file design does', () => {
    const finding = byHeading('Only the total rule sees a slowdown that no single file owns')

    expect(finding.holds(withCell('file-both', 'creep', RUNS))).toBe(false)
  })

  it('stops claiming only the total sees creep once the total does not', () => {
    const finding = byHeading('Only the total rule sees a slowdown that no single file owns')

    expect(finding.holds(withCell('total-percent', 'creep', RUNS - 1))).toBe(false)
  })

  it('stops claiming the total scored perfectly once its tally is short', () => {
    const finding = byHeading("The total rule's perfect score is a property of the fixture's size")

    expect(
      finding.holds({
        ...MEASURED,
        tallies: { ...MEASURED.tallies, 'total-percent': FAULT_IDS.length - 1 },
      }),
    ).toBe(false)
  })
})

describe('a moved noise figure breaks the finding that depends on it', () => {
  it('stops claiming spread tracks duration once the shortest file is quiet', () => {
    const finding = byHeading(
      "A file's run-to-run spread is a property of its duration, not of its code",
    )

    expect(finding.holds(withNoise('fixture/tiny.test.ts', 0.01))).toBe(false)
  })

  it('stops claiming spread tracks duration once the longest file is noisy', () => {
    const finding = byHeading(
      "A file's run-to-run spread is a property of its duration, not of its code",
    )

    expect(finding.holds(withNoise('fixture/large.test.ts', 0.9))).toBe(false)
  })
})

describe('the perturbation helpers', () => {
  // A helper that silently failed to change anything would make every
  // assertion above vacuous.
  it('changes the cell it names and leaves the rest of the table alone', () => {
    const moved = withCell('file-both', 'creep', 9)

    expect(moved.table['file-both']['creep']).toBe(9)

    for (const gateId of GATE_IDS) {
      for (const faultId of FAULT_IDS) {
        if (gateId === 'file-both' && faultId === 'creep') continue
        expect(moved.table[gateId][faultId]).toBe(MEASURED.table[gateId][faultId])
      }
    }
  })

  it('changes the file it names and leaves the other noise entries alone', () => {
    const moved = withNoise('fixture/tiny.test.ts', 0.5)

    for (const entry of moved.noise) {
      const original = MEASURED.noise.find((other) => other.file === entry.file)

      expect(entry.spread).toBe(
        entry.file === 'fixture/tiny.test.ts' ? 0.5 : original?.spread,
      )
    }
  })
})

function byHeading(heading: string): (typeof FINDINGS)[number] {
  const found = FINDINGS.find((finding) => finding.heading === heading)

  if (found === undefined) throw new Error(`no finding headed: ${heading}`)

  return found
}
