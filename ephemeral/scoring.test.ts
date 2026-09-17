// @vitest-environment node
/**
 * The vocabulary and the precedence.
 *
 * The precedence is a claim about severity, so it is tested where the claim
 * bites: on observations that satisfy two words at once. Those are constructed
 * here rather than taken from the corpus, because a corpus hazard that
 * happened to exercise a precedence rule today can stop exercising it tomorrow
 * without anything going red.
 */

import { describe, expect, it } from 'vitest'

import { Harness, type Observation } from './harness.ts'
import { HAZARDS, hazardByKey, type Hazard, type Step } from './hazards.ts'
import { classify, handled, lastProbe, OUTCOMES, score, type Outcome } from './scoring.ts'
import type { Wiring } from './strategies.ts'

const WIRING: Wiring = {
  trigger: 'pull_request_target',
  deployOn: ['opened', 'synchronize'],
  teardownOnClose: true,
  cancelInFlight: false,
  namespaced: false,
  seedPolicy: 'shared',
  reaper: null,
}

const hazard = (overrides: Partial<Hazard> & Pick<Hazard, 'expect'>): Hazard => ({
  key: 'fixture',
  blurb: 'A fixture hazard, constructed for one precedence rule.',
  subject: 1,
  correct: overrides.expect === 'live' ? 'live' : 'clean',
  steps: [],
  ...overrides,
})

const observe = (steps: readonly Step[], wiring: Wiring = WIRING): Observation =>
  Harness.play(wiring, steps)

const DEPLOYED: readonly Step[] = [
  { kind: 'open', pr: 1, sha: 'aaa', run: 'd1' },
  { kind: 'finish', run: 'd1' },
]

describe('the vocabulary', () => {
  it('has no duplicate words', () => {
    expect(new Set(OUTCOMES).size).toBe(OUTCOMES.length)
  })

  it('names `clean` first, because the list is ordered by how bad the word is', () => {
    expect(OUTCOMES[0]).toBe('clean')
  })
})

describe('an account that should be empty', () => {
  it('reads `clean` when teardown removed the environment when the pull request closed', () => {
    const observation = observe([
      ...DEPLOYED,
      { kind: 'close', pr: 1, run: 'x1' },
      { kind: 'finish', run: 'x1' },
    ])

    expect(classify(observation, hazard({ expect: 'clean' }))).toBe('clean')
  })

  it('reads `clean` when no environment was ever created', () => {
    const observation = observe([{ kind: 'open', pr: 1, sha: 'aaa', run: 'd1' }])

    expect(classify(observation, hazard({ expect: 'clean' }))).toBe('clean')
  })

  it('reads `reaped` when a sweep removed it rather than the close hook', () => {
    const observation = observe(
      [
        ...DEPLOYED,
        { kind: 'close', pr: 1, run: 'x1' },
        { kind: 'cancel', run: 'x1' },
        { kind: 'tick', minutes: 300 },
        { kind: 'sweep' },
      ],
      { ...WIRING, reaper: { basis: 'age', ttlMinutes: 240 } },
    )

    expect(classify(observation, hazard({ expect: 'clean' }))).toBe('reaped')
  })

  it('reads `leaked` when it is still running and the deployer still has its ids', () => {
    const observation = observe([
      ...DEPLOYED,
      { kind: 'close', pr: 1, run: 'x1' },
      { kind: 'cancel', run: 'x1' },
    ])

    expect(classify(observation, hazard({ expect: 'clean' }))).toBe('leaked')
  })

  it('reads `orphaned` when it is still running and nothing references it', () => {
    const observation = observe([
      ...DEPLOYED,
      { kind: 'traffic', pr: 1 },
      { kind: 'close', pr: 1, run: 'x1' },
      { kind: 'finish', run: 'x1' },
    ])

    expect(classify(observation, hazard({ expect: 'clean' }))).toBe('orphaned')
  })
})

describe('an environment that should be reviewable', () => {
  it('reads `live` when it serves the head commit from its own data', () => {
    const observation = observe([...DEPLOYED, { kind: 'probe', pr: 1 }], {
      ...WIRING,
      seedPolicy: 'per-env',
    })

    expect(classify(observation, hazard({ expect: 'live' }))).toBe('live')
  })

  it('reads `broken` when there is nothing running', () => {
    const observation = observe([
      ...DEPLOYED,
      { kind: 'close', pr: 1, run: 'x1' },
      { kind: 'finish', run: 'x1' },
      { kind: 'probe', pr: 1 },
    ])

    expect(classify(observation, hazard({ expect: 'live' }))).toBe('broken')
  })

  it('reads `broken` when the data is at a schema the code cannot read', () => {
    const observation = observe([
      { kind: 'open', pr: 1, sha: 'aaa', schema: 'v2', run: 'd1' },
      { kind: 'finish', run: 'd1' },
      { kind: 'probe', pr: 1 },
    ])

    expect(classify(observation, hazard({ expect: 'live' }))).toBe('broken')
  })

  it("reads `poisoned` when it shows another pull request's writes", () => {
    const observation = observe([
      ...DEPLOYED,
      { kind: 'open', pr: 3, sha: 'aaa', run: 'd2' },
      { kind: 'finish', run: 'd2' },
      { kind: 'write', pr: 3, row: 'user:1', value: 'mock-tampered@example.invalid' },
      { kind: 'probe', pr: 1 },
    ])

    expect(classify(observation, hazard({ expect: 'live' }))).toBe('poisoned')
  })

  it('reads `stale` when it serves a commit that is not the head', () => {
    const observation = observe(
      [
        ...DEPLOYED,
        { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
        { kind: 'probe', pr: 1 },
      ],
      { ...WIRING, seedPolicy: 'per-env' },
    )

    expect(classify(observation, hazard({ expect: 'live' }))).toBe('stale')
  })

  it('refuses to judge a hazard that never probed', () => {
    expect(() => classify(observe(DEPLOYED), hazard({ expect: 'live' }))).toThrow('never probes')
  })
})

describe('the precedence', () => {
  it('puts `exposed` above a leaked environment, because a credential outranks a bill', () => {
    const observation = observe([
      { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'd1' },
      { kind: 'finish', run: 'd1' },
      { kind: 'close', pr: 2, run: 'x1' },
      { kind: 'cancel', run: 'x1' },
    ])

    expect(classify(observation, hazard({ expect: 'clean', subject: 2 }))).toBe('exposed')
  })

  it('puts `exposed` above a live environment, so a working preview is not scored as a success', () => {
    const observation = observe([
      { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'd1' },
      { kind: 'finish', run: 'd1' },
      { kind: 'probe', pr: 2 },
    ])

    expect(classify(observation, hazard({ expect: 'live', subject: 2 }))).toBe('exposed')
  })

  it('puts `broken` above `poisoned`, because a reviewer who gets an error page sees no data at all', () => {
    const observation = observe([
      { kind: 'open', pr: 1, sha: 'aaa', schema: 'v2', run: 'd1' },
      { kind: 'finish', run: 'd1' },
      { kind: 'open', pr: 3, sha: 'aaa', run: 'd2' },
      { kind: 'finish', run: 'd2' },
      { kind: 'write', pr: 3, row: 'user:1', value: 'mock-tampered@example.invalid' },
      { kind: 'probe', pr: 1 },
    ])

    expect(classify(observation, hazard({ expect: 'live' }))).toBe('broken')
  })

  /** The judgement call the module comment argues for. */
  it('puts `poisoned` above `stale`, because wrong data looks exactly like right data', () => {
    const observation = observe([
      ...DEPLOYED,
      { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
      { kind: 'open', pr: 3, sha: 'aaa', run: 'd3' },
      { kind: 'finish', run: 'd3' },
      { kind: 'write', pr: 3, row: 'user:1', value: 'mock-tampered@example.invalid' },
      { kind: 'probe', pr: 1 },
    ])

    expect(classify(observation, hazard({ expect: 'live' }))).toBe('poisoned')
  })

  it('puts `orphaned` above `leaked` when the same account holds both kinds of resource', () => {
    // The close hook ran: it deleted the two ids it had and left the log group,
    // so what remains is unreferenced even though a teardown did happen.
    const observation = observe([
      ...DEPLOYED,
      { kind: 'traffic', pr: 1 },
      { kind: 'close', pr: 1, run: 'x1' },
      { kind: 'finish', run: 'x1' },
    ])

    expect(classify(observation, hazard({ expect: 'clean' }))).toBe('orphaned')
  })
})

describe('reading a run', () => {
  it('takes the last probe, because that is what the reviewer acted on', () => {
    const observation = observe(
      [
        ...DEPLOYED,
        { kind: 'probe', pr: 1 },
        { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
        { kind: 'finish', run: 'd2' },
        { kind: 'probe', pr: 1 },
      ],
      { ...WIRING, seedPolicy: 'per-env' },
    )

    expect(lastProbe(observation, 1)?.servingSha).toBe('bbb')
  })

  it('has no probe for a pull request nobody looked at', () => {
    expect(lastProbe(observe(DEPLOYED), 1)).toBeUndefined()
  })
})

describe('scoring', () => {
  it('counts only the outcomes a hazard calls correct', () => {
    const outcomes = new Map<string, Outcome>(
      HAZARDS.map((candidate) => [candidate.key, candidate.correct]),
    )

    expect(score(outcomes, HAZARDS)).toEqual({ handled: HAZARDS.length, of: HAZARDS.length })
  })

  it('counts a missing cell as unhandled rather than throwing', () => {
    expect(score(new Map<string, Outcome>(), HAZARDS)).toEqual({
      handled: 0,
      of: HAZARDS.length,
    })
  })

  it('treats a better-than-nothing outcome as unhandled where the hazard asks for `clean`', () => {
    expect(handled('reaped', hazardByKey('merged'))).toBe(false)
  })

  it('treats `reaped` as handled where that is the best any wiring reaches', () => {
    expect(handled('reaped', hazardByKey('teardown-cancelled'))).toBe(true)
  })
})
