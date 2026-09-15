// @vitest-environment node
/**
 * The experiment, run for real, against the claims in `README.md`.
 *
 * Eighty-eight cells, every one compared to the word the README prints. The
 * README is the claim and this is what fails when the claim stops being true,
 * not the other way round. The node environment is the repository's convention
 * for a suite that reads a file off disk: `readme.ts` resolves its path from
 * `import.meta.url`, which is not a `file:` URL under jsdom.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import { HAZARDS } from './hazards.ts'
import { cellFor, rowFor, runMatrix, scoreFor, type Matrix } from './matrix.ts'
import { expectedMatrix, expectedRow, expectedScores, type ExpectedMatrix } from './readme.ts'
import { OUTCOMES } from './scoring.ts'
import { STRATEGIES } from './strategies.ts'

const STRATEGY_KEYS = STRATEGIES.map((strategy) => strategy.key)

let matrix: Matrix
let claimed: ExpectedMatrix

beforeAll(async () => {
  matrix = await runMatrix()
  claimed = expectedMatrix(STRATEGY_KEYS)
})

describe('the run', () => {
  it('produces a cell for every pairing and no others', () => {
    expect(matrix.cells).toHaveLength(HAZARDS.length * STRATEGIES.length)
    expect(new Set(matrix.cells.map((cell) => `${cell.hazard}/${cell.strategy}`)).size).toBe(
      matrix.cells.length,
    )
  })

  it('only ever reports a word from the vocabulary', () => {
    for (const cell of matrix.cells) {
      expect(OUTCOMES).toContain(cell.outcome)
    }
  })

  /**
   * The control. Without a row every strategy passes, a column of failures
   * cannot be told from a harness that breaks everything it touches.
   */
  it('finds every strategy correct when nothing goes wrong', () => {
    expect(rowFor(matrix, 'clean')).toEqual(STRATEGIES.map(() => 'safe'))
  })

  it('is deterministic: a second run produces the same table', async () => {
    const again = await runMatrix()

    expect(again.cells).toEqual(matrix.cells)
  })
})

describe('the README', () => {
  it('claims a row for every hazard and no others', () => {
    expect(claimed.hazards).toEqual(HAZARDS.map((hazard) => hazard.key))
  })

  /**
   * Both directions. A cell the README claims and the run does not produce is a
   * stale document; a cell the run produces and the README does not mention is
   * an undocumented result. Only checking one of those is how a table drifts.
   */
  it.each(HAZARDS.map((hazard) => hazard.key))('matches the live run for %s', (hazard: string) => {
    expect(rowFor(matrix, hazard)).toEqual(expectedRow(claimed, hazard))
  })

  it('states the score every column actually earned', () => {
    const scores = expectedScores()

    for (const strategy of STRATEGIES) {
      const live = scoreFor(matrix, strategy.key)

      expect(scores.get(strategy.key)).toBe(`${String(live.handled)}/${String(live.of)}`)
    }
  })
})

/**
 * The findings, as assertions.
 *
 * Each of these is a sentence the README makes in prose, restated as something
 * that fails. Prose in a README rots quietly; a claim with a test under it does
 * not. They are deliberately stated in terms of cells rather than recomputed
 * from the same code that produced them.
 */
describe('the findings', () => {
  it('scores backoff exactly as well as doing nothing', () => {
    expect(scoreFor(matrix, 'retry-backoff')).toEqual(scoreFor(matrix, 'none'))
  })

  it('scores the most commonly written implementation no better than the control', () => {
    expect(scoreFor(matrix, 'memo-after').handled).toBe(scoreFor(matrix, 'none').handled)
  })

  /**
   * And the reason the previous claim is not pedantry: `memo-after` passes the
   * one hazard anybody writes a test for.
   */
  it('lets the most commonly written implementation pass the only hazard usually tested', () => {
    expect(cellFor(matrix, 'sequential-retry', 'memo-after').outcome).toBe('safe')
  })

  it('finds the same window from the outside and the inside', () => {
    expect(cellFor(matrix, 'concurrent-retry', 'memo-after').outcome).toBe('duplicate')
    expect(cellFor(matrix, 'crash-after-effect', 'memo-after').outcome).toBe('duplicate')
  })

  it('scores a lease with no recovery below the design it improves on', () => {
    expect(scoreFor(matrix, 'lease').handled).toBeLessThan(scoreFor(matrix, 'memo-before').handled)
  })

  it('leaves only the two strategies that key their gateway call safe from a crash after it', () => {
    const survivors = STRATEGIES.filter(
      (strategy) => cellFor(matrix, 'crash-after-gateway', strategy.key).outcome === 'safe',
    ).map((strategy) => strategy.key)

    expect(survivors).toEqual(['lease-recovering', 'atomic-outbox'])
  })

  it('produces its only orphaned money where a key is committed and the charge is not', () => {
    const orphaned = matrix.cells
      .filter((cell) => cell.outcome === 'orphaned')
      .map((cell) => `${cell.hazard}/${cell.strategy}`)

    expect(orphaned).toEqual(['crash-after-gateway/memo-before', 'crash-after-gateway/lease'])
  })

  /** Every strategy with a key table fails; the three without one pass. */
  it('makes a key table the thing that loses retry-after-decline', () => {
    const passed = STRATEGIES.filter(
      (strategy) => cellFor(matrix, 'retry-after-decline', strategy.key).outcome === 'safe',
    ).map((strategy) => strategy.key)

    expect(passed).toEqual(['none', 'retry-backoff', 'natural-key'])
  })

  it('rejects a reused key only where a fingerprint was stored', () => {
    const rejected = STRATEGIES.filter(
      (strategy) => cellFor(matrix, 'different-body-same-key', strategy.key).outcome === 'rejected',
    ).map((strategy) => strategy.key)

    expect(rejected).toEqual(['lease-recovering', 'atomic-outbox'])
  })

  it('loses one customer\'s charge to another only where the key is unscoped', () => {
    const leaked = STRATEGIES.filter(
      (strategy) => cellFor(matrix, 'cross-principal-key', strategy.key).outcome === 'wrong-response',
    ).map((strategy) => strategy.key)

    expect(leaked).toEqual(['memo-after'])
  })

  /**
   * The shape of `lease-recovering`'s failure, which is the one cell in the
   * table where the row and the money disagree.
   */
  it('duplicates a row but not the money when a recovered lease re-runs the work', () => {
    for (const hazard of ['crash-after-effect', 'key-expired']) {
      const cell = cellFor(matrix, hazard, 'lease-recovering')

      expect(cell.outcome).toBe('duplicate')
      expect(cell.charges).toBe(2)
      expect(cell.gatewayEffects).toBe(1)
    }
  })

  it('ranks the outbox first and the natural key second', () => {
    const ranked = [...STRATEGIES]
      .map((strategy) => ({ key: strategy.key, ...scoreFor(matrix, strategy.key) }))
      .sort((left, right) => right.handled - left.handled)

    expect(ranked[0]?.key).toBe('atomic-outbox')
    expect(ranked[1]?.key).toBe('natural-key')
  })
})
