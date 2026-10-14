/**
 * The retry helpers, and the registry lookup `createQuarantine` is built on.
 *
 * What this file deliberately does *not* do is try to observe the quarantine
 * branch from inside a running suite. The earlier version of it said so in a
 * comment — "we can only observe the skip-branch in the normal test run" — and
 * then asserted `process.env.QUARANTINE !== '1'`, which is false by
 * construction in the quarantine suite the helper exists for: the one
 * assertion in the file about quarantine mode could only ever fail there.
 *
 * Observing that branch needs a second process, so it is measured in
 * `flake/mechanism.test.ts`, which runs one unchanged fixture file three times
 * — unlisted, listed, and listed with `QUARANTINE=1` — and compares the
 * reports. What is left here is the part that is ordinary computation.
 */

import { describe, expect, it, vi } from 'vitest'

import { isQuarantined } from '@/flake/quarantine'
import { createQuarantine, FLAKY_RETRY, SLOW_RETRY, withRetry } from '@/vitest/flaky'

describe('withRetry', () => {
  it('resolves on the first attempt when the body succeeds', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)

    await withRetry(3, fn)()

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries until the body succeeds within the attempt budget', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1

      if (calls < 3) throw new Error('transient')
    })

    await withRetry(5, fn)()

    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last error when every attempt fails', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent failure'))

    await expect(withRetry(3, fn)()).rejects.toThrow('permanent failure')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('propagates the last error rather than the first', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1

      throw new Error(`attempt ${String(calls)}`)
    })

    await expect(withRetry(3, fn)()).rejects.toThrow('attempt 3')
  })

  it('treats the count as attempts rather than retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(withRetry(1, fn)()).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries a synchronous body that throws', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(() => {
      calls += 1

      if (calls < 2) throw new Error('sync error')
    })

    await withRetry(2, fn)()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('returns a function rather than running the body', () => {
    const fn = vi.fn()

    withRetry(3, fn)

    expect(fn).not.toHaveBeenCalled()
  })

  it('throws undefined for a count below one, rather than treating it as one', async () => {
    // Pinned rather than papered over: silently running the body once would
    // hide a caller's arithmetic bug in the one helper whose job is to make
    // failures survive.
    const fn = vi.fn()

    await expect(withRetry(0, fn)()).rejects.toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('the retry presets', () => {
  it('gives a flaky test three retries and fifteen seconds', () => {
    expect(FLAKY_RETRY).toEqual({ retry: 3, timeout: 15_000 })
  })

  it('gives a slow test more of both than a flaky one', () => {
    expect(SLOW_RETRY.retry).toBeGreaterThan(FLAKY_RETRY.retry)
    expect(SLOW_RETRY.timeout).toBeGreaterThan(FLAKY_RETRY.timeout)
  })
})

describe('createQuarantine', () => {
  const registry = {
    version: 1 as const,
    entries: [
      {
        module: 'suite/thing.test.ts',
        name: 'polls until the stream is ready',
        runner: 'vitest' as const,
        reason: 'races with the fixture poll',
        owner: '@someone',
        ticket: 'FLAKE-1',
        addedOn: '2026-10-01',
        expiresOn: '2026-11-01',
      },
    ],
  }

  it('returns a test function for a file with nothing quarantined in it', () => {
    expect(typeof createQuarantine('file:///repo/other/file.test.ts', { registry, root: '/repo' })).toBe('function')
  })

  it('keys the lookup on the module path the registry uses', () => {
    // The helper's whole job is turning `import.meta.url` into this key, and
    // getting it wrong fails open — the test runs, and nobody is told the
    // quarantine did nothing.
    expect(isQuarantined(registry, 'suite/thing.test.ts', 'polls until the stream is ready')).toBe(true)
  })

  it('accepts a module path that is not a file URL', () => {
    expect(typeof createQuarantine('/repo/suite/thing.test.ts', { registry, root: '/repo' })).toBe('function')
  })
})
