/**
 * The fixture's setup file: one shared assertion helper, loaded by the config.
 *
 * It exists to be *changed*. `setup-matcher` in `faults.ts` rewrites the
 * comparison below, and the interesting thing about that fault is its shape in
 * a dependency graph: nothing imports this file. It reaches every test in the
 * fixture through `setupFiles` in `vitest.config.ts`, which is a runner
 * setting rather than an import, so a selector built on imports alone sees a
 * change here as touching nothing at all — and selects nothing, and reports
 * green. That is the reason `triggers.ts` exists.
 */

import { expect } from 'vitest'

expect.extend({
  toBeExactInteger(received: unknown, expected: number) {
    const pass = typeof received === 'number' && Number.isInteger(received) && received === expected

    return {
      pass,
      actual: received,
      expected,
      message: () =>
        pass
          ? `expected ${String(received)} not to be exactly ${String(expected)}`
          : `expected ${String(received)} to be the integer ${String(expected)}`,
    }
  },
})

declare module 'vitest' {
  // The type parameter list must be character-for-character identical to
  // Vitest's own `interface Matchers<T = any>` or TS raises TS2428. Same
  // constraint, and same reason, as `a11y/check.ts`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  interface Matchers<T = any> {
    toBeExactInteger(expected: number): void
  }
}
