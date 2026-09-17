/**
 * The twelve timelines, and what a correct wiring does with each.
 *
 * ---------------------------------------------------------------------------
 * Why timelines and not assertions
 * ---------------------------------------------------------------------------
 * Every one of these is a sequence of things that happen to a repository, with
 * no expectation attached beyond the single word in `correct`. That shape is
 * deliberate: the reason per-PR environments leak is almost never that
 * teardown was not written, it is that teardown was written for a timeline
 * nobody drew. The close hook exists; the run that would have executed it was
 * cancelled, or it ran and a deploy that was already in flight finished
 * afterwards and put everything back.
 *
 * So runs are explicit. A step that would start a workflow names the run it
 * starts, and a later `finish` or `cancel` step decides that run's fate. The
 * orders that matter are then writable — `zombie-deploy` is nothing but
 * `finish` on the destroy before `finish` on the deploy — and they are
 * deterministic, because nothing in this directory races: there is no timer,
 * no sleep and no scheduler, only the order in the array.
 *
 * ---------------------------------------------------------------------------
 * `correct` is what is achievable, not what is ideal
 * ---------------------------------------------------------------------------
 * `teardown-cancelled` is the row to read first. Its correct answer is
 * `reaped`, not `clean`, because once the run that would have destroyed the
 * environment has died there is no wiring that can make the environment go
 * away *at the moment the pull request closed* — the best available outcome is
 * that something notices later. Scoring it against `clean` would mark all
 * eight strategies wrong and teach nothing about the three that recover.
 *
 * `sweep-never-ran` is the opposite case and is in the corpus for the opposite
 * reason: its correct answer is `reaped` and no strategy achieves it, because
 * the sweep every recovering design depends on is itself a scheduled workflow.
 * GitHub disables `schedule:` workflows on repositories with sixty days of no
 * activity, and it does so quietly. The row is the floor of the table, and the
 * thing that actually bounds the loss — a spend alert on the account — is not
 * a wiring and has no column here.
 */

import { HOUR } from './clock.ts'
import type { Outcome } from './scoring.ts'
import { BASE_SCHEMA } from './seeds.ts'

/** One thing that happens. See the module comment for why runs are named. */
export type Step =
  | {
      readonly kind: 'open'
      readonly pr: number
      readonly sha: string
      readonly schema?: string
      readonly fork?: boolean
      /** The deploy run this event would start. */
      readonly run: string
    }
  | {
      readonly kind: 'push'
      readonly pr: number
      readonly sha: string
      readonly schema?: string
      readonly run: string
    }
  /** A maintainer applies the preview label to a fork's pull request. */
  | { readonly kind: 'label'; readonly pr: number; readonly run: string }
  | { readonly kind: 'close'; readonly pr: number; readonly run: string }
  /** The named run reaches the end of its job and its effects land. */
  | { readonly kind: 'finish'; readonly run: string }
  /** The named run dies before its effects land: a cancelled or failed run. */
  | { readonly kind: 'cancel'; readonly run: string }
  /**
   * Somebody uses the environment, and the platform creates a resource for it
   * that the deployer never asked for and does not know about.
   */
  | { readonly kind: 'traffic'; readonly pr: number }
  /** A write from inside one environment — that pull request's end-to-end run. */
  | { readonly kind: 'write'; readonly pr: number; readonly row: string; readonly value: string }
  /** The scheduled sweep fires, if the wiring has one. */
  | { readonly kind: 'sweep' }
  | { readonly kind: 'tick'; readonly minutes: number }
  /** A reviewer opens the environment and looks at it. */
  | { readonly kind: 'probe'; readonly pr: number }

/** What a correct wiring leaves behind for the pull request under judgement. */
export type Expectation = 'clean' | 'live'

export interface Hazard {
  readonly key: string
  /** The sentence the README prints for this row. Checked, not generated. */
  readonly blurb: string
  /** The pull request the outcome is read from. */
  readonly subject: number
  readonly expect: Expectation
  /** The best outcome any wiring can reach here. See the module comment. */
  readonly correct: Outcome
  readonly steps: readonly Step[]
}

/** Long enough that every TTL in `strategies.ts` has expired. */
const PAST_TTL = 5 * HOUR

/** The schema a pull request carrying a migration expects its data at. */
export const MIGRATED_SCHEMA = 'v2'

export const HAZARDS: readonly Hazard[] = [
  {
    key: 'merged',
    blurb: 'A pull request is opened, reviewed and merged. The happy path.',
    subject: 1,
    expect: 'clean',
    correct: 'clean',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'close', pr: 1, run: 'destroy-1' },
      { kind: 'finish', run: 'destroy-1' },
      { kind: 'tick', minutes: PAST_TTL },
      { kind: 'sweep' },
    ],
  },
  {
    key: 'long-review',
    blurb: 'A pull request stays open longer than the TTL and a reviewer opens its environment.',
    subject: 1,
    expect: 'live',
    correct: 'live',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'tick', minutes: PAST_TTL },
      { kind: 'sweep' },
      { kind: 'probe', pr: 1 },
    ],
  },
  {
    key: 'pushed-a-fix',
    blurb: 'The author pushes a second commit and the reviewer reloads.',
    subject: 1,
    expect: 'live',
    correct: 'live',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'push', pr: 1, sha: 'bbb', run: 'deploy-2' },
      { kind: 'finish', run: 'deploy-2' },
      { kind: 'probe', pr: 1 },
    ],
  },
  {
    key: 'racing-pushes',
    blurb: 'Two commits land in quick succession and the older deploy finishes last.',
    subject: 1,
    expect: 'live',
    correct: 'live',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'push', pr: 1, sha: 'bbb', run: 'deploy-2' },
      { kind: 'push', pr: 1, sha: 'ccc', run: 'deploy-3' },
      { kind: 'finish', run: 'deploy-3' },
      { kind: 'finish', run: 'deploy-2' },
      { kind: 'probe', pr: 1 },
    ],
  },
  {
    key: 'teardown-cancelled',
    blurb: 'The pull request closes and the run that would have destroyed the environment dies.',
    subject: 1,
    expect: 'clean',
    correct: 'reaped',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'close', pr: 1, run: 'destroy-1' },
      { kind: 'cancel', run: 'destroy-1' },
      { kind: 'tick', minutes: PAST_TTL },
      { kind: 'sweep' },
    ],
  },
  {
    key: 'zombie-deploy',
    blurb: 'A deploy is still in flight when the pull request closes, and finishes after teardown.',
    subject: 1,
    expect: 'clean',
    correct: 'clean',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'push', pr: 1, sha: 'bbb', run: 'deploy-2' },
      { kind: 'close', pr: 1, run: 'destroy-1' },
      { kind: 'finish', run: 'destroy-1' },
      { kind: 'finish', run: 'deploy-2' },
      { kind: 'tick', minutes: PAST_TTL },
      { kind: 'sweep' },
    ],
  },
  {
    key: 'platform-created-resource',
    blurb:
      'The environment serves traffic, so the platform creates a resource the stack never recorded.',
    subject: 1,
    expect: 'clean',
    correct: 'clean',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'traffic', pr: 1 },
      { kind: 'close', pr: 1, run: 'destroy-1' },
      { kind: 'finish', run: 'destroy-1' },
      { kind: 'tick', minutes: PAST_TTL },
      { kind: 'sweep' },
    ],
  },
  {
    key: 'sweep-never-ran',
    blurb: 'Teardown dies and the scheduled sweep that would have recovered it never fires.',
    subject: 1,
    expect: 'clean',
    correct: 'reaped',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'traffic', pr: 1 },
      { kind: 'close', pr: 1, run: 'destroy-1' },
      { kind: 'cancel', run: 'destroy-1' },
      { kind: 'tick', minutes: PAST_TTL },
    ],
  },
  {
    key: 'fork-pr-unreviewed',
    blurb: 'A first-time contributor opens a pull request from a fork and nobody has looked at it.',
    subject: 2,
    expect: 'clean',
    correct: 'clean',
    steps: [
      { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'tick', minutes: PAST_TTL },
      { kind: 'sweep' },
    ],
  },
  {
    key: 'fork-pr-approved',
    blurb: 'A maintainer reads that fork pull request and asks for an environment for it.',
    subject: 2,
    expect: 'live',
    correct: 'live',
    steps: [
      { kind: 'open', pr: 2, sha: 'aaa', fork: true, run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'label', pr: 2, run: 'deploy-2' },
      { kind: 'finish', run: 'deploy-2' },
      { kind: 'probe', pr: 2 },
    ],
  },
  {
    key: 'cross-pr-write',
    blurb: "Another pull request's end-to-end run writes, and this one's reviewer reloads.",
    subject: 1,
    expect: 'live',
    correct: 'live',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'open', pr: 3, sha: 'aaa', run: 'deploy-2' },
      { kind: 'finish', run: 'deploy-2' },
      { kind: 'write', pr: 3, row: 'user:1', value: 'mock-tampered@example.invalid' },
      { kind: 'probe', pr: 1 },
    ],
  },
  {
    key: 'migration-in-pr',
    blurb: 'The pull request contains a migration, so its code needs data at a schema `main` is not at.',
    subject: 1,
    expect: 'live',
    correct: 'live',
    steps: [
      { kind: 'open', pr: 1, sha: 'aaa', schema: MIGRATED_SCHEMA, run: 'deploy-1' },
      { kind: 'finish', run: 'deploy-1' },
      { kind: 'probe', pr: 1 },
    ],
  },
]

/** The schema a commit expects, which is the base unless the step says otherwise. */
export const schemaOf = (step: { readonly schema?: string }): string => step.schema ?? BASE_SCHEMA

export const hazardKeys = (): readonly string[] => HAZARDS.map((hazard) => hazard.key)

export function hazardByKey(key: string): Hazard {
  const found = HAZARDS.find((hazard) => hazard.key === key)

  if (found === undefined) throw new Error(`no hazard called ${key}`)

  return found
}
