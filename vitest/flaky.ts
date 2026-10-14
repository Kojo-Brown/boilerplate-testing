/**
 * Flaky-test utilities: retry helpers, and a quarantine driven by a registry.
 *
 * ---------------------------------------------------------------------------
 * QUARANTINE
 * ---------------------------------------------------------------------------
 * A quarantined test is one known to be flaky and not yet fixed. Rather than
 * letting it block CI or silencing it with `.skip()`, it is listed in
 * `flake/quarantine.json` — with an owner, a reason, a ticket and an expiry —
 * and the suite reads that file:
 *
 *   Main suite (`QUARANTINE` unset): listed tests are skipped, so they cannot
 *     block a pull request.
 *   Quarantine suite (`QUARANTINE=1`): listed tests run with retries, in a
 *     job whose failures are informational.
 *
 * Three things follow from the list being data rather than a marker at the
 * call site, and all three are the point:
 *
 *   - **A quarantined test keeps its name.** The earlier version of this file
 *     registered `[quarantined] ${name}`, and `playwright.config.ts` still
 *     documents putting `@flaky` in the title. Both rename the test, and a name
 *     is the only key either runner's reports offer — so the test's history
 *     was discarded at the moment of quarantining and again when it was
 *     released, which is to say at both of the moments a flakiness dashboard
 *     exists to inform. `flake/identity.ts` measures that.
 *   - **Releasing a test is deleting a line from a JSON file.** No test file is
 *     touched, so nothing renames and no diff has to be reviewed for behaviour.
 *   - **The list can be audited.** `pnpm flake:check` fails on an entry that is
 *     past its expiry, names a test that no longer exists, or names a test the
 *     attempt history says is either fixed or permanently broken. See
 *     `flake/quarantine.ts`.
 *
 * Usage, at the top of a test file:
 *
 *   import { createQuarantine } from '@/vitest/flaky'
 *
 *   const test = createQuarantine(import.meta.url)
 *
 *   test('polls until the stream is ready', async () => {
 *     await expect(streamReady()).resolves.toBe(true)
 *   })
 *
 * `test` is Vitest's `test` for everything not in the registry, so the file
 * reads the same whether anything in it is quarantined or not.
 *
 * ---------------------------------------------------------------------------
 * RETRIES
 * ---------------------------------------------------------------------------
 * `withRetry` and the two option presets are for a test that is flaky in a
 * known, bounded way. Retrying hides a flake by default: `flake/matrix.ts`
 * measures what each of eleven rerun wirings records, and the short version is
 * that a retried Vitest test is reported as having passed unless something
 * reads `failureMessages` on a passing test. Add `flake/reporter.ts` to any run
 * whose retries you want counted.
 */

import { test as vitestTest } from 'vitest'

import { isQuarantined } from '@/flake/quarantine'
import { loadRegistry } from '@/flake/registry'
import type { Registry } from '@/flake/quarantine'

const QUARANTINE_MODE = process.env['QUARANTINE'] === '1'

export interface QuarantineOptions {
  /** Attempts beyond the first, in quarantine mode. Defaults to 3. */
  readonly retries?: number
  /** Per-attempt timeout in milliseconds. */
  readonly timeout?: number
  /** The registry to consult. Defaults to `flake/quarantine.json`. */
  readonly registry?: Registry
  /** Repository root, for turning `import.meta.url` into a registry key. */
  readonly root?: string
}

/** A `test` that consults the quarantine registry. Same signature as Vitest's. */
export type QuarantineAwareTest = (name: string, fn: () => Promise<void> | void) => void

/**
 * Build the `test` function for one file.
 *
 * Takes `import.meta.url` because the registry is keyed by module and name,
 * and a helper cannot find out which file called it. The alternative — keying
 * on the name alone — would quarantine every test with that name in the
 * repository, which in a suite with forty `returns 404 for an unknown id`
 * tests is not a theoretical concern.
 */
export function createQuarantine(moduleUrl: string, options: QuarantineOptions = {}): QuarantineAwareTest {
  const { retries = 3, timeout, registry = loadRegistry(), root = process.cwd() } = options
  const path = moduleUrl.startsWith('file:') ? new URL(moduleUrl).pathname : moduleUrl
  const module = (path.startsWith(root) ? path.slice(root.length) : path).replace(/^\/+/, '')

  return (name, fn) => {
    if (!isQuarantined(registry, module, name)) {
      vitestTest(name, fn)

      return
    }

    if (!QUARANTINE_MODE) {
      // The name is Vitest's `test.skip` name, unchanged. A skipped test still
      // appears in `vitest list --json` and in every report, which is what
      // keeps `pnpm flake:check` able to tell a quarantined test from a deleted
      // one — and what keeps the test's history joinable when it comes back.
      vitestTest.skip(name, fn)

      return
    }

    const quarantineOptions: { retry: number; timeout?: number } = { retry: retries }

    if (timeout !== undefined) quarantineOptions.timeout = timeout

    vitestTest(name, quarantineOptions, fn)
  }
}

/**
 * Retry a test body up to `count` attempts before surfacing the last error.
 *
 * Prefer Vitest's built-in `{ retry }` option. Use this when the retry has to
 * live inside a shared utility or an async setup block, where there is no test
 * option to set.
 *
 * `count` is a number of attempts, not of retries: `withRetry(1, fn)` calls
 * `fn` once. A count below 1 calls it never and throws `undefined`, which
 * `flaky.test.ts` pins rather than papers over — the alternative, silently
 * treating 0 as 1, hides a caller's arithmetic bug in the one helper whose job
 * is to make failures survive.
 */
export function withRetry(count: number, fn: () => Promise<void> | void): () => Promise<void> {
  return async function retried() {
    let lastError: unknown

    for (let attempt = 1; attempt <= count; attempt += 1) {
      try {
        await fn()

        return
      } catch (error) {
        lastError = error
      }
    }

    throw lastError
  }
}

/**
 * Vitest test-option preset for individually flaky tests.
 *
 *   test('unstable integration', FLAKY_RETRY, async () => { … })
 */
export const FLAKY_RETRY = { retry: 3, timeout: 15_000 } as const

/**
 * Vitest test-option preset for tests that are especially slow or fragile.
 *
 *   test('cold-start smoke', SLOW_RETRY, async () => { … })
 */
export const SLOW_RETRY = { retry: 5, timeout: 60_000 } as const
