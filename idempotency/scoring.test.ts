import { describe, expect, it } from 'vitest'

import { HAZARDS, hazardNamed, type Hazard } from './hazards.ts'
import { runDeliveries, type Observation } from './harness.ts'
import { classify, handled, OUTCOMES, score, type Outcome } from './scoring.ts'
import { aCharge } from './fixture.ts'
import { HANDLERS } from './service.ts'
import { Store } from './store.ts'

/**
 * A synthetic observation.
 *
 * The classifier is a pure function of counts and answers, so the precedence
 * between its rules is tested against constructed worlds rather than by finding
 * a strategy that happens to produce each one. Two reasons: several
 * combinations are not reachable from the eight strategies at all — nothing
 * here answers 409 *and* duplicates — and a precedence tested only through real
 * runs is a precedence that changes silently the day a strategy changes.
 */
function observation(
  fields: Partial<Observation> & { readonly statuses?: readonly (number | null)[]; readonly replayed?: boolean },
): Observation {
  const store = new Store()

  return {
    deliveries: (fields.statuses ?? [201]).map((status, index) => ({
      label: index === 0 ? 'first' : 'retry',
      response:
        status === null
          ? null
          : { status, body: { chargeId: null, amount: 2500, status: 'charged' }, replayed: fields.replayed ?? false },
      crashed: status === null,
      sentAt: 0,
    })),
    charges: fields.charges ?? 1,
    gatewayEffects: fields.gatewayEffects ?? 1,
    gatewayRequests: fields.gatewayRequests ?? 1,
    misattributed: 0,
    store,
    gateway: { requests: [], effects: [], charge: async () => ({ ok: true, reference: 'gw_1' }) },
  }
}

const hazard = (overrides: Partial<Hazard> = {}): Hazard => ({
  key: 'synthetic',
  blurb: 'a constructed world',
  deliveries: [
    { label: 'first', request: aCharge() },
    { label: 'retry', request: aCharge() },
  ],
  expectedCharges: 1,
  expectedGatewayEffects: 1,
  correct: 'safe',
  ...overrides,
})

describe('the vocabulary', () => {
  it('has no duplicates', () => {
    expect(new Set(OUTCOMES).size).toBe(OUTCOMES.length)
  })

  /**
   * Every word has to be reachable, or it is documentation rather than a
   * classification. `blocked` is the one that would rot first — it is never a
   * correct outcome, so nothing else in the suite forces it to exist.
   */
  it.each(OUTCOMES)('produces %s from some reachable world', (outcome: Outcome) => {
    const worlds: Record<Outcome, () => Outcome> = {
      safe: () => classify(observation({}), hazard()),
      rejected: () => classify(observation({ statuses: [400, 400], charges: 0, gatewayEffects: 0 }), hazard({ expectedCharges: 0, expectedGatewayEffects: 0 })),
      blocked: () => classify(observation({ statuses: [null, 409], charges: 0, gatewayEffects: 0 }), hazard()),
      duplicate: () => classify(observation({ charges: 2, gatewayEffects: 2 }), hazard()),
      lost: () => classify(observation({ charges: 0, gatewayEffects: 0 }), hazard()),
      orphaned: () => classify(observation({ statuses: [null, null], charges: 0, gatewayEffects: 1 }), hazard()),
      'wrong-response': () =>
        classify(
          observation({ statuses: [201, 200] }),
          hazard({
            deliveries: [
              { label: 'first', request: aCharge() },
              { label: 'retry', request: aCharge({ amount: 9900 }) },
            ],
          }),
        ),
    }

    expect(worlds[outcome]()).toBe(outcome)
  })
})

describe('precedence', () => {
  it('calls money-moved-with-no-record orphaned rather than lost', () => {
    expect(classify(observation({ statuses: [null, null], charges: 0, gatewayEffects: 1 }), hazard())).toBe(
      'orphaned',
    )
  })

  it('calls a successful answer with no effect lost rather than rejected', () => {
    expect(classify(observation({ statuses: [201], charges: 0, gatewayEffects: 0 }), hazard())).toBe('lost')
  })

  /**
   * The rule that separates "the service correctly refused this" from "the
   * service has recorded a failure and will refuse forever". Same status code,
   * opposite meanings, and the discriminator is whether the answer came from a
   * record.
   */
  it('calls a replayed failure with no effect lost, and a fresh one rejected', () => {
    const replayed = observation({ statuses: [502, 502], charges: 0, gatewayEffects: 0, replayed: true })
    const fresh = observation({ statuses: [502, 502], charges: 0, gatewayEffects: 0, replayed: false })

    expect(classify(replayed, hazard())).toBe('lost')
    expect(classify(fresh, hazard())).toBe('rejected')
  })

  it('calls a correct world with every delivery dead lost, not safe', () => {
    expect(classify(observation({ statuses: [null] }), hazard())).toBe('lost')
  })

  /** A charge for the right amount, answered with the wrong one. */
  it('catches an answer that describes a different request', () => {
    const cell = classify(
      observation({ statuses: [201, 200] }),
      hazard({
        deliveries: [
          { label: 'first', request: aCharge() },
          { label: 'retry', request: aCharge({ amount: 9900 }) },
        ],
      }),
    )

    expect(cell).toBe('wrong-response')
  })
})

describe('scoring', () => {
  it('counts a cell as handled only when it matches the hazard\'s correct word', () => {
    expect(handled('rejected', hazard({ correct: 'rejected' }))).toBe(true)
    expect(handled('safe', hazard({ correct: 'rejected' }))).toBe(false)
  })

  it('sums a column against the hazards it was scored on', () => {
    const outcomes = new Map<string, Outcome>([
      ['clean', 'safe'],
      ['sequential-retry', 'duplicate'],
    ])
    const subset = [hazardNamed('clean'), hazardNamed('sequential-retry')]

    expect(score(outcomes, subset)).toEqual({ handled: 1, of: 2 })
  })

  it('does not credit a hazard it has no outcome for', () => {
    expect(score(new Map(), HAZARDS)).toEqual({ handled: 0, of: HAZARDS.length })
  })
})

describe('against a real run', () => {
  /**
   * One end-to-end anchor, so the synthetic worlds above cannot drift away from
   * what the harness actually produces.
   */
  it('classifies a real duplicate as a duplicate', async () => {
    const hazardUnderTest = hazardNamed('sequential-retry')
    const observed = await runDeliveries({ handle: HANDLERS.none }, hazardUnderTest.deliveries)

    expect(classify(observed, hazardUnderTest)).toBe('duplicate')
  })

  it('classifies a real replay as safe', async () => {
    const hazardUnderTest = hazardNamed('sequential-retry')
    const observed = await runDeliveries({ handle: HANDLERS['natural-key'] }, hazardUnderTest.deliveries)

    expect(classify(observed, hazardUnderTest)).toBe('safe')
  })
})
