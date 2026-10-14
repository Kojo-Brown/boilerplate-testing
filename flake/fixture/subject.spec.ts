/**
 * The Playwright half of the subject.
 *
 * No fixture is requested — not `page`, not `request` — so Playwright launches
 * no browser for it. That is deliberate and it is what keeps the whole rerun
 * matrix inside `pnpm test` on a machine with no browser installed: what a
 * reporter records about a retry is the runner's behaviour, and paying for
 * Chromium to establish it would be paying for the wrong instrument.
 */

import { expect, test } from '@playwright/test'

import { runCase } from './ledger.ts'
import { loadPlan } from './plan.ts'

for (const testCase of loadPlan().cases) {
  const { id, failOn, tag, tagInTitle, errorsPerAttempt } = testCase

  const body = (): void => {
    runCase(id, failOn, errorsPerAttempt, {
      soft: (message) => {
        expect.soft(1, message).toBe(-1)
      },
    })
  }

  // Two ways of tagging the same test, because which one is used decides
  // whether the id its report keys on survives being quarantined. See
  // `../probes.ts`.
  if (tag !== undefined && tagInTitle === true) {
    test(`${id} ${tag}`, body)
  } else if (tag !== undefined) {
    test(id, { tag }, body)
  } else {
    test(id, body)
  }
}
