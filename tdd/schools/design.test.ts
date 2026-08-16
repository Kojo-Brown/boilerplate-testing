// @vitest-environment node
/**
 * The audit that keeps the comparison from quietly becoming untrue.
 *
 * `README.md` makes structural claims — the London design substitutes six
 * collaborators and ships no implementation of any of them; the classicist
 * design substitutes one, at the payment boundary, and uses the production
 * classes for the rest. Those are the whole argument, and prose cannot defend
 * them: a later refactor that gave the London module a default catalogue, or
 * that swapped a real `Inventory` for a stub in the classicist wiring, would
 * leave every word of the README in place and every word of it wrong.
 *
 * So the claims are derived from the code that actually runs the contract.
 * The same reasoning as `../katas.test.ts`, applied to a different kind of
 * claim: a copy of a fact is a comment, and comments rot.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import * as londonEntryPoint from './london/placeOrder'
import { LONDON_SEAMS } from './london/placeOrder'
import { buildLondonWiring } from './london/world'

import * as catalogueModule from './classicist/catalogue'
import * as inventoryModule from './classicist/inventory'
import * as moneyModule from './classicist/money'
import * as orderIdsModule from './classicist/orderIds'
import { CLASSICIST_DOUBLES } from './classicist/placeOrder'
import { buildClassicistWiring } from './classicist/world'

import type { Scenario } from './orderContract'

const SCENARIO: Scenario = {
  prices: { LATTE: 350 },
  stock: { LATTE: 5 },
  promos: { SPRING: { percentOff: 25, expiresAt: '2026-04-01T00:00:00.000Z' } },
}

type Constructor = new (...args: never[]) => object

function isConstructor(value: unknown): value is Constructor {
  return typeof value === 'function'
}

/**
 * Every class the classicist design ships as production code.
 *
 * Collected from the modules rather than listed, so a new domain class joins
 * the audit by existing. `placeOrder.ts` and `order.ts` are not read: they
 * export functions and an interface, and `fakePaymentGateway.ts` is test
 * support, which is precisely what must not count as production here.
 */
const PRODUCTION_CLASSES: Constructor[] = [
  catalogueModule,
  inventoryModule,
  moneyModule,
  orderIdsModule,
]
  .flatMap((module) => Object.values(module))
  .filter(isConstructor)

function isProductionObject(value: unknown): boolean {
  return PRODUCTION_CLASSES.some((cls) => value instanceof cls)
}

const readmePath = fileURLToPath(new URL('./README.md', import.meta.url))
const readme = readFileSync(readmePath, 'utf8')

describe('the London design', () => {
  it('ships an orchestrator and nothing else — every collaborator is an interface', () => {
    // Interfaces are erased at runtime, so a module that exported even one
    // implementation of a port would show up here as an extra binding.
    expect(Object.keys(londonEntryPoint).sort()).toEqual(['LONDON_SEAMS', 'createPlaceOrder'])
  })

  it('substitutes every collaborator it has', () => {
    const { deps } = buildLondonWiring(SCENARIO)

    expect(Object.keys(deps).sort()).toEqual([...LONDON_SEAMS])
    expect(LONDON_SEAMS).toHaveLength(6)
  })

  it('has no production object anywhere in its wiring', () => {
    const { deps } = buildLondonWiring(SCENARIO)

    // Not a tautology from the previous test: this asserts the stubs in
    // `london/world.ts` are stubs, i.e. that nobody quietly imported a real
    // `Catalogue` or `Inventory` from the classicist folder to save typing.
    expect(Object.values(deps).filter(isProductionObject)).toEqual([])
  })
})

describe('the classicist design', () => {
  it('substitutes only the payment gateway', () => {
    const { collaborators } = buildClassicistWiring(SCENARIO)

    const doubled = Object.entries(collaborators)
      .filter(([, collaborator]) => !isProductionObject(collaborator))
      .map(([name]) => name)
      .sort()

    expect(doubled).toEqual([...CLASSICIST_DOUBLES])
    expect(CLASSICIST_DOUBLES).toHaveLength(1)
  })

  it('hands the feature the same classes production would', () => {
    const { collaborators } = buildClassicistWiring(SCENARIO)

    expect(collaborators.catalogue).toBeInstanceOf(catalogueModule.Catalogue)
    expect(collaborators.promotions).toBeInstanceOf(catalogueModule.Promotions)
    expect(collaborators.inventory).toBeInstanceOf(inventoryModule.Inventory)
    expect(collaborators.orderIds).toBeInstanceOf(orderIdsModule.SequentialOrderIds)
  })
})

describe('the README', () => {
  it('names every seam the London design substitutes', () => {
    for (const seam of LONDON_SEAMS) {
      expect(readme, `README does not mention the \`${seam}\` port`).toContain(`\`${seam}\``)
    }
  })

  it('names every seam the classicist design substitutes', () => {
    for (const seam of CLASSICIST_DOUBLES) {
      expect(readme, `README does not mention the \`${seam}\` double`).toContain(`\`${seam}\``)
    }
  })

  it('quotes the two seam counts the comparison turns on', () => {
    // The headline numbers, checked against the arrays they describe rather
    // than against somebody's memory of them.
    expect(readme).toContain(`substitutes ${LONDON_SEAMS.length} collaborators`)
    expect(readme).toContain(`substitutes ${CLASSICIST_DOUBLES.length} collaborator`)
  })
})
