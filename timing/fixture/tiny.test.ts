// A suite that does essentially nothing. Present because the interesting
// question about a per-file timing gate is what it does to files like this
// one: a 1ms file that the scheduler happens to give 3ms to has regressed
// 200% and nothing has happened.
import { expect, it } from 'vitest'

import { spin } from './work.ts'

it('is fast', () => {
  expect(spin(0)).toBeGreaterThanOrEqual(0)
})

it('is fast twice', () => {
  expect(spin(0)).toBeGreaterThanOrEqual(0)
})
