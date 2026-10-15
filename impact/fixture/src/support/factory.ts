/**
 * A test helper, and not a test.
 *
 * Two test files import it; nothing in `src/` does. A selector that asks "which
 * *test* files import the changed file" finds nothing here, because the answer
 * runs through a file that is not a test — which is why reachability has to be
 * computed over the whole graph rather than over the test files in it.
 */

import type { Line } from '../money.ts'

export function line(overrides: Partial<Line> = {}): Line {
  return { sku: 'SKU-1', unitCents: 250, quantity: 3, ...overrides }
}

export function lines(count: number): readonly Line[] {
  return Array.from({ length: count }, (_unused, index) => line({ sku: `SKU-${String(index + 1)}` }))
}
