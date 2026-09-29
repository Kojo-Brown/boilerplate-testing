/**
 * Account resolution, which is where the middle three rows of the isolation
 * table actually differ.
 *
 * `accountFor` is one function over `workerInfo` and the strategy's scope, so
 * the difference between "one account per parallel worker" and "one account per
 * worker" is visible as two assertions rather than as two fixtures. The pair of
 * tests naming a restarted worker is the one to read: same `parallelIndex`, new
 * `workerIndex`, and the two scopes disagree about whether that is the same
 * account — which is the whole of `restart-inheritance`.
 */

import { describe, expect, it } from 'vitest'

import { accountFor, SHARED_ACCOUNT, STRATEGIES, strategyByKey, testIdFrom } from './strategies.ts'

const identity = (workerIndex: number, parallelIndex: number, testId = 'a-test'): {
  workerIndex: number
  parallelIndex: number
  testId: string
} => ({ workerIndex, parallelIndex, testId })

describe('run-scoped strategies', () => {
  it('give every worker the one shared account', () => {
    const shared = strategyByKey('shared-file')

    expect([
      accountFor(shared, identity(0, 0)).email,
      accountFor(shared, identity(3, 1)).email,
    ]).toEqual([SHARED_ACCOUNT, SHARED_ACCOUNT])
  })

  it('give every worker the one shared state file', () => {
    expect(accountFor(strategyByKey('shared-lazy'), identity(2, 1)).slot).toBe('shared')
  })
})

describe('per-parallel-index', () => {
  const strategy = strategyByKey('per-parallel-index')

  it('gives two parallel slots two accounts', () => {
    expect(accountFor(strategy, identity(0, 0)).email).not.toBe(
      accountFor(strategy, identity(1, 1)).email,
    )
  })

  it('gives a replacement worker the account of the worker it replaced', () => {
    // A restart keeps the slot and takes a new worker index. This is the cell
    // `restart-inheritance` reports, stated as arithmetic rather than measured.
    expect(accountFor(strategy, identity(4, 0)).email).toBe(
      accountFor(strategy, identity(0, 0)).email,
    )
  })

  it('names the file after the slot, which is what the existsSync branch finds', () => {
    expect(accountFor(strategy, identity(9, 2)).slot).toBe('p2')
  })
})

describe('per-worker-index', () => {
  const strategy = strategyByKey('per-worker-index')

  it('gives two parallel slots two accounts', () => {
    expect(accountFor(strategy, identity(0, 0)).email).not.toBe(
      accountFor(strategy, identity(1, 1)).email,
    )
  })

  it('gives a replacement worker an account of its own', () => {
    expect(accountFor(strategy, identity(4, 0)).email).not.toBe(
      accountFor(strategy, identity(0, 0)).email,
    )
  })

  it('names the file after the worker, so no earlier file is ever found', () => {
    expect(accountFor(strategy, identity(9, 2)).slot).toBe('w9')
  })
})

describe('per-test', () => {
  const strategy = strategyByKey('per-test')

  it('ignores the worker entirely and keys on the test', () => {
    expect(accountFor(strategy, identity(0, 0, 'alpha')).email).toBe(
      accountFor(strategy, identity(7, 3, 'alpha')).email,
    )
  })

  it('gives two tests two accounts', () => {
    expect(accountFor(strategy, identity(0, 0, 'alpha')).email).not.toBe(
      accountFor(strategy, identity(0, 0, 'beta')).email,
    )
  })
})

describe('turning a test title into an account name', () => {
  it('lowercases and hyphenates', () => {
    expect(testIdFrom(['Alpha Spec', 'writes a note'])).toBe('alpha-spec-writes-a-note')
  })

  it('collapses runs of punctuation into one hyphen', () => {
    expect(testIdFrom(['a  --  b'])).toBe('a-b')
  })

  it('trims leading and trailing hyphens, which an email cannot start with', () => {
    expect(testIdFrom(['  !hello!  '])).toBe('hello')
  })

  it('falls back to a name rather than producing an empty local part', () => {
    expect(testIdFrom(['!!!'])).toBe('unnamed')
  })

  it('bounds the length, because a title has none', () => {
    expect(testIdFrom(['x'.repeat(200)])).toHaveLength(60)
  })
})

describe('the declarations', () => {
  it('needs a setup project for exactly the restore-only strategy', () => {
    expect(STRATEGIES.filter((strategy) => strategy.needsSetup).map((s) => s.key)).toEqual([
      'shared-file',
    ])
  })

  it('marks every strategy that needs a setup project as restore-only', () => {
    expect(
      STRATEGIES.filter((strategy) => strategy.needsSetup).every(
        (strategy) => strategy.acquisition === 'restore-only',
      ),
    ).toBe(true)
  })

  it('refuses an unknown strategy name rather than resolving it to a default', () => {
    expect(() => strategyByKey('nope')).toThrow(/no strategy named/i)
  })
})
