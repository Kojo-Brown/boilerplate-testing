// @vitest-environment node
/**
 * The runtime, exercised directly rather than through the matrix.
 *
 * The matrix asserts twelve outcomes per wiring and says nothing about how any
 * of them came about, so a runtime bug that happens to produce the expected
 * word is invisible there. These tests go the other way: one control at a
 * time, on timelines written for that control, reading the run ledger and the
 * cloud rather than the outcome.
 */

import { describe, expect, it } from 'vitest'

import { Harness, type Observation } from './harness.ts'
import type { Step } from './hazards.ts'
import { STRATEGIES, type Wiring } from './strategies.ts'

const BASE: Wiring = {
  trigger: 'pull_request_target',
  deployOn: ['opened', 'synchronize'],
  teardownOnClose: true,
  cancelInFlight: false,
  namespaced: false,
  seedPolicy: 'per-env',
  reaper: null,
}

const wiring = (overrides: Partial<Wiring>): Wiring => ({ ...BASE, ...overrides })

const statusOf = (observation: Observation, label: string): string | undefined =>
  observation.runs.find((run) => run.label === label)?.status

const aliveKinds = (observation: Observation, pr: number): readonly string[] =>
  observation.cloud
    .query({ pr: String(pr) })
    .map((resource) => resource.kind)
    .sort()

const OPEN_AND_DEPLOY: readonly Step[] = [
  { kind: 'open', pr: 1, sha: 'aaa', run: 'd1' },
  { kind: 'finish', run: 'd1' },
]

describe('runs', () => {
  it('lands nothing until the run that carries it finishes', () => {
    const observation = Harness.play(BASE, [{ kind: 'open', pr: 1, sha: 'aaa', run: 'd1' }])

    expect(statusOf(observation, 'd1')).toBe('pending')
    expect(aliveKinds(observation, 1)).toEqual([])
  })

  it('lands nothing when the run is cancelled instead', () => {
    const observation = Harness.play(BASE, [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'd1' },
      { kind: 'cancel', run: 'd1' },
      { kind: 'finish', run: 'd1' },
    ])

    expect(statusOf(observation, 'd1')).toBe('cancelled')
    expect(aliveKinds(observation, 1)).toEqual([])
  })

  it('ignores a second finish for a run that already landed', () => {
    const observation = Harness.play(BASE, [
      ...OPEN_AND_DEPLOY,
      { kind: 'finish', run: 'd1' },
    ])

    expect(aliveKinds(observation, 1)).toEqual(['database', 'service'])
  })

  it('never registers a run for an event the wiring is not subscribed to', () => {
    const observation = Harness.play(wiring({ deployOn: ['opened'] }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
      { kind: 'finish', run: 'd2' },
    ])

    expect(statusOf(observation, 'd2')).toBeUndefined()
  })
})

describe('cancel-in-progress', () => {
  it('kills a deploy that is still in flight when another push arrives', () => {
    const observation = Harness.play(wiring({ cancelInFlight: true }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
      { kind: 'push', pr: 1, sha: 'ccc', run: 'd3' },
    ])

    expect(statusOf(observation, 'd2')).toBe('cancelled')
    expect(statusOf(observation, 'd3')).toBe('pending')
  })

  /** The group is shared by the two workflows, which is `zombie-deploy`. */
  it('kills a deploy that is still in flight when the pull request closes', () => {
    const observation = Harness.play(wiring({ cancelInFlight: true }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
      { kind: 'close', pr: 1, run: 'x1' },
    ])

    expect(statusOf(observation, 'd2')).toBe('cancelled')
  })

  it('leaves another pull request in-flight run alone', () => {
    const observation = Harness.play(wiring({ cancelInFlight: true }), [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'd1' },
      { kind: 'open', pr: 3, sha: 'aaa', run: 'd2' },
      { kind: 'push', pr: 1, sha: 'bbb', run: 'd3' },
    ])

    expect(statusOf(observation, 'd2')).toBe('pending')
  })

  it('lets the older deploy land last without it, which is how an environment goes stale', () => {
    const observation = Harness.play(BASE, [
      ...OPEN_AND_DEPLOY,
      { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
      { kind: 'push', pr: 1, sha: 'ccc', run: 'd3' },
      { kind: 'finish', run: 'd3' },
      { kind: 'finish', run: 'd2' },
      { kind: 'probe', pr: 1 },
    ])

    expect(observation.probes.at(-1)?.servingSha).toBe('bbb')
    expect(observation.probes.at(-1)?.headSha).toBe('ccc')
  })
})

describe('the deploy trigger on a fork pull request', () => {
  it('registers a run with no secrets under `pull_request`, which lands nothing', () => {
    const observation = Harness.play(wiring({ trigger: 'pull_request' }), [
      { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'd1' },
      { kind: 'finish', run: 'd1' },
    ])

    expect(statusOf(observation, 'd1')).toBe('blocked')
    expect(aliveKinds(observation, 2)).toEqual([])
    expect(observation.exposed.has(2)).toBe(false)
  })

  it('hands the deployment secret straight to fork-authored code under `pull_request_target`', () => {
    const observation = Harness.play(BASE, [
      { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'd1' },
      { kind: 'finish', run: 'd1' },
    ])

    expect(observation.exposed.has(2)).toBe(true)
  })

  it('registers no run at all under a label gate until a maintainer applies the label', () => {
    const observation = Harness.play(
      wiring({ trigger: 'labelled', deployOn: ['opened', 'synchronize', 'labeled'] }),
      [
        { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'd1' },
        { kind: 'finish', run: 'd1' },
      ],
    )

    expect(statusOf(observation, 'd1')).toBeUndefined()
    expect(observation.exposed.has(2)).toBe(false)
  })

  it('deploys without exposure once the label is applied', () => {
    const observation = Harness.play(
      wiring({ trigger: 'labelled', deployOn: ['opened', 'synchronize', 'labeled'] }),
      [
        { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'd1' },
        { kind: 'label', pr: 2, run: 'd2' },
        { kind: 'finish', run: 'd2' },
      ],
    )

    expect(aliveKinds(observation, 2)).toEqual(['database', 'service'])
    expect(observation.exposed.has(2)).toBe(false)
  })

  it('stays exposed after the label, because the secret has already run', () => {
    const observation = Harness.play(wiring({ deployOn: ['opened', 'synchronize', 'labeled'] }), [
      { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'd1' },
      { kind: 'finish', run: 'd1' },
      { kind: 'label', pr: 2, run: 'd2' },
      { kind: 'finish', run: 'd2' },
    ])

    expect(observation.exposed.has(2)).toBe(true)
  })

  it('never exposes a pull request from the repository itself', () => {
    const observation = Harness.play(BASE, OPEN_AND_DEPLOY)

    expect(observation.exposed.size).toBe(0)
  })
})

describe('the sweep', () => {
  it('does nothing at all when the wiring has no reaper', () => {
    const observation = Harness.play(BASE, [
      ...OPEN_AND_DEPLOY,
      { kind: 'tick', minutes: 10_000 },
      { kind: 'sweep' },
    ])

    expect(aliveKinds(observation, 1)).toEqual(['database', 'service'])
  })

  it('leaves an environment younger than the TTL alone', () => {
    const observation = Harness.play(wiring({ reaper: { basis: 'age', ttlMinutes: 240 } }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'tick', minutes: 239 },
      { kind: 'sweep' },
    ])

    expect(aliveKinds(observation, 1)).toEqual(['database', 'service'])
  })

  it('deletes an environment past the TTL even though its pull request is open', () => {
    const observation = Harness.play(wiring({ reaper: { basis: 'age', ttlMinutes: 240 } }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'tick', minutes: 240 },
      { kind: 'sweep' },
    ])

    expect(aliveKinds(observation, 1)).toEqual([])
    expect(observation.removal.get(1)).toBe('sweep')
  })

  it('measures age from the oldest resource, so a redeploy does not reset the clock', () => {
    const observation = Harness.play(wiring({ reaper: { basis: 'age', ttlMinutes: 240 } }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'tick', minutes: 300 },
      { kind: 'push', pr: 1, sha: 'bbb', run: 'd2' },
      { kind: 'finish', run: 'd2' },
      { kind: 'sweep' },
    ])

    expect(aliveKinds(observation, 1)).toEqual([])
  })

  it('leaves an open pull request alone however old it is, when it reconciles against pull requests', () => {
    const observation = Harness.play(wiring({ reaper: { basis: 'open-prs', ttlMinutes: 240 } }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'tick', minutes: 10_000 },
      { kind: 'sweep' },
    ])

    expect(aliveKinds(observation, 1)).toEqual(['database', 'service'])
  })

  it('deletes a closed pull request environment immediately, however young it is', () => {
    const observation = Harness.play(
      wiring({ teardownOnClose: false, reaper: { basis: 'open-prs', ttlMinutes: 240 } }),
      [...OPEN_AND_DEPLOY, { kind: 'close', pr: 1, run: 'x1' }, { kind: 'sweep' }],
    )

    expect(aliveKinds(observation, 1)).toEqual([])
  })

  it('takes the resources the deployer never recorded with it, because it queries by label', () => {
    const observation = Harness.play(wiring({ reaper: { basis: 'age', ttlMinutes: 240 } }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'traffic', pr: 1 },
      { kind: 'tick', minutes: 300 },
      { kind: 'sweep' },
    ])

    expect(aliveKinds(observation, 1)).toEqual([])
  })

  it('drops the deployer record too, so nothing points at deleted resources', () => {
    const observation = Harness.play(wiring({ reaper: { basis: 'age', ttlMinutes: 240 } }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'tick', minutes: 300 },
      { kind: 'sweep' },
    ])

    expect(observation.deployer.record(1)).toBeUndefined()
  })
})

describe('traffic', () => {
  it('creates a labelled resource the deployer has no record of', () => {
    const observation = Harness.play(BASE, [...OPEN_AND_DEPLOY, { kind: 'traffic', pr: 1 }])

    expect(aliveKinds(observation, 1)).toEqual(['database', 'log-group', 'service'])
    expect(observation.deployer.record(1)?.ids).toHaveLength(2)
  })

  it('nests it inside the namespace when the stack owns one', () => {
    const observation = Harness.play(wiring({ namespaced: true }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'traffic', pr: 1 },
    ])

    const namespace = observation.deployer.record(1)?.namespace
    const group = observation.cloud
      .query({ pr: '1' })
      .find((resource) => resource.kind === 'log-group')

    expect(group?.parent).toBe(namespace)
  })

  it('creates nothing when there is no environment to serve it', () => {
    const observation = Harness.play(BASE, [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'd1' },
      { kind: 'traffic', pr: 1 },
    ])

    expect(aliveKinds(observation, 1)).toEqual([])
  })
})

describe('the probe', () => {
  it('reports the commit the running service was built from', () => {
    const observation = Harness.play(BASE, [...OPEN_AND_DEPLOY, { kind: 'probe', pr: 1 }])

    expect(observation.probes.at(-1)).toMatchObject({ servingSha: 'aaa', headSha: 'aaa' })
  })

  it('reports no service at all once the environment is torn down', () => {
    const observation = Harness.play(BASE, [
      ...OPEN_AND_DEPLOY,
      { kind: 'close', pr: 1, run: 'x1' },
      { kind: 'finish', run: 'x1' },
      { kind: 'probe', pr: 1 },
    ])

    expect(observation.probes.at(-1)?.servingSha).toBeNull()
  })

  it("reports another pull request's writes under a shared dataset", () => {
    const observation = Harness.play(wiring({ seedPolicy: 'shared' }), [
      ...OPEN_AND_DEPLOY,
      { kind: 'open', pr: 3, sha: 'aaa', run: 'd2' },
      { kind: 'finish', run: 'd2' },
      { kind: 'write', pr: 3, row: 'user:1', value: 'mock-tampered@example.invalid' },
      { kind: 'probe', pr: 1 },
    ])

    expect(observation.probes.at(-1)?.foreignRows).toEqual(['user:1'])
  })

  it('reports the schema gap a migration opens under a shared dataset', () => {
    const observation = Harness.play(wiring({ seedPolicy: 'shared' }), [
      { kind: 'open', pr: 1, sha: 'aaa', schema: 'v2', run: 'd1' },
      { kind: 'finish', run: 'd1' },
      { kind: 'probe', pr: 1 },
    ])

    expect(observation.probes.at(-1)).toMatchObject({ datasetSchema: 'v1', expectedSchema: 'v2' })
  })
})

describe('the harness', () => {
  it('refuses a timeline that reads a pull request before it opened', () => {
    expect(() => Harness.play(BASE, [{ kind: 'probe', pr: 9 }])).toThrow('before it opened')
  })

  it('refuses a timeline that closes a pull request before it opened', () => {
    expect(() => Harness.play(BASE, [{ kind: 'close', pr: 9, run: 'x1' }])).toThrow(
      'before it opened',
    )
  })

  it('starts every wiring from an empty cloud, so no cell can depend on another', () => {
    for (const strategy of STRATEGIES) {
      expect(Harness.play(strategy.wiring, []).cloud.alive()).toEqual([])
    }
  })
})
