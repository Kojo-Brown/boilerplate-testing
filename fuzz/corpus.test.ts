// @vitest-environment node
//
// Compiles variants of `config.ts` and imports them off disk, which needs the
// node environment for the same reason `snapshot/detection.test.ts` does:
// jsdom's `import.meta.url` is not a file URL, so `fileURLToPath` throws
// before a single test runs.
import { describe, expect, it } from 'vitest'

import { probeOnce, runProbe } from './campaign.ts'
import { DETECTIONS } from './corpus.ts'
import { VARIANT_IDS } from './edits.ts'
import { loadControl, loadVariant } from './load.ts'
import type { OracleId } from './oracles.ts'

/**
 * Replaying the recorded witnesses.
 *
 * This is the part of a fuzzing setup that belongs in CI, and it is not the
 * campaign. A campaign is a search over two thousand inputs per probe per
 * fault plus a minimisation search on every hit; a replay is thirty-three
 * inputs and it runs in the time a search spends on its first candidate. What
 * the replay buys is the regression: these sixteen faults, once found, stay
 * found, and a change that makes one of them slip past its probe fails here
 * rather than in a nightly job nobody reads.
 *
 * The two directions both matter and only one of them is obvious. Each witness
 * must still expose its fault — that is the regression gate. Each witness must
 * also be *silent* on the honest subject, which is the check that stops the
 * corpus filling up with inputs that fail for reasons having nothing to do
 * with the bug they were filed under.
 */

const oracleDetections = DETECTIONS.filter((detection) => detection.probe !== 'examples')

describe('every recorded witness still exposes its fault', () => {
  it.each(oracleDetections.map((detection) => [`${detection.variant} / ${detection.probe}`, detection] as const))(
    '%s',
    async (_label, detection) => {
      const subject = await loadVariant(detection.variant)
      const finding = probeOnce(subject, detection.probe as OracleId, detection.witness)

      expect(finding?.reason).toBe(detection.reason)
    },
  )
})

describe('every recorded witness is silent on the honest subject', () => {
  it.each(oracleDetections.map((detection) => [`${detection.variant} / ${detection.probe}`, detection] as const))(
    '%s',
    async (_label, detection) => {
      const control = await loadControl()

      expect(probeOnce(control, detection.probe as OracleId, detection.witness)).toBeNull()
    },
  )
})

describe('the example detections', () => {
  const exampleDetections = DETECTIONS.filter((detection) => detection.probe === 'examples')

  it.each(exampleDetections.map((detection) => [detection.variant, detection] as const))(
    '%s fails a hand-written case for the recorded reason',
    async (variant, detection) => {
      const subject = await loadVariant(variant)

      // Through `runProbe` rather than `firstExampleFailure` directly, because
      // one variant does not fail a case — it takes the stack down inside one,
      // and the recorded reason for it is `SUBJECT_THREW`. A test that called
      // the suite directly would itself crash.
      expect(runProbe(subject, 'examples').finding?.reason).toBe(detection.reason)
    },
  )

  it('records no witness, because the suite generates no input', () => {
    for (const detection of exampleDetections) {
      expect(detection.witness).toBe('')
      expect(detection.evaluations).toBe(0)
    }
  })
})

describe('the corpus is closed', () => {
  it('names only faults that exist', () => {
    for (const detection of DETECTIONS) {
      expect(VARIANT_IDS).toContain(detection.variant)
    }
  })

  it('carries a witness for every oracle detection', () => {
    for (const detection of oracleDetections) {
      expect(detection.witness.length).toBeGreaterThan(0)
    }
  })

  it('records the size a witness arrived at and the size it was reduced to', () => {
    for (const detection of oracleDetections) {
      expect(detection.minimisedLength).toBe(detection.witness.length)
      expect(detection.minimisedLength).toBeLessThanOrEqual(detection.foundLength)
    }
  })

  it('leaves a crash witness at the size it was found', () => {
    // A minimal stack overflow is a fact about the stack, not about the
    // program: ddmin drives it to the exact depth this runtime happens to fail
    // at, and the result stops reproducing on a runner with a larger one.
    // `record.ts` therefore keeps the margin, and the rows say so.
    const crashes = oracleDetections.filter((detection) => detection.reason.endsWith('THREW'))

    expect(crashes.length).toBeGreaterThan(0)

    for (const detection of crashes) {
      expect(detection.minimisedLength).toBe(detection.foundLength)
      expect(detection.evaluations).toBe(0)
    }
  })

  it('reduced the witnesses it did minimise', () => {
    const minimised = oracleDetections.filter((detection) => detection.evaluations > 0)

    for (const detection of minimised) {
      expect(detection.minimisedLength).toBeLessThan(detection.foundLength)
    }
  })
})
