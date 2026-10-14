// @vitest-environment node
//
// The registry-driven half of the subject. Never run by `pnpm test`:
// `flake/fixture/**` is excluded in the root config, and this file refuses to
// load without `FLAKE_PLAN` and `FLAKE_LEDGER` set. `../runs.ts` runs it three
// times — with no registry, with a registry naming its case, and with that
// registry plus `QUARANTINE=1` — and `../mechanism.test.ts` compares what the
// reports say about the three.
//
// It registers its cases through `createQuarantine` rather than `test`, which
// is the whole point: the call site below is identical in all three runs.

import { createQuarantine } from '@/vitest/flaky'

import { runCase } from './ledger.ts'
import { loadPlan } from './plan.ts'

const test = createQuarantine(import.meta.url)

for (const { id, failOn, errorsPerAttempt } of loadPlan().cases) {
  test(id, () => {
    runCase(id, failOn, errorsPerAttempt)
  })
}
