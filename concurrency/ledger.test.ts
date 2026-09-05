/**
 * The subject's own tests: what the ledger promises when nothing is wrong.
 *
 * Deliberately ordinary. These are the tests somebody would write for this
 * module without having read the rest of the directory — a couple of happy
 * paths, the refusal, the lock's own contract — and they are here so that the
 * comparison in `detection.test.ts` is not the only thing holding the subject
 * up. If `ledger.ts` is broken outright, this file says so in a sentence
 * instead of leaving a matrix of unexplained zeroes.
 */

import { describe, expect, it } from 'vitest'

import { createLedger, createMutex, INSUFFICIENT_FUNDS, type Store } from './ledger.ts'

/** The smallest store that is still asynchronous: a map behind a microtask. */
function memoryStore(opening: Readonly<Record<string, number>> = {}): Store & {
  readonly snapshot: () => Record<string, number>
} {
  const balances = new Map(Object.entries(opening))

  return {
    read: async (account) => balances.get(account),
    write: async (account, balance) => {
      balances.set(account, balance)
    },
    snapshot: () => Object.fromEntries(balances),
  }
}

describe('the lock', () => {
  it('lets an uncontended acquire straight through', async () => {
    const mutex = createMutex()

    await mutex.acquire()

    expect(mutex.waiting()).toBe(0)
  })

  it('queues a second acquire behind the holder', async () => {
    const mutex = createMutex()

    await mutex.acquire()

    let entered = false
    const second = mutex.acquire().then(() => {
      entered = true
    })

    await Promise.resolve()
    expect(entered).toBe(false)
    expect(mutex.waiting()).toBe(1)

    mutex.release()
    await second

    expect(entered).toBe(true)
  })

  it('serves waiters in the order they arrived', async () => {
    const mutex = createMutex()
    const entered: number[] = []

    await mutex.acquire()

    const waiters = [0, 1, 2].map(async (index) => {
      await mutex.acquire()
      entered.push(index)
      mutex.release()
    })

    mutex.release()
    await Promise.all(waiters)

    expect(entered).toEqual([0, 1, 2])
  })

  it('stays free once the last waiter has gone', async () => {
    const mutex = createMutex()

    await mutex.acquire()
    mutex.release()
    await mutex.acquire()

    expect(mutex.waiting()).toBe(0)
  })
})

describe('the ledger', () => {
  it('adds a deposit to the balance already there', async () => {
    const store = memoryStore({ a: 5 })
    const ledger = createLedger(store)

    await ledger.deposit('a', 10)

    expect(store.snapshot()).toEqual({ a: 15 })
  })

  it('treats an account nobody has written as empty', async () => {
    const store = memoryStore()

    await createLedger(store).deposit('new', 3)

    expect(store.snapshot()).toEqual({ new: 3 })
  })

  it('moves money between two accounts', async () => {
    const store = memoryStore({ a: 100, b: 0 })

    await expect(createLedger(store).transfer('a', 'b', 40)).resolves.toEqual({ ok: true })
    expect(store.snapshot()).toEqual({ a: 60, b: 40 })
  })

  it('refuses a transfer the source cannot afford, and changes nothing', async () => {
    const store = memoryStore({ a: 30, b: 0 })

    await expect(createLedger(store).transfer('a', 'b', 40)).resolves.toEqual({
      ok: false,
      reason: INSUFFICIENT_FUNDS,
    })
    expect(store.snapshot()).toEqual({ a: 30, b: 0 })
  })

  it('applies each line of a batch on top of the one before it', async () => {
    const store = memoryStore({ a: 100, b: 0 })

    const outcomes = await createLedger(store).settle([
      { from: 'a', to: 'b', amount: 40 },
      { from: 'a', to: 'b', amount: 30 },
    ])

    expect(outcomes).toEqual([{ ok: true }, { ok: true }])
    expect(store.snapshot()).toEqual({ a: 30, b: 70 })
  })

  it('carries on through a line of a batch it cannot afford', async () => {
    const store = memoryStore({ a: 50, b: 0 })

    const outcomes = await createLedger(store).settle([
      { from: 'a', to: 'b', amount: 80 },
      { from: 'a', to: 'b', amount: 20 },
    ])

    expect(outcomes).toEqual([{ ok: false, reason: INSUFFICIENT_FUNDS }, { ok: true }])
    expect(store.snapshot()).toEqual({ a: 30, b: 20 })
  })

  it('shares one store read between callers who overlap', async () => {
    let reads = 0
    const ledger = createLedger({
      read: async (account) => {
        reads += 1

        return account === 'a' ? 7 : undefined
      },
      write: async () => {},
    })

    await expect(Promise.all([ledger.balance('a'), ledger.balance('a')])).resolves.toEqual([7, 7])
    expect(reads).toBe(1)
  })

  it('goes back to the store once the shared read has settled', async () => {
    let reads = 0
    const ledger = createLedger({
      read: async () => {
        reads += 1

        return 7
      },
      write: async () => {},
    })

    await ledger.balance('a')
    await ledger.balance('a')

    expect(reads).toBe(2)
  })

  it('releases the lock when the store rejects, so later work still runs', async () => {
    const balances = new Map<string, number>([['a', 100]])
    const ledger = createLedger({
      read: async (account) => balances.get(account),
      write: async (account, balance) => {
        if (account === 'b') {
          throw new Error('store write of b failed')
        }

        balances.set(account, balance)
      },
    })

    await expect(ledger.transfer('a', 'b', 50)).rejects.toThrow('store write of b failed')
    await ledger.deposit('a', 5)

    expect(balances.get('a')).toBe(55)
  })
})
