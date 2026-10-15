/**
 * The snapshotted test.
 *
 * Its baseline lives in `src/__snapshots__/label.test.ts.snap` — a file this
 * test depends on completely and imports not at all. The dependency is a
 * naming convention of the runner, which is exactly the kind of edge
 * `edges.ts` derives rather than asks anyone to declare.
 */

import { describe, expect, it } from 'vitest'

import { receipt } from './label.ts'
import { lines } from './support/factory.ts'

describe('the receipt', () => {
  it('lists every line above the total', () => {
    expect(receipt(lines(2), 1_500)).toMatchSnapshot()
  })

  it('formats the total in major units', () => {
    expect(receipt([], 2_500)).toBe('TOTAL $25.00')
  })
})
