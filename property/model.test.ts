/**
 * The oracle, tested.
 *
 * A model-based property is only as trustworthy as its model, and the model
 * here is the thing every other suite in this directory is measured against.
 * If `toPoints`/`fromPoints` were wrong, five of the twenty invariants would be
 * asserting agreement with a bug — and they would still pass, because the
 * system and the model would have to be wrong in different ways for anything
 * to notice.
 *
 * So this file tests the model the only way a model can be tested: by example,
 * against values a person can read. That is not a fallback. It is the point at
 * which the regress has to stop, and stopping it somewhere obvious enough to
 * check by eye is what makes `model.ts` worth having.
 */

import { describe, expect, it } from 'vitest'
import { interval, normalise } from './availability'
import {
  assertWithinDomain,
  DOMAIN,
  fromPoints,
  intersectPoints,
  samePoints,
  subtractPoints,
  toPoints,
  unionPoints,
} from './model'

const at = interval

describe('toPoints', () => {
  it('expands a half-open range into the points it covers, excluding the end', () => {
    expect([...toPoints([at(2, 5)])]).toEqual([2, 3, 4])
  })

  it('covers nothing for a range of zero length', () => {
    expect(toPoints([at(3, 3)]).size).toBe(0)
  })

  it('counts a point shared by two ranges once', () => {
    expect(toPoints([at(0, 4), at(2, 6)]).size).toBe(6)
  })

  it('gives the empty set for no ranges at all', () => {
    expect(toPoints([]).size).toBe(0)
  })
})

describe('fromPoints', () => {
  it('joins consecutive points into one range', () => {
    expect(fromPoints(new Set([2, 3, 4]))).toEqual([at(2, 5)])
  })

  it('starts a new range wherever the run of points breaks', () => {
    expect(fromPoints(new Set([0, 1, 5, 6]))).toEqual([at(0, 2), at(5, 7)])
  })

  it('gives no ranges for no points', () => {
    expect(fromPoints(new Set())).toEqual([])
  })

  it('sorts points it was handed out of order', () => {
    expect(fromPoints(new Set([6, 1, 0, 5]))).toEqual([at(0, 2), at(5, 7)])
  })
})

describe('the round trip through the model', () => {
  it('lands on the same canonical form the real normalise produces', () => {
    // The single fact the model-based invariants rest on, written out once by
    // hand so it is checkable without running a property.
    const messy = [at(5, 9), at(0, 5), at(3, 3), at(12, 14)]

    expect(fromPoints(toPoints(messy))).toEqual(normalise(messy))
    expect(normalise(messy)).toEqual([at(0, 9), at(12, 14)])
  })
})

describe('the model’s set arithmetic', () => {
  it('unions two point sets', () => {
    expect([...unionPoints(new Set([1, 2]), new Set([2, 3]))].sort()).toEqual([1, 2, 3])
  })

  it('intersects two point sets', () => {
    expect([...intersectPoints(new Set([1, 2]), new Set([2, 3]))]).toEqual([2])
  })

  it('subtracts one point set from another', () => {
    expect([...subtractPoints(new Set([1, 2]), new Set([2, 3]))]).toEqual([1])
  })

  it('compares point sets by content, not by iteration order', () => {
    expect(samePoints(new Set([3, 1, 2]), new Set([1, 2, 3]))).toBe(true)
    expect(samePoints(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false)
  })
})

describe('the domain guard', () => {
  // Without this, a model handed an out-of-range input would report a
  // difference that is the model's fault rather than the system's — the worst
  // possible failure for an oracle, because it looks exactly like a bug.
  it('accepts integer ranges inside the domain', () => {
    expect(() => {
      assertWithinDomain([at(0, DOMAIN)])
    }).not.toThrow()
  })

  it('rejects a coordinate below zero', () => {
    expect(() => {
      assertWithinDomain([at(-1, 3)])
    }).toThrow(RangeError)
  })

  it('rejects a coordinate past the domain', () => {
    expect(() => {
      assertWithinDomain([at(0, DOMAIN + 1)])
    }).toThrow(RangeError)
  })

  it('rejects a fractional coordinate, which the point expansion cannot represent', () => {
    expect(() => {
      assertWithinDomain([at(0.5, 3)])
    }).toThrow(RangeError)
  })

  it('names the range it refused, so the message is actionable', () => {
    expect(() => {
      assertWithinDomain([at(-1, 3)])
    }).toThrow('[-1, 3)')
  })
})
