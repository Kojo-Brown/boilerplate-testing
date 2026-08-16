// @vitest-environment node
/**
 * The ledger's own invariants: never oversell, never half-reserve.
 *
 * Every one of these is a claim the London suite cannot make, because in that
 * design `Inventory` is an interface whose implementation nobody has written
 * yet. What the London tests pin instead is the orchestrator's unwind protocol
 * — which only exists because the port is too thin to hold this invariant.
 */

import { describe, it, expect } from 'vitest'
import { Inventory } from './inventory'

describe('Inventory', () => {
  it('reports what is on hand, and nothing for an unknown sku', () => {
    const inventory = new Inventory({ LATTE: 5 })

    expect(inventory.availableOf('LATTE')).toBe(5)
    expect(inventory.availableOf('NOT_A_THING')).toBe(0)
  })

  it('holds stock it has', () => {
    const inventory = new Inventory({ LATTE: 5 })

    expect(inventory.reserve([{ sku: 'LATTE', quantity: 2 }])).toBe(true)
    expect(inventory.availableOf('LATTE')).toBe(3)
  })

  it('refuses to oversell a single line', () => {
    const inventory = new Inventory({ LATTE: 1 })

    expect(inventory.reserve([{ sku: 'LATTE', quantity: 2 }])).toBe(false)
    expect(inventory.availableOf('LATTE')).toBe(1)
  })

  it('holds every line or none of them', () => {
    const inventory = new Inventory({ LATTE: 5, BEAN_BAG: 0 })

    const held = inventory.reserve([
      { sku: 'LATTE', quantity: 1 },
      { sku: 'BEAN_BAG', quantity: 1 },
    ])

    expect(held).toBe(false)
    expect(inventory.availableOf('LATTE')).toBe(5)
  })

  it('totals repeated skus into one claim on one pile', () => {
    const inventory = new Inventory({ LATTE: 3 })

    // Checked line by line, each of these fits; together they do not.
    const held = inventory.reserve([
      { sku: 'LATTE', quantity: 2 },
      { sku: 'LATTE', quantity: 2 },
    ])

    expect(held).toBe(false)
    expect(inventory.availableOf('LATTE')).toBe(3)
  })

  it('gives stock back on release', () => {
    const inventory = new Inventory({ LATTE: 5 })
    const lines = [{ sku: 'LATTE', quantity: 2 }]

    inventory.reserve(lines)
    inventory.release(lines)

    expect(inventory.availableOf('LATTE')).toBe(5)
  })

  it('lets a second order take what a released one gave back', () => {
    const inventory = new Inventory({ LATTE: 2 })
    const lines = [{ sku: 'LATTE', quantity: 2 }]

    inventory.reserve(lines)
    expect(inventory.reserve(lines)).toBe(false)

    inventory.release(lines)
    expect(inventory.reserve(lines)).toBe(true)
  })
})
