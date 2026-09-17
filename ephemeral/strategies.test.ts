// @vitest-environment node
/**
 * The wirings, as a control space.
 *
 * The file the matrix's credibility rests on. If two strategies differ in
 * three fields, the cell that differs between them is not evidence about any
 * one of those fields, and a reader has no way to tell that from the table. So
 * the adjacencies the README attributes score jumps to are asserted here, by
 * counting the fields that differ, rather than described in prose and hoped
 * for.
 */

import { describe, expect, it } from 'vitest'

import { SEED_POLICIES } from './seeds.ts'
import {
  DEPLOY_TRIGGERS,
  PR_EVENTS,
  REAPER_BASES,
  STRATEGIES,
  strategyByKey,
  strategyKeys,
  type Wiring,
} from './strategies.ts'

const CONTROLS = [
  'trigger',
  'deployOn',
  'teardownOnClose',
  'cancelInFlight',
  'namespaced',
  'seedPolicy',
  'reaper',
] as const

const same = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const differences = (left: Wiring, right: Wiring): readonly string[] =>
  CONTROLS.filter((control) => !same(left[control], right[control]))

/**
 * The pairs whose score difference the README attributes to one control.
 *
 * `namespace-reconciled` is deliberately absent: it differs from
 * `namespace-owned` in three fields, the README says so, and adding it here
 * would make this test assert something untrue.
 */
const SINGLE_CONTROL_PAIRS: readonly (readonly [string, string, (typeof CONTROLS)[number]])[] = [
  ['on-close', 'on-close-cancel', 'cancelInFlight'],
  ['on-close-cancel', 'on-close-seeded', 'seedPolicy'],
  ['on-close-seeded', 'on-close-ttl', 'reaper'],
  ['on-close-seeded', 'namespace-owned', 'namespaced'],
  ['ttl-reaper', 'on-close-ttl', 'teardownOnClose'],
]

describe('the strategy table', () => {
  it('gives every strategy a distinct key', () => {
    expect(new Set(strategyKeys()).size).toBe(STRATEGIES.length)
  })

  it('gives every strategy a distinct wiring', () => {
    const wirings = STRATEGIES.map((strategy) => JSON.stringify(strategy.wiring))

    expect(new Set(wirings).size).toBe(STRATEGIES.length)
  })

  it('draws every control from its declared vocabulary', () => {
    for (const { wiring } of STRATEGIES) {
      expect(DEPLOY_TRIGGERS).toContain(wiring.trigger)
      expect(SEED_POLICIES).toContain(wiring.seedPolicy)
      expect(wiring.deployOn.length).toBeGreaterThan(0)
      for (const event of wiring.deployOn) expect(PR_EVENTS).toContain(event)
      if (wiring.reaper !== null) {
        expect(REAPER_BASES).toContain(wiring.reaper.basis)
        expect(wiring.reaper.ttlMinutes).toBeGreaterThan(0)
      }
    }
  })

  it('gives every strategy a blurb that is a sentence', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.blurb.length).toBeGreaterThan(20)
      expect(strategy.blurb.endsWith('.')).toBe(true)
    }
  })

  it('refuses a key it does not have', () => {
    expect(() => strategyByKey('invented')).toThrow('no strategy called invented')
  })
})

describe('the adjacencies the README attributes score jumps to', () => {
  it.each(SINGLE_CONTROL_PAIRS)('%s and %s differ in %s and nothing else', (left, right, control) => {
    expect(differences(strategyByKey(left).wiring, strategyByKey(right).wiring)).toEqual([control])
  })

  /**
   * The counter-case, stated so the absence above is deliberate rather than an
   * omission: the recommended wiring is three changes away from the one below
   * it, and the README's account of its last three cells has to name all
   * three.
   */
  it('separates `namespace-owned` from `namespace-reconciled` by three controls', () => {
    expect(
      differences(strategyByKey('namespace-owned').wiring, strategyByKey('namespace-reconciled').wiring),
    ).toEqual(['trigger', 'deployOn', 'reaper'])
  })
})

describe('the control', () => {
  it('puts the label-gated trigger on exactly one wiring, which is what makes the fork rows readable', () => {
    const gated = STRATEGIES.filter((strategy) => strategy.wiring.trigger === 'labelled')

    expect(gated.map((strategy) => strategy.key)).toEqual(['namespace-reconciled'])
  })

  it('reads the `labeled` event only where the trigger is gated on a label', () => {
    for (const { wiring } of STRATEGIES) {
      if (!wiring.deployOn.includes('labeled')) continue
      expect(wiring.trigger).toBe('labelled')
    }
  })

  it('gives the reconciling sweep to the only wiring that can answer "is this pull request open"', () => {
    const reconcilers = STRATEGIES.filter((strategy) => strategy.wiring.reaper?.basis === 'open-prs')

    expect(reconcilers.map((strategy) => strategy.key)).toEqual(['namespace-reconciled'])
  })
})
