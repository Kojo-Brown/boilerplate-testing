// @vitest-environment node
/**
 * The matrix, derived and checked against the README in both directions.
 *
 * Both directions is the part that matters. Checking that every cell the
 * README states matches the run catches a wiring whose behaviour changed;
 * checking that every cell the run produces is stated catches a README that
 * has fallen a column behind, which is the direction documentation always rots
 * in and the one a spot-check never finds.
 *
 * The findings below are the README's prose, restated as assertions. A
 * sentence like "adding a TTL sweep to a working close hook buys nothing" is a
 * claim about two numbers and three cells; leaving it only in prose means the
 * next person to change a control leaves a confident, wrong paragraph behind.
 */

import { describe, expect, it } from 'vitest'

import { HAZARDS, hazardByKey } from './hazards.ts'
import { derive, outcomeFor, scoreText, type Matrix } from './matrix.ts'
import { expectedMatrix, expectedScores } from './readme.ts'
import { STRATEGIES, strategyKeys } from './strategies.ts'

const STRATEGY_KEYS = strategyKeys()
const matrix: Matrix = derive()
const claimed = expectedMatrix(STRATEGY_KEYS)

const differing = (left: string, right: string): readonly string[] =>
  HAZARDS.filter((hazard) => outcomeFor(matrix, hazard.key, left) !== outcomeFor(matrix, hazard.key, right)).map(
    (hazard) => hazard.key,
  )

describe('the derived matrix', () => {
  it('produces a cell for every hazard against every wiring', () => {
    expect(matrix.cells).toHaveLength(HAZARDS.length * STRATEGIES.length)
  })

  it('matches every outcome the README states', () => {
    for (const hazard of claimed.hazards) {
      for (const strategy of claimed.strategies) {
        expect(
          outcomeFor(matrix, hazard, strategy),
          `${hazard}/${strategy}`,
        ).toBe(claimed.cells.get(`${hazard}/${strategy}`))
      }
    }
  })

  it('states in the README every outcome it produces', () => {
    for (const cell of matrix.cells) {
      expect(
        claimed.cells.get(`${cell.hazard}/${cell.strategy}`),
        `${cell.hazard}/${cell.strategy} is missing from README.md`,
      ).toBe(cell.outcome)
    }
  })

  it('matches every score the README states', () => {
    for (const [strategy, score] of expectedScores()) {
      expect(scoreText(matrix, strategy), strategy).toBe(score)
    }
  })

  it('is reproducible: a second derivation is cell-for-cell identical', () => {
    expect(derive().cells).toEqual(matrix.cells)
  })

  it('refuses to report a pair it never ran', () => {
    expect(() => outcomeFor(matrix, 'invented', 'manual')).toThrow('no cell for')
  })
})

describe('the headline', () => {
  it('scores the standard answer one cell above doing it by hand', () => {
    expect(scoreText(matrix, 'on-close')).toBe('3/12')
    expect(scoreText(matrix, 'manual')).toBe('2/12')
  })

  it('leaves eight cells between the standard answer and the top of the table', () => {
    const top = matrix.scores.get('namespace-reconciled')
    const standard = matrix.scores.get('on-close')

    expect((top?.handled ?? 0) - (standard?.handled ?? 0)).toBe(8)
  })

  /**
   * The README's claim that five of those eight are about something other than
   * teardown. Named explicitly rather than counted, because "is this hazard
   * about teardown" is a judgement and a count would hide it.
   */
  it('owes five of those eight to which commit runs, whose data it is, and who may deploy', () => {
    const newlyHandled = HAZARDS.filter(
      (hazard) =>
        outcomeFor(matrix, hazard.key, 'on-close') !== hazard.correct &&
        outcomeFor(matrix, hazard.key, 'namespace-reconciled') === hazard.correct,
    ).map((hazard) => hazard.key)

    expect(newlyHandled).toHaveLength(8)
    for (const key of [
      'racing-pushes',
      'fork-pr-unreviewed',
      'fork-pr-approved',
      'cross-pr-write',
      'migration-in-pr',
    ]) {
      expect(newlyHandled).toContain(key)
    }
  })
})

describe('adding a TTL sweep to a working close hook', () => {
  it('leaves the score exactly where it was', () => {
    expect(scoreText(matrix, 'on-close-ttl')).toBe(scoreText(matrix, 'on-close-seeded'))
  })

  it('is not inert: it moves three cells', () => {
    expect(differing('on-close-seeded', 'on-close-ttl')).toEqual([
      'long-review',
      'teardown-cancelled',
      'platform-created-resource',
    ])
  })

  it('trades a silent leak for a review environment deleted underneath a reviewer', () => {
    expect(outcomeFor(matrix, 'teardown-cancelled', 'on-close-seeded')).toBe('leaked')
    expect(outcomeFor(matrix, 'teardown-cancelled', 'on-close-ttl')).toBe('reaped')
    expect(outcomeFor(matrix, 'long-review', 'on-close-seeded')).toBe('live')
    expect(outcomeFor(matrix, 'long-review', 'on-close-ttl')).toBe('broken')
  })
})

describe('the two wirings at five out of twelve', () => {
  it('score the same', () => {
    expect(scoreText(matrix, 'on-close-cancel')).toBe('5/12')
    expect(scoreText(matrix, 'ttl-reaper')).toBe('5/12')
  })

  it('agree on two of the five hazards each of them handles, and on nothing else', () => {
    const handledBy = (strategy: string): readonly string[] =>
      HAZARDS.filter(
        (hazard) => outcomeFor(matrix, hazard.key, strategy) === hazard.correct,
      ).map((hazard) => hazard.key)

    const left = new Set(handledBy('on-close-cancel'))
    const shared = handledBy('ttl-reaper').filter((key) => left.has(key))

    expect(left.size).toBe(5)
    expect(shared).toEqual(['pushed-a-fix', 'racing-pushes'])
  })
})

describe('cancel-in-progress', () => {
  it('is worth exactly two cells', () => {
    expect(differing('on-close', 'on-close-cancel')).toEqual(['racing-pushes', 'zombie-deploy'])
  })

  it('fixes a teardown failure with a deploy control', () => {
    expect(outcomeFor(matrix, 'zombie-deploy', 'on-close')).toBe('leaked')
    expect(outcomeFor(matrix, 'zombie-deploy', 'on-close-cancel')).toBe('clean')
  })
})

describe('an owned namespace', () => {
  it('is worth exactly one cell, and it is the one a state file cannot reach', () => {
    expect(differing('on-close-seeded', 'namespace-owned')).toEqual(['platform-created-resource'])
  })

  it('turns an orphan into a clean account without changing when teardown runs', () => {
    expect(outcomeFor(matrix, 'platform-created-resource', 'on-close-seeded')).toBe('orphaned')
    expect(outcomeFor(matrix, 'platform-created-resource', 'namespace-owned')).toBe('clean')
  })

  it('is beaten to it by a label sweep, one interval late', () => {
    expect(outcomeFor(matrix, 'platform-created-resource', 'on-close-ttl')).toBe('reaped')
  })
})

describe('the security row', () => {
  it('is handled by the control and by one wiring, and by nothing in between', () => {
    const clean = STRATEGY_KEYS.filter(
      (strategy) => outcomeFor(matrix, 'fork-pr-unreviewed', strategy) === 'clean',
    )

    expect(clean).toEqual(['manual', 'namespace-reconciled'])
  })

  it('leaves `pull_request` safe and useless across the two fork hazards', () => {
    expect(outcomeFor(matrix, 'fork-pr-unreviewed', 'manual')).toBe('clean')
    expect(outcomeFor(matrix, 'fork-pr-approved', 'manual')).toBe('broken')
  })

  it('stays exposed after approval, because the secret already ran', () => {
    expect(outcomeFor(matrix, 'fork-pr-approved', 'on-close')).toBe('exposed')
  })

  it('is passed by only the label-gated wiring on both rows', () => {
    const both = STRATEGY_KEYS.filter(
      (strategy) =>
        outcomeFor(matrix, 'fork-pr-unreviewed', strategy) === hazardByKey('fork-pr-unreviewed').correct &&
        outcomeFor(matrix, 'fork-pr-approved', strategy) === hazardByKey('fork-pr-approved').correct,
    )

    expect(both).toEqual(['namespace-reconciled'])
  })
})

describe('the row nothing handles', () => {
  it('reads `leaked` in every column', () => {
    for (const strategy of STRATEGY_KEYS) {
      expect(outcomeFor(matrix, 'sweep-never-ran', strategy), strategy).toBe('leaked')
    }
  })

  it('is the only hazard no wiring gets right', () => {
    const unhandled = HAZARDS.filter((hazard) =>
      STRATEGY_KEYS.every((strategy) => outcomeFor(matrix, hazard.key, strategy) !== hazard.correct),
    )

    expect(unhandled.map((hazard) => hazard.key)).toEqual(['sweep-never-ran'])
  })
})

describe('the recommendation', () => {
  it('is the highest-scoring wiring, and nothing ties with it', () => {
    const ranked = [...matrix.scores.entries()].sort(
      ([, left], [, right]) => right.handled - left.handled,
    )

    expect(ranked[0]?.[0]).toBe('namespace-reconciled')
    expect(ranked[0]?.[1].handled).toBeGreaterThan(ranked[1]?.[1].handled ?? 0)
  })

  it('handles everything except the row that has no wiring-shaped answer', () => {
    const missed = HAZARDS.filter(
      (hazard) => outcomeFor(matrix, hazard.key, 'namespace-reconciled') !== hazard.correct,
    )

    expect(missed.map((hazard) => hazard.key)).toEqual(['sweep-never-ran'])
  })
})
