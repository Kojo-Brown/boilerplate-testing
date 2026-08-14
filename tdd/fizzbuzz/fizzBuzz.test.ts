// @vitest-environment node
//
// FizzBuzz kata. Read tdd/README.md for the step-by-step log; every commit on
// the PR branch is one red, green or refactor move.

import { describe, it, expect } from 'vitest'
import { fizzBuzz } from './fizzBuzz'

describe('fizzBuzz', () => {
  it('returns "1" for 1', () => {
    expect(fizzBuzz(1)).toBe('1')
  })
})
