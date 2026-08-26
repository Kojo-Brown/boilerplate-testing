/**
 * The example suite, run.
 *
 * `examples.ts` holds the cases as data so that `probes.ts` can run the same
 * corpus against a broken system; this file is what makes them a test suite. It
 * is deliberately the plainest file in the directory — one case, one
 * assertion — because half the point of the comparison is that an example
 * suite is the thing everybody already knows how to write.
 */

import { describe, expect, it } from 'vitest'
import { availability } from './availability'
import { EXAMPLES, exampleNamed, valuesMatch } from './examples'

describe('availability, by example', () => {
  for (const example of EXAMPLES) {
    it(example.title, () => {
      expect(example.actual(availability)).toEqual(example.expected)
    })
  }
})

describe('the corpus itself', () => {
  it('gives every case a distinct id, so the matrix can name one', () => {
    const ids = EXAMPLES.map((example) => example.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('says which documented behaviour every case exists for', () => {
    for (const example of EXAMPLES) {
      expect(example.covers.length, `${example.id} has no stated reason`).toBeGreaterThan(10)
    }
  })

  it('finds a case by id and refuses one that does not exist', () => {
    expect(exampleNamed('normalise/empty-input').expected).toEqual([])
    expect(() => exampleNamed('normalise/no-such-case')).toThrow('no example named')
  })
})

describe('valuesMatch, which the probe compares with', () => {
  // The probe cannot use `expect`, so it compares with this instead. A
  // comparison that quietly said "equal" to everything would make the examples
  // column of the matrix a row of ticks, so it gets its own tests.
  it('compares range sets by their endpoints', () => {
    expect(valuesMatch([{ start: 0, end: 2 }], [{ start: 0, end: 2 }])).toBe(true)
    expect(valuesMatch([{ start: 0, end: 2 }], [{ start: 0, end: 3 }])).toBe(false)
  })

  it('separates a shorter set from a longer one with the same prefix', () => {
    expect(valuesMatch([{ start: 0, end: 2 }], [{ start: 0, end: 2 }, { start: 4, end: 5 }])).toBe(
      false,
    )
  })

  it('compares booleans and numbers by value', () => {
    expect(valuesMatch(true, true)).toBe(true)
    expect(valuesMatch(true, false)).toBe(false)
    expect(valuesMatch(8, 8)).toBe(true)
    expect(valuesMatch(8, 9)).toBe(false)
  })

  it('separates an empty set from a zero-length answer', () => {
    expect(valuesMatch([], 0)).toBe(false)
  })
})
