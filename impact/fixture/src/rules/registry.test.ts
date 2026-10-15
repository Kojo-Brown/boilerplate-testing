/**
 * The only test whose dependencies are chosen at run time.
 *
 * Nothing it imports mentions `bulk.rule.ts` or `weekend.rule.ts`. The loader
 * finds them with `readdir`.
 */

import { describe, expect, it } from 'vitest'

import { bestDiscount, loadRules } from './registry.ts'
import { line } from '../support/factory.ts'

describe('the rule registry', () => {
  it('loads every rule in its directory, in name order', async () => {
    expect((await loadRules()).map((rule) => rule.id)).toEqual(['bulk', 'weekend'])
  })

  it('offers the bulk discount at a qualifying quantity', async () => {
    expect(await bestDiscount(line({ quantity: 12 }))).toBeExactInteger(500)
  })

  it('offers the clearance discount on a clearance SKU', async () => {
    expect(await bestDiscount(line({ sku: 'CLR-9', quantity: 1 }))).toBeExactInteger(250)
  })

  it('offers nothing when no rule applies', async () => {
    expect(await bestDiscount(line({ quantity: 1 }))).toBeExactInteger(0)
  })
})
