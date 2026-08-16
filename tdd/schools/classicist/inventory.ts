/**
 * Inventory — a real stock ledger, and the clearest place the two designs part.
 *
 * The London orchestrator reserves one sku at a time and unwinds its own
 * partial reservations, because a mocked `reserve(sku, qty)` cannot be
 * all-or-nothing on its own and the atomicity had to live somewhere the test
 * could see it. Here the ledger is a real object with real state, so
 * atomicity is its job: `reserve` takes the whole order and either holds all
 * of it or none of it, and the caller has nothing to unwind.
 *
 * That is not a small difference. The London tests pin down an unwind protocol
 * that this design does not have, and this design's tests pin down an
 * invariant — never oversell, never half-reserve — that the London tests
 * cannot state, because in that design nothing owns it.
 */

import type { OrderLine, Sku } from '../orderContract'

export class Inventory {
  private readonly levels: Map<Sku, number>

  constructor(levels: Readonly<Record<Sku, number>>) {
    this.levels = new Map(Object.entries(levels))
  }

  availableOf(sku: Sku): number {
    return this.levels.get(sku) ?? 0
  }

  /**
   * Hold every line, or nothing at all.
   *
   * Lines are totalled per sku first: two lines of the same sku are one claim
   * on one pile of stock, and checking them independently would let an order
   * reserve five of the last three.
   */
  reserve(lines: readonly OrderLine[]): boolean {
    const wanted = totalPerSku(lines)

    for (const [sku, quantity] of wanted) {
      if (this.availableOf(sku) < quantity) return false
    }

    for (const [sku, quantity] of wanted) {
      this.levels.set(sku, this.availableOf(sku) - quantity)
    }
    return true
  }

  release(lines: readonly OrderLine[]): void {
    for (const [sku, quantity] of totalPerSku(lines)) {
      this.levels.set(sku, this.availableOf(sku) + quantity)
    }
  }
}

function totalPerSku(lines: readonly OrderLine[]): Map<Sku, number> {
  const totals = new Map<Sku, number>()
  for (const line of lines) {
    totals.set(line.sku, (totals.get(line.sku) ?? 0) + line.quantity)
  }
  return totals
}
