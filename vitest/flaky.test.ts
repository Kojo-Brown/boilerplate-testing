import { describe, it, expect, vi, afterEach } from 'vitest'
import { withRetry, FLAKY_RETRY, SLOW_RETRY, quarantine } from '@/vitest/flaky'

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  it('resolves immediately when fn succeeds on the first attempt', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    await withRetry(3, fn)()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries until success within the attempt budget', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1
      if (calls < 3) throw new Error('transient')
    })
    await withRetry(5, fn)()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last error when every attempt fails', async () => {
    const sentinel = new Error('permanent failure')
    const fn = vi.fn().mockRejectedValue(sentinel)
    await expect(withRetry(3, fn)()).rejects.toThrow('permanent failure')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('respects count=1 (no retries beyond the first attempt)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(withRetry(1, fn)()).rejects.toThrow('boom')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('works with synchronous functions that throw', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(() => {
      calls += 1
      if (calls < 2) throw new Error('sync error')
    })
    await withRetry(2, fn)()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('returns a function — does not run fn immediately', () => {
    const fn = vi.fn()
    withRetry(3, fn)
    expect(fn).not.toHaveBeenCalled()
  })

  it('propagates the last error, not the first', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1
      throw new Error(`attempt ${calls}`)
    })
    await expect(withRetry(3, fn)()).rejects.toThrow('attempt 3')
  })
})

// ---------------------------------------------------------------------------
// FLAKY_RETRY preset
// ---------------------------------------------------------------------------

describe('FLAKY_RETRY', () => {
  it('has retry = 3', () => {
    expect(FLAKY_RETRY.retry).toBe(3)
  })

  it('has timeout = 15_000', () => {
    expect(FLAKY_RETRY.timeout).toBe(15_000)
  })

  it('is a plain object with only retry and timeout', () => {
    const keys = Object.keys(FLAKY_RETRY).sort()
    expect(keys).toEqual(['retry', 'timeout'])
  })
})

// ---------------------------------------------------------------------------
// SLOW_RETRY preset
// ---------------------------------------------------------------------------

describe('SLOW_RETRY', () => {
  it('has retry = 5', () => {
    expect(SLOW_RETRY.retry).toBe(5)
  })

  it('has timeout = 60_000', () => {
    expect(SLOW_RETRY.timeout).toBe(60_000)
  })

  it('has more retries and a longer timeout than FLAKY_RETRY', () => {
    expect(SLOW_RETRY.retry).toBeGreaterThan(FLAKY_RETRY.retry)
    expect(SLOW_RETRY.timeout).toBeGreaterThan(FLAKY_RETRY.timeout)
  })
})

// ---------------------------------------------------------------------------
// quarantine — behaviour is driven by QUARANTINE env var.
// We can only observe the skip-branch in the normal test run because the
// quarantine branch registers a real Vitest `test()`, which would execute.
// We verify the public contract via the QUARANTINE flag indirectly.
// ---------------------------------------------------------------------------

describe('quarantine (normal mode)', () => {
  afterEach(() => {
    delete process.env['QUARANTINE']
  })

  it('QUARANTINE env var is not set in the normal test run', () => {
    expect(process.env['QUARANTINE']).not.toBe('1')
  })

  it('withRetry count must be a positive integer to be useful', () => {
    // Guard: passing 0 would never call fn.
    const fn = vi.fn().mockResolvedValue(undefined)
    // 0 attempts — fn never called, loop exits, throws undefined
    // This documents the edge case rather than asserting specific behaviour.
    expect(() => withRetry(0, fn)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Integration: withRetry as a test body factory (usage demonstration)
// ---------------------------------------------------------------------------

describe('withRetry integration', () => {
  it(
    'succeeds after two transient failures',
    withRetry(3, (() => {
      let runs = 0
      return async () => {
        runs += 1
        if (runs < 3) throw new Error(`transient run ${runs}`)
        // runs === 3 → passes
        expect(runs).toBe(3)
      }
    })()),
  )
})
