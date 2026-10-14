/**
 * The flaky subject's instruction sheet.
 *
 * A measurement of what reruns record needs a test whose flakiness is a fact
 * about the plan rather than about the machine. A `setTimeout` race or a
 * `Math.random()` coin would make the matrix in `wirings.ts` unreproducible in
 * exactly the way that makes flakiness hard to study in the first place, so the
 * subject fails on the attempt numbers a plan names and passes on every other.
 *
 * Attempts are counted in a directory, not in a variable, for two reasons. A
 * Vitest retry re-enters the same worker and an in-memory counter would survive
 * it, but a Playwright retry does not always, and a *rerun* — a second whole
 * process, which is what the "re-run failed jobs" button does — never does. The
 * ledger therefore outlives the process, and `failOn: [1]` means "fail the first
 * attempt ever made", whether the second attempt comes from a retry or from a
 * run half an hour later.
 */

import { readFileSync } from 'node:fs'

/** One test the subject should register, and when it should fail. */
export interface FlakeCase {
  /** Test title. Stable across every wiring: it is what the artifacts key on. */
  readonly id: string
  /**
   * Attempt numbers, 1-based and counted across the whole ledger, on which
   * this case throws. `[]` is a test that always passes; `[1, 2, 3, …]` long
   * enough to outlast the retry budget is a test that always fails.
   */
  readonly failOn: readonly number[]
  /**
   * A Playwright test tag, applied through the `{ tag }` option rather than by
   * putting the tag in the title. Both forms are measured: `probes.ts` asks
   * whether tagging a test changes the id its report keys on, which is the
   * question that decides whether a quarantine mechanism can keep a history.
   */
  readonly tag?: string
  /** Put the tag in the title instead, the way `playwright.config.ts` documents. */
  readonly tagInTitle?: boolean
  /**
   * How many errors a failing attempt files. Above 1, the extras are soft
   * assertions, and the attempt is the counter-example to inferring an attempt
   * count from a report's error messages.
   */
  readonly errorsPerAttempt?: number
}

/** What `FLAKE_PLAN` points at. */
export interface FlakePlan {
  readonly cases: readonly FlakeCase[]
}

function isCase(value: unknown): value is FlakeCase {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as {
    id?: unknown
    failOn?: unknown
    tag?: unknown
    tagInTitle?: unknown
    errorsPerAttempt?: unknown
  }

  const taggedWell = candidate.tag === undefined || (typeof candidate.tag === 'string' && candidate.tag.startsWith('@'))
  const inTitleWell = candidate.tagInTitle === undefined || typeof candidate.tagInTitle === 'boolean'
  const errorsWell =
    candidate.errorsPerAttempt === undefined ||
    (Number.isInteger(candidate.errorsPerAttempt) && (candidate.errorsPerAttempt as number) >= 1)

  return (
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    Array.isArray(candidate.failOn) &&
    candidate.failOn.every((attempt) => Number.isInteger(attempt) && (attempt as number) >= 1) &&
    taggedWell &&
    inTitleWell &&
    errorsWell
  )
}

/**
 * Parse a plan, rejecting anything that is not one.
 *
 * Strictly, because the subject runs inside a child process whose only report
 * is its exit code and its artifacts: a plan silently read as `{ cases: [] }`
 * would make every probe answer "no flake was recorded" for the one reason the
 * matrix must never confuse with a finding.
 */
export function parsePlan(source: string): FlakePlan {
  const payload: unknown = JSON.parse(source)

  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { cases?: unknown }).cases)) {
    throw new Error('flake plan: expected an object with a `cases` array')
  }

  const cases = (payload as { cases: readonly unknown[] }).cases

  for (const [index, entry] of cases.entries()) {
    if (!isCase(entry)) {
      throw new Error(`flake plan: case ${index} is not {id: string, failOn: positive integers}`)
    }
  }

  const ids = new Set(cases.map((entry) => (entry as FlakeCase).id))

  if (ids.size !== cases.length) {
    throw new Error('flake plan: case ids must be unique — the artifacts key on them')
  }

  return { cases: cases as readonly FlakeCase[] }
}

/** Read the plan named by `FLAKE_PLAN`. */
export function loadPlan(): FlakePlan {
  const path = process.env['FLAKE_PLAN']

  if (path === undefined || path === '') {
    throw new Error('flake subject: FLAKE_PLAN is unset. The subject is never run on its own.')
  }

  return parsePlan(readFileSync(path, 'utf8'))
}
