// @vitest-environment node
/**
 * The fixture's naming and allocation, which decide whether it isolates
 * anything — checked without starting a container.
 *
 * Both are one-liners that look like plumbing and are not. A slug that dropped
 * the run nonce would give two runs the same schema against a reused container,
 * which is precisely the state the matrix calls `none`. A database allocator
 * that wrapped round at sixteen would hand two suites the same database and put
 * back the collisions the numbered database was chosen to remove — silently,
 * because both suites would still pass on the first run.
 */

import { describe, expect, it } from 'vitest'

import { REDIS_DATABASES } from './isolation.ts'
import { allocateDatabase, RUN_ID, slug } from './suite.ts'

describe('slug', () => {
  it('reduces a suite title to something a schema, a key and a topic all accept', () => {
    expect(slug('Orders API')).toBe('orders_api')
    expect(slug('  the outbox  ')).toBe('the_outbox')
    expect(slug('a/b:c')).toBe('a_b_c')
  })

  it('collapses runs of punctuation rather than emitting empty segments', () => {
    expect(slug('orders -- api')).toBe('orders_api')
  })

  it('bounds the length, because a Postgres identifier is 63 bytes and the nonce and prefix also want some', () => {
    expect(slug('a'.repeat(100))).toHaveLength(24)
  })

  it('refuses a title with nothing usable in it, rather than returning an empty namespace', () => {
    expect(() => slug('!!!')).toThrow(/no usable characters/)
  })
})

describe('the run nonce', () => {
  it('is eight hex characters, so a namespace built from it fits an identifier', () => {
    expect(RUN_ID).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('allocateDatabase', () => {
  it('gives a suite the same database every time it asks', () => {
    expect(allocateDatabase('repeat me')).toBe(allocateDatabase('repeat me'))
  })

  it('gives two suites two databases', () => {
    expect(allocateDatabase('first suite')).not.toBe(allocateDatabase('second suite'))
  })

  it('treats two titles with the same slug as one suite, because they would share a key prefix too', () => {
    expect(allocateDatabase('Orders API')).toBe(allocateDatabase('orders   api'))
  })

  it('refuses a seventeenth suite rather than wrapping round onto an allocated database', () => {
    for (let index = 0; index < REDIS_DATABASES; index += 1) {
      try {
        allocateDatabase(`filler ${index}`)
      } catch {
        // The allocator is process-wide state and the tests above have already
        // taken some of it; filling the rest is what this case is about.
      }
    }

    expect(() => allocateDatabase('one too many')).toThrow(/All 16 Redis databases are allocated/)
  })
})
