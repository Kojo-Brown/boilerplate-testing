// @vitest-environment node
//
// The Vitest half of the subject. Never run by `pnpm test`: `flake/fixture/**`
// is excluded in the root config, and the file refuses to load without
// `FLAKE_PLAN` and `FLAKE_LEDGER` set, which only `../runs.ts` does.

import { expect, test } from 'vitest'

import { runCase } from './ledger.ts'
import { loadPlan } from './plan.ts'

// Tags are not registered here: Vitest has no equivalent of Playwright's tag,
// and the id question the tags exist to ask is a question about Playwright's
// reports. The Vitest column of that probe is answered by the plain title.
for (const { id, failOn, errorsPerAttempt } of loadPlan().cases) {
  test(id, () => {
    runCase(id, failOn, errorsPerAttempt, {
      soft: (message) => {
        expect.soft(1, message).toBe(-1)
      },
    })
  })
}
