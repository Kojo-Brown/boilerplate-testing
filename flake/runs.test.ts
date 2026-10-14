// @vitest-environment node
//
// Node rather than the jsdom default: this file spawns child processes and
// reads the filesystem, and under jsdom `import.meta.url` is an `http:` URL
// that `fileURLToPath` refuses.

/**
 * The matrix, re-derived: eleven real runs of the subject, seventy-seven cells.
 *
 * Every row of `matrix.ts` is measured here rather than asserted from a
 * recording, because every cell in it is a claim about a released version of a
 * test runner — what its reporter writes about a retry — and this repository
 * cannot reimplement that without reimplementing the thing under measurement.
 * A Vitest or Playwright upgrade that changes any of it fails this file, which
 * is the point: the alternative is eleven paragraphs of README that were true
 * once.
 *
 * No browser is launched. The Playwright half of the subject requests no
 * fixture, so `playwright test` runs it in a worker process and never starts
 * one — which is what lets the whole measurement ride `pnpm test` on every
 * Node major instead of needing a job with Chromium in it.
 *
 * Thirteen processes, about 25 seconds. The runs are sequential: two of the
 * wirings run the subject twice over the same attempt ledger, and that is an
 * ordering rather than a batch.
 */

import { describe, expect, it } from 'vitest'

import { EXPECTED, RETRY_MARKER } from '@/flake/matrix'
import { measure, measureRetryMarker, missingTooling } from '@/flake/runs'
import { PLAN, SUBJECT, WIRINGS } from '@/flake/wirings'

const BUDGET = 60_000

describe('the rerun matrix', () => {
  it('has a published row for every wiring, and no row for anything else', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(WIRINGS.map((wiring) => wiring.id).sort())
  })

  it('measures the flaky case under a plan in which nothing fails permanently', () => {
    // Otherwise the `gate` column would be measuring the broken test sitting
    // next to the flake rather than the flake.
    expect(PLAN.cases.some((entry) => entry.id === SUBJECT)).toBe(true)
    expect(PLAN.cases.every((entry) => entry.failOn.length <= 1)).toBe(true)
  })

  it('finds both runners installed', () => {
    expect(missingTooling()).toBeUndefined()
  })

  for (const wiring of WIRINGS) {
    describe(wiring.id, () => {
      it(
        'answers all seven probes the way the published table says',
        async () => {
          const measured = await measure(wiring)

          expect(measured.answers).toEqual(EXPECTED[wiring.id])
        },
        BUDGET,
      )
    })
  }
})

describe('what the runs themselves did', () => {
  it(
    'retries the flaky case exactly as often as the wiring allows',
    async () => {
      const once = await measure(WIRINGS[0] as (typeof WIRINGS)[number])
      const twice = await measure(WIRINGS[1] as (typeof WIRINGS)[number])

      // The ledger is the subject's own account, independent of any reporter:
      // one attempt when retries are off, two when the first retry passes.
      expect(once.ledger.filter((record) => record.id === SUBJECT)).toHaveLength(1)
      expect(twice.ledger.filter((record) => record.id === SUBJECT)).toHaveLength(2)
    },
    BUDGET,
  )

  it(
    'stops retrying as soon as an attempt passes, rather than spending the budget',
    async () => {
      const measured = await measure(WIRINGS[1] as (typeof WIRINGS)[number])

      expect(measured.ledger.filter((record) => record.id === SUBJECT && record.outcome === 'passed')).toHaveLength(1)
    },
    BUDGET,
  )

  it(
    'turns a red run green on the second pass of a rerun wiring',
    async () => {
      const measured = await measure(WIRINGS.find((wiring) => wiring.id === 'vitest-rerun') as (typeof WIRINGS)[number])

      expect(measured.exitCodes).toEqual([1, 0])
    },
    BUDGET,
  )
})

describe('the retry marker', () => {
  it(
    'is printed by the default reporter only when something else in the file failed',
    async () => {
      expect(await measureRetryMarker('vitest-default-retry')).toEqual(RETRY_MARKER['vitest-default-retry'])
    },
    BUDGET,
  )

  it(
    'is never printed by the verbose reporter, which is the one chosen to show retries',
    async () => {
      expect(await measureRetryMarker('vitest-verbose-retry')).toEqual(RETRY_MARKER['vitest-verbose-retry'])
    },
    BUDGET,
  )
})
