// One slow test among fast ones — the shape that makes a per-file budget
// coarse: the file's duration is one number and this file is one test's worth
// of it.
import { expect, it } from 'vitest'

import { spin } from './work.ts'

it('is the slow one', () => {
  expect(spin(60)).toBeGreaterThan(0)
})

it('is not', () => {
  expect(spin(1)).toBeGreaterThan(0)
})

it('is not either', () => {
  expect(spin(1)).toBeGreaterThan(0)
})
