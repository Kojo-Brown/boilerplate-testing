import { describe, expect, it } from 'vitest'

import { HAZARDS } from './hazards.ts'
import { cellFor, runMatrix } from './matrix.ts'
import { HANDLERS } from './service.ts'
import {
  BACKOFF_BASE_MS,
  retryDelay,
  seededJitter,
  STRATEGIES,
  strategyNamed,
  subjectFor,
} from './strategies.ts'

describe('the column set', () => {
  it('has a strategy for every handler and a handler for every strategy', () => {
    expect(STRATEGIES.map((strategy) => strategy.key).sort()).toEqual(Object.keys(HANDLERS).sort())
  })

  it('has unique keys', () => {
    expect(new Set(STRATEGIES.map((strategy) => strategy.key)).size).toBe(STRATEGIES.length)
  })

  it('has a blurb for every strategy', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.blurb.length).toBeGreaterThan(20)
    }
  })

  it('declares a reconciliation step only where the design needs one', () => {
    const withReconcile = STRATEGIES.filter((strategy) => strategy.reconcile !== undefined)

    expect(withReconcile.map((strategy) => strategy.key)).toEqual(['atomic-outbox'])
  })

  it('carries the reconciliation step through to the subject', () => {
    expect(subjectFor(strategyNamed('atomic-outbox')).reconcile).toBeDefined()
    expect(subjectFor(strategyNamed('none')).reconcile).toBeUndefined()
  })

  it('refuses an unknown key rather than returning undefined', () => {
    expect(() => strategyNamed('nope')).toThrow('No strategy named nope')
  })
})

describe('the backoff', () => {
  it('is zero for an immediate policy', () => {
    expect(retryDelay('immediate', 1, seededJitter(1))).toBe(0)
    expect(retryDelay('immediate', 5, seededJitter(1))).toBe(0)
  })

  it('is at least the doubling interval and at most twice it', () => {
    const jitter = seededJitter(99)

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const interval = BACKOFF_BASE_MS * 2 ** (attempt - 1)
      const delay = retryDelay('backoff', attempt, jitter)

      expect(delay).toBeGreaterThanOrEqual(interval)
      expect(delay).toBeLessThanOrEqual(interval * 2)
    }
  })

  it('grows with the attempt number', () => {
    const jitter = seededJitter(7)
    const delays = [1, 2, 3, 4].map((attempt) => retryDelay('backoff', attempt, jitter))

    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]!).toBeGreaterThan(delays[index - 1]!)
    }
  })

  it('gives the same sequence for the same seed and a different one otherwise', () => {
    const run = (seed: number) =>
      [1, 2, 3].map((attempt) => retryDelay('backoff', attempt, seededJitter(seed)))

    expect(run(42)).toEqual(run(42))
    expect(run(42)).not.toEqual(run(43))
  })

  it('draws jitter in [0, 1)', () => {
    const jitter = seededJitter(12_345)

    for (let draw = 0; draw < 500; draw += 1) {
      const value = jitter()

      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('what backoff is worth', () => {
  /**
   * The finding this column exists for, asserted as a claim rather than left to
   * be read off the README: **`retry-backoff` and `none` agree on every single
   * row**. The two differ in that one of them genuinely spaces its retries by a
   * growing jittered delay, and that difference changes nothing, because
   * backoff decides when a duplicate arrives rather than whether it is one.
   *
   * If a future change ever makes these columns differ, this is the test that
   * says so — and the honest response would be to find out which hazard became
   * timing-dependent, not to delete the assertion.
   */
  it('scores identically to no idempotency at all, on every hazard', async () => {
    const matrix = await runMatrix()

    for (const hazard of HAZARDS) {
      expect(cellFor(matrix, hazard.key, 'retry-backoff').outcome).toBe(
        cellFor(matrix, hazard.key, 'none').outcome,
      )
    }
  })
})
