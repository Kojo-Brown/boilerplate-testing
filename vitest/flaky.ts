/**
 * Flaky test utilities: retry helpers and quarantine strategy.
 *
 * QUARANTINE STRATEGY
 * -------------------
 * A quarantined test is one known to be flaky but not yet fixed. Rather than
 * letting it block CI or silencing it with .skip(), quarantine it:
 *
 *   Main suite (QUARANTINE unset): test is skipped — cannot block PRs.
 *   Quarantine suite (QUARANTINE=1): test runs with configured retries
 *     in a non-blocking job whose failures are tracked as warnings.
 *
 * Usage:
 *
 *   import { quarantine, withRetry, FLAKY_RETRY } from '@/vitest/flaky'
 *
 *   // Mark an entire test as quarantined:
 *   quarantine('polls until stream is ready', async () => {
 *     await expect(streamReady()).resolves.toBe(true)
 *   })
 *
 *   // Quarantine with custom retry count / timeout:
 *   quarantine('uploads large file', uploadFn, { retries: 5, timeout: 30_000 })
 *
 *   // Inline retry — useful when only part of a test is flaky:
 *   test('network round-trip', withRetry(3, async () => {
 *     const res = await fetch('/api/ping')
 *     expect(res.ok).toBe(true)
 *   }))
 *
 *   // Preset options for a flaky test:
 *   test('slow DB query', FLAKY_RETRY, async () => { ... })
 */

import { test } from 'vitest'

const QUARANTINE_MODE = process.env['QUARANTINE'] === '1'

export interface QuarantineOptions {
  /** Number of retry attempts in quarantine mode. Defaults to 3. */
  retries?: number
  /** Per-attempt timeout in milliseconds. */
  timeout?: number
}

/**
 * Mark a Vitest test as quarantined (known-flaky, pending fix).
 *
 * In the main suite the test is skipped; in the quarantine suite
 * (QUARANTINE=1) it runs with automatic retries.
 */
export function quarantine(
  name: string,
  fn: () => Promise<void> | void,
  options: QuarantineOptions = {},
): void {
  const { retries = 3, timeout } = options
  if (QUARANTINE_MODE) {
    const opts: { retry: number; timeout?: number } = { retry: retries }
    if (timeout !== undefined) opts.timeout = timeout
    test(name, opts, fn)
  } else {
    test.skip(`[quarantined] ${name}`, fn)
  }
}

/**
 * Retry a test body up to `count` attempts before surfacing the last error.
 *
 * Prefer Vitest's built-in `{ retry }` option when possible. Use this helper
 * when retry logic is needed inside a shared utility or async setup block.
 */
export function withRetry(
  count: number,
  fn: () => Promise<void> | void,
): () => Promise<void> {
  return async function retried() {
    let lastError: unknown
    for (let attempt = 1; attempt <= count; attempt++) {
      try {
        await fn()
        return
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }
}

/**
 * Vitest test-option preset for individually flaky tests.
 *
 *   test('unstable integration', FLAKY_RETRY, async () => { ... })
 */
export const FLAKY_RETRY = { retry: 3, timeout: 15_000 } as const

/**
 * Vitest test-option preset for tests that are especially slow or fragile.
 *
 *   test('cold-start smoke', SLOW_RETRY, async () => { ... })
 */
export const SLOW_RETRY = { retry: 5, timeout: 60_000 } as const
