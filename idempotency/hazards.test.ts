import { describe, expect, it } from 'vitest'

import { HAZARDS, hazardNamed, RETRY_AFTER_CRASH_MS, RETRY_AFTER_EXPIRY_MS } from './hazards.ts'
import { OUTCOMES } from './scoring.ts'
import { KEY_TTL_MS, LEASE_TTL_MS } from './service.ts'
import { BACKOFF_BASE_MS, retryDelay, seededJitter } from './strategies.ts'

describe('the corpus', () => {
  it('has unique keys', () => {
    expect(new Set(HAZARDS.map((hazard) => hazard.key)).size).toBe(HAZARDS.length)
  })

  it('names a correct outcome from the vocabulary for every hazard', () => {
    for (const hazard of HAZARDS) {
      expect(OUTCOMES).toContain(hazard.correct)
    }
  })

  /**
   * `blocked` is never correct, and stating it here rather than in prose is
   * what stops somebody "fixing" the `lease` column by declaring a 409 an
   * acceptable answer. A client holding a 409 has no idea whether it has been
   * charged.
   */
  it('never declares a 409 the correct answer', () => {
    expect(HAZARDS.map((hazard) => hazard.correct)).not.toContain('blocked')
  })

  it('gives every delivery a distinct label within its hazard', () => {
    for (const hazard of HAZARDS) {
      const labels = hazard.deliveries.map((delivery) => delivery.label)

      expect(new Set(labels).size).toBe(labels.length)
    }
  })

  it('declares an expectation consistent with its own deliveries', () => {
    for (const hazard of HAZARDS) {
      expect(hazard.expectedCharges).toBeLessThanOrEqual(hazard.deliveries.length)
      expect(hazard.expectedGatewayEffects).toBeLessThanOrEqual(hazard.deliveries.length)
    }
  })

  it('has a blurb for every hazard', () => {
    for (const hazard of HAZARDS) {
      expect(hazard.blurb.length).toBeGreaterThan(20)
    }
  })
})

describe('the crash and park points', () => {
  /**
   * `buildHooks` fires `after-gateway` for the first delivery that declared it
   * and then never again, because the gateway does not know which delivery is
   * calling. That is sound only while no hazard declares it twice.
   */
  it('never asks two deliveries in one hazard to crash at the gateway', () => {
    for (const hazard of HAZARDS) {
      const atGateway = hazard.deliveries.filter((delivery) => delivery.crashAt === 'after-gateway')

      expect(atGateway.length).toBeLessThanOrEqual(1)
    }
  })

  it('parks at most one delivery per hazard, and never the last', () => {
    for (const hazard of HAZARDS) {
      const parked = hazard.deliveries.filter((delivery) => delivery.parkAt !== undefined)

      expect(parked.length).toBeLessThanOrEqual(1)

      if (parked.length === 1) {
        expect(hazard.deliveries.at(-1)?.parkAt).toBeUndefined()
      }
    }
  })

  it('never both parks and crashes the same delivery', () => {
    for (const hazard of HAZARDS) {
      for (const delivery of hazard.deliveries) {
        expect(delivery.parkAt !== undefined && delivery.crashAt !== undefined).toBe(false)
      }
    }
  })
})

describe('the timings', () => {
  /**
   * Every threshold in the corpus is a claim about an ordering, and getting one
   * backwards would silently change what a row measures rather than fail. A
   * retry that arrived *before* the lease expired would score
   * `lease-recovering` as `lease` and the difference between the two designs
   * would vanish without a single test going red.
   */
  it('retries after a crash later than a lease survives', () => {
    expect(RETRY_AFTER_CRASH_MS).toBeGreaterThan(LEASE_TTL_MS)
  })

  it('retries after expiry later than a key record survives', () => {
    expect(RETRY_AFTER_EXPIRY_MS).toBeGreaterThan(KEY_TTL_MS)
  })

  it('retries after a crash sooner than a key record expires, so that row is about the crash', () => {
    expect(RETRY_AFTER_CRASH_MS).toBeLessThan(KEY_TTL_MS)
  })

  /**
   * The constraint that keeps `retry-backoff` a comparison of safety. If a
   * backoff delay could reach the lease TTL, that column would start taking
   * over stale leases and differ from `none` for a reason with nothing to do
   * with whether backoff is a safety mechanism.
   */
  it('keeps every backoff delay this corpus can produce well short of the shortest expiry', () => {
    // Bounded by the corpus rather than by a round number, so the invariant
    // survives an edit to either side. A hazard with enough deliveries would
    // eventually push a doubling delay past the lease TTL — at these constants
    // the eighth retry does — and the honest response then is to lower the base
    // or cap the backoff, not to widen this assertion.
    const mostRetries = Math.max(...HAZARDS.map((hazard) => hazard.deliveries.length)) - 1
    const jitter = seededJitter(1)
    const longest = Math.max(
      ...Array.from({ length: mostRetries }, (_, index) => retryDelay('backoff', index + 1, jitter)),
    )

    expect(mostRetries).toBeGreaterThan(0)
    expect(longest).toBeLessThan(LEASE_TTL_MS)
    expect(BACKOFF_BASE_MS).toBeGreaterThan(0)
  })
})

describe('lookup', () => {
  it('finds a hazard by key', () => {
    expect(hazardNamed('clean').key).toBe('clean')
  })

  it('refuses an unknown key rather than returning undefined', () => {
    expect(() => hazardNamed('nope')).toThrow('No hazard named nope')
  })
})
