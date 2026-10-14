// @vitest-environment node

/**
 * Quarantine, end to end: three real runs of one unchanged test file.
 *
 * The file is `fixture/quarantined.test.ts`, which registers its cases through
 * `createQuarantine` and is byte-identical across all three runs. What changes
 * is the registry beside it and the `QUARANTINE` flag:
 *
 *   1. no registry            → the test runs, and its flake is retried
 *   2. registry naming it     → the test is skipped, and cannot block anything
 *   3. registry + QUARANTINE  → the test runs with retries, in its own job
 *
 * The assertion that matters most is the dull one: the name Vitest reports is
 * the same in all three. The helper this replaced registered `[quarantined]
 * ${name}`, which renamed the test at the moment of quarantining — and a name
 * is the key every report joins on, so the history a dashboard needs in order
 * to decide whether the test may come back was discarded by the act of putting
 * it away. `identity.test.ts` measures the same hazard in Playwright's tags.
 */

import { describe, expect, it } from 'vitest'

import { measureQuarantine } from '@/flake/runs'
import type { QuarantineEntry } from '@/flake/quarantine'

const BUDGET = 60_000

const ENTRY: QuarantineEntry = {
  module: 'flake/fixture/quarantined.test.ts',
  name: 'intermittent',
  runner: 'vitest',
  reason: 'the subject of flake/mechanism.test.ts — fails its first attempt by plan',
  owner: '@Kojo-Brown',
  ticket: 'FLAKE-0',
  addedOn: '2026-10-14',
  expiresOn: '2026-11-14',
}

describe('a test the registry does not name', () => {
  it(
    'runs, and its retry is spent on it',
    async () => {
      const run = await measureQuarantine({ entries: [], quarantineMode: false })

      expect(run.results).toEqual([{ name: 'intermittent', status: 'passed' }])
      expect(run.ledger).toHaveLength(2)
      expect(run.exitCode).toBe(0)
    },
    BUDGET,
  )
})

describe('a test the registry names', () => {
  it(
    'is skipped in the main suite, and makes no attempt at all',
    async () => {
      const run = await measureQuarantine({ entries: [ENTRY], quarantineMode: false })

      expect(run.results).toEqual([{ name: 'intermittent', status: 'skipped' }])
      // Not one attempt: a skipped test must not land in the denominator of
      // its own flake rate.
      expect(run.ledger).toEqual([])
    },
    BUDGET,
  )

  it(
    'keeps its name exactly, so its history survives being put away',
    async () => {
      const free = await measureQuarantine({ entries: [], quarantineMode: false })
      const held = await measureQuarantine({ entries: [ENTRY], quarantineMode: false })

      expect(held.results.map((result) => result.name)).toEqual(free.results.map((result) => result.name))
    },
    BUDGET,
  )

  it(
    'still appears in the report, so it can be told from a deleted test',
    async () => {
      const run = await measureQuarantine({ entries: [ENTRY], quarantineMode: false })

      expect(run.results).toHaveLength(1)
    },
    BUDGET,
  )

  it(
    'runs with retries in the quarantine suite',
    async () => {
      const run = await measureQuarantine({ entries: [ENTRY], quarantineMode: true })

      expect(run.results).toEqual([{ name: 'intermittent', status: 'passed' }])
      expect(run.ledger).toHaveLength(2)
    },
    BUDGET,
  )

  it(
    'is matched on its module as well as its name',
    async () => {
      const elsewhere = await measureQuarantine({
        entries: [{ ...ENTRY, module: 'some/other/file.test.ts' }],
        quarantineMode: false,
      })

      // A suite with forty `returns 404 for an unknown id` tests in it is not
      // a theoretical concern.
      expect(elsewhere.results).toEqual([{ name: 'intermittent', status: 'passed' }])
    },
    BUDGET,
  )

  it(
    'is not matched by an entry whose name carries a tag',
    async () => {
      const tagged = await measureQuarantine({ entries: [{ ...ENTRY, name: 'intermittent @flaky' }], quarantineMode: false })

      expect(tagged.results).toEqual([{ name: 'intermittent', status: 'passed' }])
    },
    BUDGET,
  )
})

describe('a permanently failing test the registry names', () => {
  it(
    'is kept out of the main suite’s exit code, which is what quarantine is for',
    async () => {
      const run = await measureQuarantine({
        entries: [ENTRY],
        quarantineMode: false,
        cases: [{ id: 'intermittent', failOn: [1, 2, 3, 4, 5, 6, 7, 8] }],
      })

      expect(run.exitCode).toBe(0)
    },
    BUDGET,
  )

  it(
    'does fail the quarantine suite, where failures are informational',
    async () => {
      const run = await measureQuarantine({
        entries: [ENTRY],
        quarantineMode: true,
        cases: [{ id: 'intermittent', failOn: [1, 2, 3, 4, 5, 6, 7, 8] }],
      })

      expect(run.exitCode).toBe(1)
    },
    BUDGET,
  )

  it(
    'is retried the number of times the helper says, not the number the run says',
    async () => {
      // The run is spawned with `--retry=2`, which is three attempts, and the
      // helper registers quarantined tests with `{ retry: 3 }`, which is four.
      // A per-test option beats the run's, so a quarantined test gets the
      // quarantine's budget wherever it happens to be running — which is the
      // behaviour worth having, and worth pinning rather than assuming.
      const run = await measureQuarantine({
        entries: [ENTRY],
        quarantineMode: true,
        cases: [{ id: 'intermittent', failOn: [1, 2, 3, 4, 5, 6, 7, 8] }],
      })

      expect(run.ledger).toHaveLength(4)
    },
    BUDGET,
  )
})
