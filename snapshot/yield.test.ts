// @vitest-environment node
/**
 * How much a reviewer is asked to read, and how much of it is worth reading.
 *
 * The folklore says a projected snapshot gives you a smaller failing diff. It
 * does not — not here, and the measurement below is what corrected the claim
 * this pull request started with. Over the eight bugs both snapshot probes
 * catch, the two mark **exactly the same number of lines**, every time. That
 * makes sense in hindsight: the fault changes a value, both documents contain
 * that value once, and a diff of either marks one line per changed value.
 *
 * What the projection actually changes is two other things, and they are the
 * ones that decide whether a snapshot gets read:
 *
 *   1. The size of the document the reviewer scans to find those lines — 138
 *      lines of markup against 54 lines of `field: value`.
 *   2. The number of times the diff appears at all when nothing is wrong: 64
 *      changed lines across six refactors, against none.
 *
 * Neither is a claim about the failing diff. Both are claims about the
 * reviewer's week, which is what the habit forms out of.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { BUGS, NOISE } from './edits'
import type { VariantId } from './edits'
import { addDiffs, changedLines, diffLines, EMPTY_DIFF, median } from './diff'
import { loadControl, loadVariant } from './load'
import { DETECTION } from './matrix'
import { CORPUS } from './orders'
import { projectionLines } from './project'
import { record } from './probes'
import type { Baseline } from './probes'

interface Cost {
  readonly full: number
  readonly projected: number
}

const cost = new Map<VariantId, Cost>()

let baseline: Baseline

beforeAll(async () => {
  baseline = record(await loadControl())

  for (const variant of [...BUGS, ...NOISE]) {
    const render = await loadVariant(variant.id)

    let full = EMPTY_DIFF
    let projected = EMPTY_DIFF

    for (const order of CORPUS) {
      const html = render(order)

      full = addDiffs(full, diffLines(baseline.full.get(order.reference) ?? '', html))
      projected = addDiffs(
        projected,
        diffLines(baseline.projected.get(order.reference) ?? '', projectionLines(html).join('\n')),
      )
    }

    cost.set(variant.id, { full: changedLines(full), projected: changedLines(projected) })
  }
}, 60_000)

const costOf = (id: VariantId): Cost => cost.get(id) ?? { full: -1, projected: -1 }

describe('the size of the two snapshots', () => {
  it('has the markup at 138 lines across the corpus and the projection at 54', () => {
    const full = CORPUS.map((order) => (baseline.full.get(order.reference) ?? '').split('\n').length)
    const projected = CORPUS.map(
      (order) => (baseline.projected.get(order.reference) ?? '').split('\n').length,
    )

    expect(full).toEqual([39, 48, 32, 19])
    expect(projected).toEqual([15, 19, 12, 8])
    expect(full.reduce((a, b) => a + b, 0)).toBe(138)
    expect(projected.reduce((a, b) => a + b, 0)).toBe(54)
  })
})

describe('the failing diff for a real bug', () => {
  it('is the same size in both snapshots, for every bug both of them see', () => {
    // The claim this file exists to correct. Not "usually similar" — identical,
    // in all eight cases.
    const shared = BUGS.filter(
      (bug) => DETECTION[bug.id].includes('full') && DETECTION[bug.id].includes('projected'),
    )

    expect(shared).toHaveLength(8)

    for (const bug of shared) {
      const { full, projected } = costOf(bug.id)

      expect(projected, `${bug.id}: markup marked ${full} lines, projection ${projected}`).toBe(full)
    }
  })

  it('is 2 lines for a wrong label and 30 for a wrong money format', () => {
    // The spread is a property of the fault, not of the technique: a status
    // label appears once in the corpus, a money format appears fifteen times.
    expect(costOf('CANCELLED_LABEL_CHANGED').full).toBe(2)
    expect(costOf('MINOR_UNITS_UNPADDED').full).toBe(30)
    expect(median(BUGS.map((bug) => costOf(bug.id).full))).toBe(6)
  })
})

describe('the diff for a change that broke nothing', () => {
  it('is 64 lines of markup across the six refactors, and none of the projection', () => {
    const full = NOISE.map((variant) => costOf(variant.id).full)
    const projected = NOISE.map((variant) => costOf(variant.id).projected)

    expect(full.reduce((a, b) => a + b, 0)).toBe(64)
    expect(projected).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('is larger for a re-indent than for seven of the ten real bugs', () => {
    // The rubber-stamping mechanism in one assertion. Re-indenting the item
    // rows changes nothing at all and marks 24 lines; seven of the ten genuine
    // defects mark six lines or fewer. Diff size does not separate the two
    // populations here — it inverts them — so a reviewer who has learned to
    // skim the big ones has learned exactly the wrong lesson, and learned it
    // from the tool.
    const reindent = costOf('ITEM_ROWS_REINDENTED').full
    const smaller = BUGS.filter((bug) => costOf(bug.id).full <= 6)

    expect(reindent).toBe(24)
    expect(smaller).toHaveLength(7)
    expect(BUGS.filter((bug) => costOf(bug.id).full > reindent)).toHaveLength(1)
  })
})
