import { describe, expect, it } from 'vitest'

import { turn } from '../concurrency/runtime.ts'

import { Deadlock, Store, UniqueViolation, type OperationEvent } from './store.ts'

const charge = (id: string, requestKey: string | null = null) => ({
  id,
  principal: 'cus_alpha',
  order_id: 'ord_001',
  amount: 2500,
  request_key: requestKey,
})

describe('transactions', () => {
  it('hides writes from other transactions until commit', async () => {
    const store = new Store()
    const writer = store.begin({ delivery: 'a' })
    const reader = store.begin({ delivery: 'b' })

    await writer.insert('charges', charge('ch_1'))

    expect(await reader.select('charges')).toHaveLength(0)

    await writer.commit()

    expect(await store.begin({ delivery: 'c' }).select('charges')).toHaveLength(1)
  })

  it('shows a transaction its own uncommitted writes', async () => {
    const store = new Store()
    const writer = store.begin({ delivery: 'a' })

    await writer.insert('charges', charge('ch_1'))

    expect(await writer.select('charges')).toHaveLength(1)
  })

  it('discards writes on rollback', async () => {
    const store = new Store()
    const writer = store.begin({ delivery: 'a' })

    await writer.insert('charges', charge('ch_1'))
    await writer.rollback()

    expect(store.committed('charges')).toHaveLength(0)
  })

  it('refuses to be used twice', async () => {
    const store = new Store()
    const writer = store.begin({ delivery: 'a' })

    await writer.commit()

    await expect(writer.commit()).rejects.toThrow('already committed')
  })
})

describe('unique indexes', () => {
  it('rejects a second insert of a committed value', async () => {
    const store = new Store()
    const first = store.begin({ delivery: 'a' })

    await first.insert('charges', charge('ch_1', 'ord_001'))
    await first.commit()

    const second = store.begin({ delivery: 'b' })

    await expect(second.insert('charges', charge('ch_2', 'ord_001'))).rejects.toBeInstanceOf(UniqueViolation)
  })

  /**
   * SQL's `NULL != NULL`, and the reason it is tested rather than assumed: with
   * it the `none` strategy writes no request key and is not deduplicated, which
   * is what makes it a control. Without it the index would silently make the
   * control safe and every other column would be measured against a baseline
   * that was already correct.
   */
  it('does not deduplicate rows whose indexed column is null', async () => {
    const store = new Store()
    const writer = store.begin({ delivery: 'a' })

    await writer.insert('charges', charge('ch_1', null))
    await writer.insert('charges', charge('ch_2', null))
    await writer.commit()

    expect(store.committed('charges')).toHaveLength(2)
  })

  it('releases a reservation when the holder rolls back, so the value is free again', async () => {
    const store = new Store()
    const first = store.begin({ delivery: 'a' })

    await first.insert('charges', charge('ch_1', 'ord_001'))
    await first.rollback()

    const second = store.begin({ delivery: 'b' })

    await expect(second.insert('charges', charge('ch_2', 'ord_001'))).resolves.toBeUndefined()
  })
})

describe('a unique index that blocks', () => {
  /**
   * The single property the lease strategies are built on. A `Set` checked at
   * commit time would let both inserts through and fail one at commit; a real
   * index makes the second insert *wait*, which is what serialises two
   * concurrent deliveries of the same key.
   */
  it('makes a conflicting insert wait for the holder rather than fail', async () => {
    const store = new Store()
    const first = store.begin({ delivery: 'a' })
    const second = store.begin({ delivery: 'b' })

    await first.insert('charges', charge('ch_1', 'ord_001'))

    let settled = false
    const blocked = second
      .insert('charges', charge('ch_2', 'ord_001'))
      .then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )

    await turn()
    expect(settled).toBe(false)
    expect(store.isWaiting('b')).toBe(true)

    await first.commit()
    await blocked

    expect(settled).toBe(true)
    expect(store.committed('charges')).toHaveLength(1)
  })

  it('lets the waiter through when the holder rolled back', async () => {
    const store = new Store()
    const first = store.begin({ delivery: 'a' })
    const second = store.begin({ delivery: 'b' })

    await first.insert('charges', charge('ch_1', 'ord_001'))

    const blocked = second.insert('charges', charge('ch_2', 'ord_001'))

    await turn()
    await first.rollback()
    await blocked
    await second.commit()

    expect(store.committed('charges')).toHaveLength(1)
    expect(store.committed('charges')[0]?.['id']).toBe('ch_2')
  })

  /**
   * The bug that made the matrix hang before `killDelivery` existed: a delivery
   * that dies holding a reservation must not hold it forever, because a real
   * database releases a dead connection's locks.
   */
  it('releases the locks of a delivery that died', async () => {
    const store = new Store()
    const first = store.begin({ delivery: 'a' })
    const second = store.begin({ delivery: 'b' })

    await first.insert('charges', charge('ch_1', 'ord_001'))

    const blocked = second.insert('charges', charge('ch_2', 'ord_001'))

    await turn()
    expect(store.isWaiting('b')).toBe(true)

    store.killDelivery('a')
    await blocked
    await second.commit()

    expect(store.committed('charges')).toHaveLength(1)
  })

  it('refuses a wait that would close a cycle rather than hanging', async () => {
    const store = new Store()
    const first = store.begin({ delivery: 'a' })
    const second = store.begin({ delivery: 'b' })

    await first.insert('outbox', { id: 'ob_1', dedup_key: 'one', state: 'pending' })
    await second.insert('outbox', { id: 'ob_2', dedup_key: 'two', state: 'pending' })

    const firstWaits = first.insert('outbox', { id: 'ob_3', dedup_key: 'two', state: 'pending' }).catch(
      (error: unknown) => error,
    )

    await turn()

    await expect(
      second.insert('outbox', { id: 'ob_4', dedup_key: 'one', state: 'pending' }),
    ).rejects.toBeInstanceOf(Deadlock)

    // `second` has to settle before `first` can finish: it still holds the
    // reservation `first` is waiting on, and rolling back only `first` would
    // leave that wait outstanding forever — which is the deadlock the detector
    // just refused to enter, arrived at from the other side.
    await second.rollback()
    await firstWaits
    await first.rollback()
  })
})

describe('the operation hook', () => {
  it('announces every operation twice, before and after', async () => {
    const store = new Store()
    const seen: string[] = []

    store.setHook((event: OperationEvent) => {
      seen.push(`${event.operation}:${event.phase}`)
    })

    const writer = store.begin({ delivery: 'a' })

    await writer.insert('charges', charge('ch_1'))
    await writer.commit()

    expect(seen).toEqual(['insert:before', 'insert:after', 'commit:before', 'commit:after'])
  })

  /**
   * What makes `after-effect` one hazard across eight differently shaped
   * strategies: the commit event says which tables it made durable, so a crash
   * point can name the charge rather than counting commits.
   */
  it('reports the tables a commit made durable', async () => {
    const store = new Store()
    const tables: (readonly string[])[] = []

    store.setHook((event) => {
      if (event.operation === 'commit' && event.phase === 'after') tables.push(event.tables)
    })

    const writer = store.begin({ delivery: 'a' })

    await writer.insert('idempotency_keys', {
      scope: 'cus_alpha',
      principal: 'cus_alpha',
      key: 'k',
      fingerprint: null,
      state: 'done',
      status: 201,
      body: '{}',
      created_at: 0,
    })
    await writer.commit()

    expect(tables).toEqual([['idempotency_keys']])
  })

  it('stops a crashed delivery at its next store call', async () => {
    const store = new Store()
    const writer = store.begin({ delivery: 'a' })

    await writer.insert('charges', charge('ch_1'))
    store.killDelivery('a')

    await expect(writer.insert('charges', charge('ch_2'))).rejects.toThrow(
      'belonged to a delivery that has already crashed',
    )
    expect(store.committed('charges')).toHaveLength(0)
  })
})
