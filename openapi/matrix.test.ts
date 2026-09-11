// @vitest-environment node
/**
 * The experiment, run for real, against the claims in `README.md`.
 *
 * Twelve services, twelve real requests over real sockets, six wirings judging
 * each response: seventy-two cells, every one of them compared to the word the
 * README prints. The README is the claim and this is what fails when the claim
 * stops being true — not the other way round.
 *
 * Rows rather than cells. One `it` per drift, comparing the whole row at once,
 * because a row is what a reader of the README is looking at and because the
 * failure a reader needs is "`format-violation` now reads miss, catch, …", not
 * six separate assertions from which they reassemble that sentence.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { coverageOf } from './coverage.ts'
import { DRIFTS, type Drift } from './drifts.ts'
import { captureExchange } from './exchange.ts'
import { CONTROL, rowFor, runMatrix, scoreFor, type Matrix } from './matrix.ts'
import { expectedMatrix, expectedRow, expectedScores, type ExpectedMatrix } from './readme.ts'
import { renderReport } from './report.ts'
import { KNOWN_ORDER_ID } from './service.ts'
import { compileWiring, STRATEGIES } from './strategies.ts'

const KEYS = STRATEGIES.map((strategy) => strategy.key)

let matrix: Matrix
let claimed: ExpectedMatrix

beforeAll(async () => {
  matrix = await runMatrix()
  claimed = expectedMatrix(KEYS)

  // The whole table, into the log. When a cell disagrees the failure names that
  // cell, and the next question is always what the table looks like now —
  // answering it from six assertion failures is an exercise in reassembly.
  console.log(`\n${renderReport(matrix, matrix.exchanges)}\n`)
}, 60_000)

describe('the control row', () => {
  it('is quiet under every wiring', () => {
    expect(rowFor(matrix, CONTROL)).toEqual(KEYS.map(() => 'quiet'))
  })

  it('is why a wiring cannot score by rejecting everything', () => {
    expect(matrix.cells.filter((cell) => cell.outcome === 'alarm')).toEqual([])
  })
})

describe('the detection matrix', () => {
  it.each(DRIFTS.map((drift) => drift.key))('reads for `%s` what README.md claims', (drift) => {
    expect(rowFor(matrix, drift)).toEqual(expectedRow(claimed, drift))
  })
})

describe('the scores', () => {
  it.each(KEYS)('is what README.md claims for `%s`', (strategy) => {
    const score = scoreFor(matrix, strategy)

    expect(expectedScores().get(strategy)).toBe(`${score.caught}/${score.of}`)
  })
})

describe('what the table says, asserted rather than narrated', () => {
  const caught = (strategy: string): ReadonlySet<string> =>
    new Set(
      matrix.cells
        .filter((cell) => cell.strategy === strategy && cell.outcome === 'catch')
        .map((cell) => cell.drift),
    )

  const isSubset = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
    [...left].every((entry) => right.has(entry))

  it('gains more from the three envelope checks than from the whole dialect upgrade', () => {
    const lenient = scoreFor(matrix, 'body-schema').caught
    const strict = scoreFor(matrix, 'body-schema-strict').caught
    const envelope = scoreFor(matrix, 'full-response').caught

    expect(strict - lenient).toBe(2)
    expect(envelope - strict).toBe(3)
  })

  it('leaves `status-only` catching something both schema wirings miss', () => {
    expect(isSubset(caught('status-only'), caught('body-schema-strict'))).toBe(false)
  })

  it('leaves hand-written assertions catching something `body-schema` misses', () => {
    expect(isSubset(caught('handwritten'), caught('body-schema'))).toBe(false)
  })

  it('orders nothing below `full-response`, which dominates all four', () => {
    for (const strategy of ['status-only', 'handwritten', 'body-schema', 'body-schema-strict']) {
      expect(isSubset(caught(strategy), caught('full-response')), `${strategy} is not covered`).toBe(true)
    }
  })

  it('is silent everywhere on a bug that produced no output', () => {
    expect(rowFor(matrix, 'empty-collection')).toEqual(KEYS.map(() => 'miss'))
  })

  it('catches the same bug the moment a request makes it visible', () => {
    // `wrong-type` and `empty-collection` are the same transform. The only
    // difference is the request, and four wirings separate on it.
    expect(rowFor(matrix, 'wrong-type')).not.toEqual(rowFor(matrix, 'empty-collection'))
  })
})

describe('the corpus', () => {
  it('exercises every drift exactly once', () => {
    expect(matrix.exchanges.map((exchange) => exchange.drift)).toEqual(DRIFTS.map((drift) => drift.key))
  })

  it('leaves one declared operation untouched, whatever the wirings scored', () => {
    expect(coverageOf(matrix.exchanges).untouchedOperations).toEqual(['DELETE /orders/{orderId}'])
  })
})

/**
 * Not a drift — the service needs no help being wrong on this operation. This
 * is the request `drifts.ts` deliberately does not make, against the service as
 * written.
 */
const PROBE: Drift = {
  key: 'coverage-probe',
  blurb: 'The request the corpus does not make, against the service as written.',
  request: { method: 'DELETE', path: `/orders/${KNOWN_ORDER_ID}`, expect: 200 },
  transform: (response) => response,
}

describe('the operation the corpus never calls', () => {
  it('is reported by every wiring that reads the body, the instant a request reaches it', async () => {
    const exchange = await captureExchange(PROBE)
    const wiring = compileWiring()
    const silent = STRATEGIES.filter(
      (strategy) => strategy.check(exchange, wiring.lenient, wiring.strict).length === 0,
    ).map((strategy) => strategy.key)

    // `status-only` is the one that says nothing, and for the honest reason:
    // the handler answers 200, which is exactly what the document declares.
    // Everything wrong here is in the body, and `status-only` does not read it.
    // That is the same fact as its 1/11 in the matrix, not an exception to it.
    expect(silent).toEqual(['status-only'])
  }, 30_000)
})
