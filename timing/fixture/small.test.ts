// Single-digit milliseconds: the modal unit test file.
import { expect, it } from 'vitest'

import { spin } from './work.ts'

it('does a little work', () => {
  expect(spin(4)).toBeGreaterThan(0)
})

it('does a little more', () => {
  expect(spin(4)).toBeGreaterThan(0)
})
