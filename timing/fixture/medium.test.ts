// Tens of milliseconds: a suite with a render or a parse in it.
import { expect, it } from 'vitest'

import { spin } from './work.ts'

it('does some work', () => {
  expect(spin(25)).toBeGreaterThan(0)
})

it('does some more work', () => {
  expect(spin(25)).toBeGreaterThan(0)
})
