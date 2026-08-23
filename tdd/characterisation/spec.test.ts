// @vitest-environment node
/**
 * The specification-shaped suite, run against the real thing.
 *
 * Eighteen behaviours read out of `requirements.md`. It passes, it reads well,
 * and `detection.test.ts` shows it would have stopped one of ten plausible
 * refactoring accidents — the one it catches by accident, at that. See
 * `specSuite.ts` for how the holes got there; they were not carelessness.
 */

import { describe, it } from 'vitest'

import * as legacy from './legacy/renewal'
import { SPEC_CHECKS } from './specSuite'

describe('the billing rules as documented', () => {
  for (const check of SPEC_CHECKS) {
    it(check.title, () => {
      check.run(legacy)
    })
  }
})
