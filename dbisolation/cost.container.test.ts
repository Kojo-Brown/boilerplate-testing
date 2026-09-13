/**
 * What each strategy charges per test.
 *
 * The figures are logged and the *orderings* are asserted. Absolute
 * milliseconds are a property of the machine — the README's table was taken on
 * one and the CI runner is slower — and a suite that pinned them would be red
 * on arrival and edited rather than read. Every ordering in `COST_ORDERINGS`
 * names a pair with a multiple between them, so a uniformly slower machine
 * scales both sides.
 *
 * Serial by construction: `measureCosts` runs the strategies one after another,
 * which is why this file does not share the `beforeAll` with the other two
 * container suites.
 */

import { describe, expect, it } from 'vitest'

import type { Cost } from './cost.ts'
import { CONNECT_ONLY, COST_ORDERINGS, costFor, ITERATIONS, measureConnection, measureCosts } from './cost.ts'
import { statedOrderings } from './readme.ts'
import { renderCosts } from './report.ts'
import { STRATEGIES } from './strategies.ts'
import { nonceFor, usePostgresServer } from './fixture.ts'

const server = usePostgresServer('cost')

describe('database isolation: cost', () => {
  let costs: readonly Cost[]

  beforeAll(async () => {
    const nonce = nonceFor('cost')
    const baseline = await measureConnection(server(), nonce)

    costs = [baseline, ...(await measureCosts(server(), nonce))]

    console.info(`\n[dbisolation] cost, median of ${ITERATIONS} iterations\n${renderCosts(costs)}`)
  }, 600_000)

  it('measures every strategy and the baseline', () => {
    expect(costs.map((cost) => cost.strategy)).toEqual([CONNECT_ONLY, ...STRATEGIES.map((strategy) => strategy.key)])

    for (const cost of costs) {
      expect(cost.perTestMs, cost.strategy).toHaveLength(ITERATIONS)
    }
  })

  it.each(COST_ORDERINGS)('has $cheaper cheaper than $dearer', ({ cheaper, dearer }) => {
    expect(costFor(costs, cheaper).medianMs, `${cheaper} vs ${dearer}`).toBeLessThan(costFor(costs, dearer).medianMs)
  })

  it('states every ordering in the README, and no others', () => {
    expect(statedOrderings().map((ordering) => `${ordering.cheaper}<${ordering.dearer}`)).toEqual(
      COST_ORDERINGS.map((ordering) => `${ordering.cheaper}<${ordering.dearer}`),
    )
  })

  // The baseline row is the point of the table: the rollback family's advantage
  // is partly a connection it never opens, and `none` is what that costs.
  it('charges for a connection before any strategy resets anything', () => {
    expect(costFor(costs, CONNECT_ONLY).medianMs).toBeLessThan(costFor(costs, 'none').medianMs)
    expect(costFor(costs, CONNECT_ONLY).medianMs).toBeGreaterThan(costFor(costs, 'rollback-savepoint').medianMs)
  })
})
