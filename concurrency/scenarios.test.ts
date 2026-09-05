/**
 * The contract's own tests: the invariants hold on the real ledger, and the
 * one exemption in the table is load-bearing rather than convenient.
 *
 * This runs the subject imported directly, not a compiled copy, so it is the
 * fast half of the control check — if an invariant is simply wrong about what
 * `ledger.ts` promises, this file says so in milliseconds instead of leaving
 * `detection.test.ts` to report a strategy that catches everything.
 */

import { describe, expect, it } from 'vitest'

import { createLedger, createMutex } from './ledger.ts'
import { runFree, runScheduled, type Subject } from './runtime.ts'
import {
  INVARIANTS,
  INVARIANT_IDS,
  SCENARIOS,
  SCENARIO_IDS,
  invariantsFor,
  scenarioNamed,
  violations,
} from './scenarios.ts'

const subject: Subject = { createLedger, createMutex }

describe('the scenarios', () => {
  it('declares every scenario the ids name, once each', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([...SCENARIO_IDS])
  })

  it('summarises every scenario in a sentence', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.summary.endsWith('.')).toBe(true)
    }
  })

  it('judges every scenario by at least one invariant', () => {
    for (const id of SCENARIO_IDS) {
      expect(invariantsFor(id, true).length).toBeGreaterThan(0)
    }
  })

  it('starts more than one task wherever the interleaving is the point', () => {
    const singleTask = SCENARIOS.filter(
      (scenario) => scenario.plan.tasks(createLedger({ read: async () => 0, write: async () => {} })).length === 1,
    ).map((scenario) => scenario.id)

    // The two deliberate exceptions, and the reason they exist: a race whose
    // concurrency is inside one call needs no second caller.
    expect(singleTask).toEqual(['batch-settlement', 'read-after-write'])
  })
})

describe('the invariants', () => {
  it('declares every invariant the ids name, once each', () => {
    expect(INVARIANTS.map((invariant) => invariant.id)).toEqual([...INVARIANT_IDS])
  })

  it('states every claim as a sentence about the system', () => {
    for (const invariant of INVARIANTS) {
      expect(invariant.claim.endsWith('.')).toBe(true)
      expect(invariant.scenarios.length).toBeGreaterThan(0)
    }
  })

  it('names only scenarios that exist', () => {
    for (const invariant of INVARIANTS) {
      for (const scenario of invariant.scenarios) {
        expect(SCENARIO_IDS).toContain(scenario)
      }
    }
  })

  it('exempts exactly one claim from a run with no overlap', () => {
    expect(INVARIANTS.filter((invariant) => invariant.needsOverlap === true).map((i) => i.id)).toEqual(
      ['overlapping-reads-hit-the-store-once'],
    )
  })
})

describe('the correct ledger', () => {
  it('holds every invariant when the operations are run one at a time', async () => {
    for (const scenario of SCENARIOS) {
      const observation = await runFree(subject, scenario.plan, 'sequential', () => 0)

      expect({ scenario: scenario.id, violated: violations(scenario.id, observation, false) }).toEqual(
        { scenario: scenario.id, violated: [] },
      )
    }
  })

  it('holds every invariant when the operations overlap', async () => {
    for (const scenario of SCENARIOS) {
      const observation = await runFree(subject, scenario.plan, 'overlapping', () => 0)

      expect({ scenario: scenario.id, violated: violations(scenario.id, observation, true) }).toEqual(
        { scenario: scenario.id, violated: [] },
      )
    }
  })

  it('holds every invariant when the schedule is taken away from the runtime', async () => {
    for (const scenario of SCENARIOS) {
      const run = await runScheduled(subject, scenario.plan, (count) => count - 1)

      expect({
        scenario: scenario.id,
        violated: violations(scenario.id, run.observation, true),
      }).toEqual({ scenario: scenario.id, violated: [] })
    }
  })
})

// The exemption, made to fail. Without it, the coalescing claim goes red on the
// *correct* subject the moment a strategy stops overlapping its tasks — which
// would put a false alarm in the one column of the matrix that is supposed to
// be the honest baseline.
describe('the overlap exemption', () => {
  it('fails the correct ledger when asserted with no overlap', async () => {
    const shared = scenarioNamed('shared-read')
    const observation = await runFree(subject, shared.plan, 'sequential', () => 0)

    expect(violations('shared-read', observation, true)).toEqual([
      'overlapping-reads-hit-the-store-once',
    ])
    expect(violations('shared-read', observation, false)).toEqual([])
  })

  it('changes nothing for a strategy whose tasks do overlap', async () => {
    const shared = scenarioNamed('shared-read')
    const observation = await runFree(subject, shared.plan, 'overlapping', () => 0)

    expect(invariantsFor('shared-read', true)).toHaveLength(
      invariantsFor('shared-read', false).length + 1,
    )
    expect(violations('shared-read', observation, true)).toEqual([])
  })
})
