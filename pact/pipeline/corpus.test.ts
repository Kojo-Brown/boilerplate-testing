/**
 * The corpus and the scoring, checked without a broker.
 *
 * These are the properties the matrix is only meaningful under, so they are
 * asserted where they cost milliseconds rather than inside the broker suite
 * where they would cost a service container: a duplicated scenario id, a
 * scenario with two flags set, a strategy pair that differs in no field, or a
 * verdict table that scores a miss as a catch.
 */

import { describe, expect, it } from 'vitest'
import { CORRECT, type ProviderFlags } from '../provider/app'
import { CONTRACT_VARIANTS } from './contracts'
import { SCENARIOS } from './scenarios'
import { STRATEGIES, verdictFor, type Stage } from './strategies'
import { readmeMatrix, readmeStrategies, readmeTotals } from './readme'

/** Flags a scenario turns on, relative to `CORRECT`. */
function raised(flags: ProviderFlags): (keyof ProviderFlags)[] {
  return (Object.keys(flags) as (keyof ProviderFlags)[]).filter(
    (flag) => flags[flag] !== CORRECT[flag],
  )
}

describe('The scenario corpus', () => {
  it('gives every scenario a distinct id', () => {
    const ids = SCENARIOS.map((scenario) => scenario.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('changes at most one provider behaviour per scenario', () => {
    for (const scenario of SCENARIOS) {
      expect(raised(scenario.flags).length, `${scenario.id} raises more than one flag`).toBeLessThanOrEqual(1)
    }
  })

  it('names a contract variant that exists', () => {
    for (const scenario of SCENARIOS) {
      expect(CONTRACT_VARIANTS[scenario.contract]).toBeTypeOf('function')
    }
  })

  it('holds safe scenarios as well as breaking ones', () => {
    const safe = SCENARIOS.filter((scenario) => scenario.truth === 'safe')
    // Three, and the count is asserted rather than "at least one": a corpus
    // that drifts to one safe row measures loudness again without saying so.
    expect(safe.map((scenario) => scenario.id)).toEqual([
      'NOTHING_CHANGED',
      'EXTRA_FIELD_ADDED',
      'LOGOUT_RETIRED',
    ])
  })

  it('holds the retirement pair differing in deployment order alone', () => {
    const late = SCENARIOS.find((s) => s.id === 'LOGOUT_RETIRED')
    const early = SCENARIOS.find((s) => s.id === 'LOGOUT_RETIRED_EARLY')

    expect(late?.flags).toEqual(early?.flags)
    expect(late?.contract).toBe(early?.contract)
    expect(late?.deployed).not.toBe(early?.deployed)
    expect(late?.truth).not.toBe(early?.truth)
  })

  it('never sets the control flag in a scenario', () => {
    // `bogusUserId` exists for `coercion.test.ts` and is not a change any team
    // makes. A scenario using it would put a strawman in the matrix.
    for (const scenario of SCENARIOS) {
      expect(scenario.flags.bogusUserId).toBe(false)
    }
  })
})

describe('The strategies', () => {
  it('gives every strategy a distinct id', () => {
    const ids = STRATEGIES.map((strategy) => strategy.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('distinguishes every pair by at least one capability', () => {
    const shape = (index: number) => JSON.stringify(STRATEGIES[index])
    for (let i = 0; i < STRATEGIES.length; i += 1) {
      for (let j = i + 1; j < STRATEGIES.length; j += 1) {
        expect(shape(i), `${STRATEGIES[i]?.id} and ${STRATEGIES[j]?.id} are the same wiring`).not.toBe(
          shape(j),
        )
      }
    }
  })

  it('separates the file pair by staleness alone', () => {
    const stale = STRATEGIES.find((s) => s.id === 'files-stale')
    const fresh = STRATEGIES.find((s) => s.id === 'files-fresh')

    expect({ ...stale, id: '', summary: '', currentContract: false }).toEqual({
      ...fresh,
      id: '',
      summary: '',
      currentContract: false,
    })
  })

  it('offers a deploy gate only where a broker is involved', () => {
    for (const strategy of STRATEGIES) {
      if (strategy.hasDeployGate) expect(strategy.usesBroker).toBe(true)
    }
  })
})

describe('Scoring a cell', () => {
  const stages: Stage[] = ['provider-ci', 'deploy-gate', 'none']

  it.each(stages)('scores a breaking change at %s', (stage) => {
    expect(verdictFor('breaks', stage)).toBe(stage === 'none' ? 'missed' : 'caught')
  })

  it.each(stages)('scores a safe change at %s', (stage) => {
    expect(verdictFor('safe', stage)).toBe(stage === 'none' ? 'quiet' : 'false-alarm')
  })
})

describe('The README tables', () => {
  // Parsed without a broker, so a table that loses a row, gains a column or
  // has its markers deleted fails `pnpm test` rather than only the CI job that
  // has a broker attached.
  it('names every scenario, in order', () => {
    expect(readmeMatrix().map((row) => row.scenario)).toEqual(SCENARIOS.map((s) => s.id))
  })

  it('names every strategy, in order, in both tables', () => {
    expect(readmeStrategies()).toEqual(STRATEGIES.map((s) => s.id))
    expect(readmeTotals().map((row) => row.strategy)).toEqual(STRATEGIES.map((s) => s.id))
  })

  it('states a ground truth matching the corpus', () => {
    for (const row of readmeMatrix()) {
      const scenario = SCENARIOS.find((s) => s.id === row.scenario)
      expect(row.truth, row.scenario).toBe(scenario?.truth)
    }
  })

  it('totals to the number of scenarios in every row', () => {
    const breaking = SCENARIOS.filter((s) => s.truth === 'breaks').length
    for (const row of readmeTotals()) {
      expect(row.caught + row.missed, `${row.strategy} caught + missed`).toBe(breaking)
    }
  })
})
