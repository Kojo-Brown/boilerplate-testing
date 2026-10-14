/**
 * The seven probes, over readings and ledgers built by hand.
 *
 * `runs.test.ts` asks these questions of eleven real runs. What that cannot
 * do is vary one input at a time: the point of this file is that each probe
 * answers for the reason it claims to, which needs a reading that differs from
 * another in exactly one respect — including combinations no reporter produces,
 * like an artifact that counts attempts correctly for one test and not another.
 */

import { describe, expect, it } from 'vitest'

import type { AttemptRecord } from '@/flake/fixture/ledger'
import { answer, truthByName } from '@/flake/probes'
import type { Reading, TestView } from '@/flake/read'

const PLAN = ['intermittent', 'soft-intermittent', 'stable']

const view = (overrides: Partial<TestView> & { name: string }): TestView => ({
  status: 'passed',
  attempts: 1,
  errors: [],
  ...overrides,
})

/** A ledger in which `intermittent` took two attempts and everything else one. */
const LEDGER: readonly AttemptRecord[] = [
  { id: 'intermittent', attempt: 1, outcome: 'failed' },
  { id: 'intermittent', attempt: 2, outcome: 'passed' },
  { id: 'soft-intermittent', attempt: 1, outcome: 'passed' },
  { id: 'stable', attempt: 1, outcome: 'passed' },
]

const ask = (reading: Reading, overrides: { exitCode?: number; latest?: Reading } = {}) =>
  answer({
    reading,
    latest: overrides.latest ?? reading,
    ledger: LEDGER,
    exitCode: overrides.exitCode ?? 0,
    subject: 'intermittent',
    plan: PLAN,
  })

const complete = (subject: Partial<TestView>): Reading => ({
  views: [
    view({ name: 'intermittent', status: 'flaky', attempts: 2, ...subject }),
    view({ name: 'soft-intermittent' }),
    view({ name: 'stable' }),
  ],
  namesFlakes: false,
})

describe('truthByName', () => {
  it('reports the highest attempt number each test reached', () => {
    expect(truthByName(LEDGER).get('intermittent')).toBe(2)
  })

  it('reports nothing for a test that made no attempt', () => {
    expect(truthByName(LEDGER).has('never ran')).toBe(false)
  })
})

describe('answer', () => {
  it('calls the gate red on a non-zero exit code', () => {
    expect(ask(complete({}), { exitCode: 1 }).gate).toBe('red')
  })

  it('reports the status the artifact gave the test', () => {
    expect(ask(complete({ status: 'passed' })).verdict).toBe('passed')
  })

  it('reports a test the artifact left out as absent', () => {
    expect(ask({ views: [view({ name: 'stable' })], namesFlakes: false }).verdict).toBe('absent')
  })

  it('reports the attempt count as unknown when the artifact has none', () => {
    expect(ask(complete({ attempts: undefined })).attempts).toBeUndefined()
  })

  it('calls the first attempt’s error kept only when that attempt’s message is there', () => {
    expect(ask(complete({ errors: ['flake subject intermittent: attempt 1 fails by plan'] })).evidence).toBe('kept')
    expect(ask(complete({ errors: ['flake subject intermittent: attempt 2 fails by plan'] })).evidence).toBe('lost')
  })

  it('reports naming from the artifact rather than from the numbers', () => {
    // An artifact can let a flake be *derived* without having a word for one.
    // The distinction decides whether an off-the-shelf dashboard shows it.
    const derived = { ...complete({}), namesFlakes: false }
    const named = { ...complete({}), namesFlakes: true }

    expect(ask(derived).naming).toBe('silent')
    expect(ask(named).naming).toBe('named')
  })

  it('calls counting sound when every attempt count matches what the subject did', () => {
    expect(ask(complete({})).counting).toBe('sound')
  })

  it('calls counting unsound when another test’s count is wrong', () => {
    // The flaky test's own count is right here. A rate computed over a suite
    // is only as good as its worst row, so one wrong row is enough.
    const reading: Reading = {
      views: [
        view({ name: 'intermittent', status: 'flaky', attempts: 2 }),
        view({ name: 'soft-intermittent', attempts: 2 }),
        view({ name: 'stable' }),
      ],
      namesFlakes: false,
    }

    expect(ask(reading).counting).toBe('unsound')
  })

  it('calls counting blind when the flaky test has no count, whatever the others have', () => {
    expect(ask(complete({ attempts: undefined })).counting).toBe('blind')
  })

  it('ignores tests the artifact never mentions when judging the counts', () => {
    const partial: Reading = {
      views: [view({ name: 'intermittent', status: 'flaky', attempts: 2 })],
      namesFlakes: false,
    }

    expect(ask(partial).counting).toBe('sound')
  })

  it('judges coverage on the last artifact rather than the merged one', () => {
    // After a rerun, what a dashboard ingests is the rerun's file. That the
    // file before it was complete makes no difference to what the dashboard
    // then believes.
    const latest: Reading = { views: [view({ name: 'intermittent', status: 'passed' })], namesFlakes: false }

    expect(ask(complete({}), { latest }).coverage).toBe('failures-only')
    expect(ask(complete({}), { latest }).verdict).toBe('flaky')
  })

  it('calls coverage nothing when the artifact names no test in the plan', () => {
    expect(ask(complete({}), { latest: { views: [], namesFlakes: false } }).coverage).toBe('nothing')
  })

  it('calls coverage whole-suite when every test in the plan is there', () => {
    expect(ask(complete({})).coverage).toBe('whole-suite')
  })
})
