/**
 * The eight wirings, as points in one control space.
 *
 * ---------------------------------------------------------------------------
 * Why a control space rather than eight handlers
 * ---------------------------------------------------------------------------
 * Eight hand-written pipelines would make the matrix uninterpretable. A cell
 * that differs between two of them could differ because of the control the
 * comparison is about or because the two authors happened to write the
 * teardown differently, and there would be no way to tell from the table.
 *
 * So every wiring below is the same runtime (`harness.ts`) reading the same
 * seven fields, and the strategies are named points in that space chosen so
 * that adjacent ones differ by exactly one field. `on-close` →
 * `on-close-cancel` is `cancelInFlight`. `on-close-cancel` →
 * `on-close-seeded` is `seedPolicy`. `on-close-seeded` → `namespace-owned` is
 * `namespaced`. Every jump in the score column is therefore attributable, and
 * `strategies.test.ts` asserts the adjacency rather than leaving it as a claim
 * in prose.
 *
 * ---------------------------------------------------------------------------
 * The one field that is not about teardown
 * ---------------------------------------------------------------------------
 * `trigger` is about who is allowed to make the environment in the first
 * place, and it is in this table because the popular fix for "previews do not
 * work on forks" is `pull_request_target`, which runs the base branch's
 * workflow **with the repository's secrets** against a head commit an
 * untrusted contributor wrote. A preview environment is an unusually good
 * place for that to go wrong: the deployment secret is by construction able to
 * create infrastructure, and the contributor controls the code it runs.
 *
 * The three values are the three real configurations:
 *
 *   - `pull_request` — no secrets on a fork, so fork pull requests get no
 *     environment at all. Safe and useless, which is why people leave it.
 *   - `pull_request_target` — secrets for everybody, immediately. The
 *     copy-pasteable answer, and the one the `fork-*` rows are about.
 *   - `labelled` — `pull_request_target` gated on a maintainer applying a
 *     label. A human decides, once, per contributor. Two cells better than
 *     either, at the cost of a contributor waiting.
 */

import { HOUR } from './clock.ts'
import type { SeedPolicy } from './seeds.ts'

/** The pull-request events a deploy can be wired to. */
export const PR_EVENTS = ['opened', 'synchronize', 'labeled'] as const

export type PrEvent = (typeof PR_EVENTS)[number]

/** Which workflow trigger the deploy is wired to, and therefore who gets secrets. */
export const DEPLOY_TRIGGERS = ['pull_request', 'pull_request_target', 'labelled'] as const

export type DeployTrigger = (typeof DEPLOY_TRIGGERS)[number]

/**
 * What a scheduled sweep uses to decide an environment is finished with.
 *
 *   - `age` — older than the TTL. Needs nothing but the resources' own tags,
 *     which is why it is the one people build, and it cannot tell an abandoned
 *     environment from a pull request still under review.
 *   - `open-prs` — labelled for a pull request that is not open. A reconciler:
 *     it needs to read the repository as well as the cloud, and it is the only
 *     basis here whose answer is about the pull request rather than the clock.
 */
export const REAPER_BASES = ['age', 'open-prs'] as const

export type ReaperBasis = (typeof REAPER_BASES)[number]

export interface Reaper {
  readonly basis: ReaperBasis
  /** Only read by the `age` basis. Four hours is a common preview TTL. */
  readonly ttlMinutes: number
}

/** The seven controls a wiring is made of. */
export interface Wiring {
  readonly trigger: DeployTrigger
  readonly deployOn: readonly PrEvent[]
  /** Whether a `pull_request: closed` workflow destroys the environment. */
  readonly teardownOnClose: boolean
  /** A `concurrency` group shared by deploy and destroy, with `cancel-in-progress`. */
  readonly cancelInFlight: boolean
  /** Whether the stack owns a parent resource everything else is nested in. */
  readonly namespaced: boolean
  readonly seedPolicy: SeedPolicy
  readonly reaper: Reaper | null
}

export interface Strategy {
  readonly key: string
  /** The sentence the README prints for this row. Checked, not generated. */
  readonly blurb: string
  readonly wiring: Wiring
}

const TTL = 4 * HOUR

const ON_PUSH: readonly PrEvent[] = ['opened', 'synchronize']

export const STRATEGIES: readonly Strategy[] = [
  {
    key: 'manual',
    blurb: 'A deploy job on `opened` and a human who remembers to clean up. The control.',
    wiring: {
      trigger: 'pull_request',
      deployOn: ['opened'],
      teardownOnClose: false,
      cancelInFlight: false,
      namespaced: false,
      seedPolicy: 'shared',
      reaper: null,
    },
  },
  {
    key: 'on-close',
    blurb:
      'Deploy on open and push, destroy on `pull_request: closed`, all previews sharing the staging database. The standard answer.',
    wiring: {
      trigger: 'pull_request_target',
      deployOn: ON_PUSH,
      teardownOnClose: true,
      cancelInFlight: false,
      namespaced: false,
      seedPolicy: 'shared',
      reaper: null,
    },
  },
  {
    key: 'on-close-cancel',
    blurb: 'The same, plus one `concurrency` group per pull request with `cancel-in-progress`.',
    wiring: {
      trigger: 'pull_request_target',
      deployOn: ON_PUSH,
      teardownOnClose: true,
      cancelInFlight: true,
      namespaced: false,
      seedPolicy: 'shared',
      reaper: null,
    },
  },
  {
    key: 'on-close-seeded',
    blurb: 'The same, plus a database per environment, seeded from the fixture at deploy time.',
    wiring: {
      trigger: 'pull_request_target',
      deployOn: ON_PUSH,
      teardownOnClose: true,
      cancelInFlight: true,
      namespaced: false,
      seedPolicy: 'per-env',
      reaper: null,
    },
  },
  {
    key: 'ttl-reaper',
    blurb: 'No close hook at all: a scheduled sweep deletes every environment older than four hours.',
    wiring: {
      trigger: 'pull_request_target',
      deployOn: ON_PUSH,
      teardownOnClose: false,
      cancelInFlight: true,
      namespaced: false,
      seedPolicy: 'per-env',
      reaper: { basis: 'age', ttlMinutes: TTL },
    },
  },
  {
    key: 'on-close-ttl',
    blurb: 'A close hook and the four-hour sweep behind it, which is the belt-and-braces answer.',
    wiring: {
      trigger: 'pull_request_target',
      deployOn: ON_PUSH,
      teardownOnClose: true,
      cancelInFlight: true,
      namespaced: false,
      seedPolicy: 'per-env',
      reaper: { basis: 'age', ttlMinutes: TTL },
    },
  },
  {
    key: 'namespace-owned',
    blurb:
      'A close hook, and every resource nested inside one namespace the stack owns, so teardown is one delete.',
    wiring: {
      trigger: 'pull_request_target',
      deployOn: ON_PUSH,
      teardownOnClose: true,
      cancelInFlight: true,
      namespaced: true,
      seedPolicy: 'per-env',
      reaper: null,
    },
  },
  {
    key: 'namespace-reconciled',
    blurb:
      'An owned namespace, a label-gated deploy, and a sweep that deletes any namespace whose pull request is not open.',
    wiring: {
      trigger: 'labelled',
      deployOn: ['opened', 'synchronize', 'labeled'],
      teardownOnClose: true,
      cancelInFlight: true,
      namespaced: true,
      seedPolicy: 'per-env',
      reaper: { basis: 'open-prs', ttlMinutes: TTL },
    },
  },
]

export const strategyKeys = (): readonly string[] => STRATEGIES.map((strategy) => strategy.key)

export function strategyByKey(key: string): Strategy {
  const found = STRATEGIES.find((strategy) => strategy.key === key)

  if (found === undefined) throw new Error(`no strategy called ${key}`)

  return found
}
