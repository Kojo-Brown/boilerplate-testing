// @vitest-environment node
//
// FizzBuzz kata. Read tdd/README.md for the step-by-step log; every commit on
// the PR branch is one red, green or refactor move.

import { describe, it, expect } from 'vitest'
import { fizzBuzz, fizzBuzzUpTo } from './fizzBuzz'

describe('fizzBuzz', () => {
  it('returns "1" for 1', () => {
    expect(fizzBuzz(1)).toBe('1')
  })

  it('returns "2" for 2', () => {
    expect(fizzBuzz(2)).toBe('2')
  })

  it('returns "Fizz" for 3', () => {
    expect(fizzBuzz(3)).toBe('Fizz')
  })

  it('returns "Buzz" for 5', () => {
    expect(fizzBuzz(5)).toBe('Buzz')
  })

  it('returns "FizzBuzz" for 15', () => {
    expect(fizzBuzz(15)).toBe('FizzBuzz')
  })
})

describe('fizzBuzzUpTo', () => {
  it('lists the first fifteen answers in order', () => {
    expect(fizzBuzzUpTo(15)).toEqual([
      '1',
      '2',
      'Fizz',
      '4',
      'Buzz',
      'Fizz',
      '7',
      '8',
      'Fizz',
      'Buzz',
      '11',
      'Fizz',
      '13',
      '14',
      'FizzBuzz',
    ])
  })
})
