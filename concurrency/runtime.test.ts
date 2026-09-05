/**
 * The harness's own tests.
 *
 * Everything `detection.test.ts` reports rests on two claims made here: that a
 * scheduled run is completely described by its choices, and that a task which
 * never finishes comes back as a fact rather than as a hung suite. Neither is
 * checkable from the matrix — a harness that quietly serialised everything
 * would produce a plausible-looking table of zeroes.
 */

import { describe, expect, it } from 'vitest'

import { createLedger, createMutex, type Ledger, type Store } from './ledger.ts'
import {
  replaying,
  runFree,
  runScheduled,
  type Plan,
  type Subject,
} from './runtime.ts'

const subject: Subject = { createLedger, createMutex }

const twoDeposits: Plan = {
  opening: { a: 0 },
  tasks: (ledger) => [() => ledger.deposit('a', 10), () => ledger.deposit('a', 10)],
}

/** A subject whose second caller waits for a lock nobody ever releases. */
const deadlocking: Subject = {
  createMutex,
  createLedger: (store: Store): Ledger => {
    const mutex = createMutex()

    return {
      balance: async () => 0,
      deposit: async (account, amount) => {
        await mutex.acquire()

        const current = (await store.read(account)) ?? 0

        await store.write(account, current + amount)
        // No release: the second deposit queues behind this one forever.
      },
      transfer: async () => ({ ok: true }),
      settle: async () => [],
    }
  },
}

describe('a free run', () => {
  it('leaves the tasks separate when the shape is sequential', async () => {
    const observation = await runFree(subject, twoDeposits, 'sequential', () => 0)

    expect(observation.operations.map((operation) => operation.task)).toEqual([0, 0, 1, 1])
    expect(observation.balances).toEqual({ a: 20 })
  })

  it('lets the second task reach the lock before the first has finished', async () => {
    const observation = await runFree(subject, twoDeposits, 'overlapping', () => 0)

    expect(observation.settled).toBe(true)
    expect(observation.balances).toEqual({ a: 20 })
  })

  it('attributes every store call to the task that made it', async () => {
    const observation = await runFree(subject, twoDeposits, 'overlapping', () => 0)

    expect(new Set(observation.operations.map((operation) => operation.task))).toEqual(
      new Set([0, 1]),
    )
  })

  // The point of the turn budget. `await Promise.all(tasks)` on this subject
  // never resolves, and a test written that way fails as a five-second file
  // timeout naming nothing.
  it('reports a task that never finishes instead of waiting for it', async () => {
    const observation = await runFree(subject, twoDeposits, 'overlapping', () => 0)
    const stuck = await runFree(deadlocking, twoDeposits, 'overlapping', () => 0)

    expect(observation.settled).toBe(true)
    expect(stuck.settled).toBe(false)
    expect(stuck.results.map((result) => result.status)).toEqual(['fulfilled', 'pending'])
  })

  it('rejects the store call the plan nominates, and only that one', async () => {
    const observation = await runFree(
      subject,
      {
        opening: { a: 100, b: 0 },
        failure: { kind: 'write', account: 'b', occurrence: 1 },
        tasks: (ledger) => [() => ledger.transfer('a', 'b', 50)],
      },
      'sequential',
      () => 0,
    )

    expect(observation.results[0]?.status).toBe('rejected')
    expect(observation.balances).toEqual({ a: 50, b: 0 })
  })
})

describe('a scheduled run', () => {
  it('records one choice per operation it settled', async () => {
    const run = await runScheduled(subject, twoDeposits, () => 0)

    expect(run.schedule.choices).toHaveLength(run.observation.operations.length)
    expect(run.schedule.options).toHaveLength(run.schedule.choices.length)
    expect(run.observation.decisions).toBe(run.schedule.choices.length)
  })

  // The claim the reproduction story rests on: the choices are the run.
  it('reproduces a run exactly from the choices it recorded', async () => {
    const first = await runScheduled(subject, twoDeposits, (count) => count - 1)
    const replayed = await runScheduled(subject, twoDeposits, replaying(first.schedule.choices))

    expect(replayed.schedule).toEqual(first.schedule)
    expect(replayed.observation.balances).toEqual(first.observation.balances)
    expect(replayed.observation.operations).toEqual(first.observation.operations)
  })

  it('offers one option at a time while the lock is doing its job', async () => {
    const run = await runScheduled(subject, twoDeposits, () => 0)

    expect(run.schedule.options).toEqual([1, 1, 1, 1])
  })

  it('offers a choice as soon as two tasks are both waiting on the store', async () => {
    const run = await runScheduled(
      subject,
      {
        opening: { a: 7 },
        tasks: (ledger) => [() => ledger.balance('a'), () => ledger.balance('z')],
      },
      () => 0,
    )

    expect(run.schedule.options[0]).toBe(2)
  })

  it('holds a chooser to the options it was offered', async () => {
    const run = await runScheduled(subject, twoDeposits, () => 99)

    expect(run.schedule.choices).toEqual([0, 0, 0, 0])
    expect(run.observation.balances).toEqual({ a: 20 })
  })

  it('reports a deadlock as a run with nothing left to settle and tasks outstanding', async () => {
    const run = await runScheduled(deadlocking, twoDeposits, () => 0)

    expect(run.observation.settled).toBe(false)
    expect(run.observation.results.map((result) => result.status)).toEqual([
      'fulfilled',
      'pending',
    ])
  })
})
