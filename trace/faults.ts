/**
 * The nine failures, and what somebody staring at a red CI job believes about
 * each one before they open the trace.
 *
 * The third field is the point of the catalogue. Eight of these nine report
 * themselves to the terminal as a timeout on a locator, and the terminal is all
 * a CI log has: the reason a run is red is almost never the reason it failed.
 * `evidence.ts` measures which channel of the trace closes that gap, and
 * `README.md` publishes it.
 *
 * `missing-env` has no page variant, and that is deliberate rather than an
 * omission — see its entry.
 */

import { FAULT_NAMES, type FaultName } from './subject.ts'

/** A fault name, or the one case that never reaches the browser. */
export type CaseName = Exclude<FaultName, 'none'> | 'missing-env'

export type Case = {
  readonly name: CaseName
  /** The defect, in the page or in the test. */
  readonly defect: string
  /** What the CI log says, which is the only thing a reader starts with. */
  readonly reportedAs: string
}

export const CASES: readonly Case[] = [
  {
    name: 'renamed-element',
    defect: 'the page renders `#sum`; the test waits for `#total`',
    reportedAs: 'timeout waiting for locator',
  },
  {
    name: 'duplicate-label',
    defect: 'two buttons carry the same accessible name',
    reportedAs: 'strict mode violation',
  },
  {
    name: 'covered-button',
    defect: 'a transparent overlay sits on top of the button',
    reportedAs: 'timeout waiting for element to be stable',
  },
  {
    name: 'late-content',
    defect: 'the total arrives after the assertion timeout',
    reportedAs: 'expected 1240, received the placeholder',
  },
  {
    name: 'failing-api',
    defect: 'the endpoint answers 500 and the page renders nothing',
    reportedAs: 'timeout waiting for locator',
  },
  {
    name: 'hanging-api',
    defect: 'the endpoint never answers',
    reportedAs: 'timeout waiting for locator',
  },
  {
    name: 'throwing-script',
    defect: 'an uncaught TypeError stops the page before it fetches',
    reportedAs: 'timeout waiting for locator',
  },
  {
    // The case that exists to mark the boundary of the tool. Its cause is a
    // variable the runner did not have, so there was nothing for a browser to
    // record and no page to snapshot: the trace is written, it opens, and it
    // contains no account of why the run is red. A guide that did not ship this
    // row would be recommending the trace viewer for failures it cannot explain.
    name: 'missing-env',
    defect: 'the test reads an environment variable CI does not set',
    reportedAs: 'Error: TRACE_FIXTURE_TOKEN is not set',
  },
] as const

export const CASE_NAMES: readonly CaseName[] = CASES.map((entry) => entry.name)

export function caseByName(name: CaseName): Case {
  const found = CASES.find((entry) => entry.name === name)

  if (found === undefined) {
    throw new Error(`Unknown case: ${name}`)
  }

  return found
}

/** The variable `missing-env` reads, and never finds. */
export const FIXTURE_TOKEN_VAR = 'TRACE_FIXTURE_TOKEN'

/**
 * Every page fault has a case, and every case but `missing-env` has a page
 * fault. Asserted in `faults.test.ts`; exported so that check and test agree on
 * what "covered" means rather than each deciding.
 */
export function pageFaults(): readonly FaultName[] {
  return FAULT_NAMES.filter((name) => name !== 'none')
}
