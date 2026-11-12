// Hundreds of milliseconds: the file that dominates a suite's wall clock and
// the only kind a total-only gate can see move.
import { expect, it } from 'vitest'

import { spin } from './work.ts'

it('does a lot of work', () => {
  expect(spin(120)).toBeGreaterThan(0)
})

it('does a lot more work', () => {
  expect(spin(120)).toBeGreaterThan(0)
})
