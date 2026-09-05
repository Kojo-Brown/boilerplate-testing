/**
 * The subject: an account ledger over an asynchronous store.
 *
 * ---------------------------------------------------------------------------
 * Why this shape
 * ---------------------------------------------------------------------------
 * A race needs two things that most example code for concurrency testing does
 * not have together: a piece of state two operations can both reach, and an
 * `await` in the middle of the sequence that touches it. JavaScript has no
 * threads, so every interleaving in this repository happens at an `await` and
 * nowhere else — which is the whole reason a race here is *tractable* to
 * enumerate, and also the reason a suite that never runs two operations at once
 * cannot see one.
 *
 * So the ledger is deliberately made of the three patterns that put an `await`
 * in the middle of a critical section, in the order a service acquires them:
 *
 *   - **Read-modify-write** (`deposit`). Read a balance, add to it, write it
 *     back. Two of these overlapping is the lost update, the oldest bug in the
 *     book, and it needs no exotic scheduling to happen — just two requests.
 *   - **Check-then-act** (`transfer`). Read a balance, decide the transfer is
 *     affordable, then move the money. The decision is made against a value
 *     that another operation may invalidate before the write lands.
 *   - **In-flight coalescing** (`balance`). Share one store read between every
 *     caller that asks while it is outstanding. This is the standard fix for a
 *     cache stampede and it is *itself* concurrent code: the map of pending
 *     reads is shared mutable state reached from several tasks.
 *
 * `createMutex` is here rather than imported for the same reason `session.ts`
 * keeps its constants: `load.ts` compiles a copy of this file on its own, so
 * anything a fault needs to reach has to live in it. That is not a compromise —
 * a lock is where the mutual-exclusion bugs are, and half of `faults.ts` edits
 * these twenty lines.
 *
 * ---------------------------------------------------------------------------
 * What the ledger is *not*
 * ---------------------------------------------------------------------------
 * It is not transactional, and the store deliberately offers no compare-and-set
 * or transaction of its own. Real stores have both, and a ledger built on them
 * would be correct without a lock — which would make it a fine service and a
 * useless subject. The interesting question is not "can a database do this for
 * me" but "when my in-process code is the only thing serialising access, which
 * tests notice that it stopped".
 */

/** The asynchronous store the ledger is built on. */
export interface Store {
  /** The balance, or `undefined` for an account that has never been written. */
  readonly read: (account: string) => Promise<number | undefined>
  readonly write: (account: string, balance: number) => Promise<void>
}

/** Why a transfer was refused. There is exactly one reason. */
export const INSUFFICIENT_FUNDS = 'insufficient-funds'

export type Outcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: typeof INSUFFICIENT_FUNDS }

/** One line of a batch settlement. */
export interface Instruction {
  readonly from: string
  readonly to: string
  readonly amount: number
}

/**
 * A mutual-exclusion lock: one holder at a time, waiters served in arrival
 * order.
 *
 * `release` hands ownership straight to the next waiter rather than freeing the
 * lock and letting whoever wakes first take it. The difference is invisible
 * until three tasks contend, and it is the difference between a queue and a
 * scramble.
 */
export interface Mutex {
  readonly acquire: () => Promise<void>
  readonly release: () => void
  /** How many tasks are queued behind the current holder. */
  readonly waiting: () => number
}

export function createMutex(): Mutex {
  let held = false
  const waiting: Array<() => void> = []

  const acquire = async (): Promise<void> => {
    if (!held) {
      held = true

      return
    }

    await new Promise<void>((resume) => {
      waiting.push(resume)
    })
  }

  const release = (): void => {
    const next = waiting.shift()

    if (next === undefined) {
      held = false

      return
    }

    next()
  }

  return { acquire, release, waiting: () => waiting.length }
}

export interface Ledger {
  /** The current balance, coalescing reads that overlap. */
  readonly balance: (account: string) => Promise<number>
  readonly deposit: (account: string, amount: number) => Promise<void>
  readonly transfer: (from: string, to: string, amount: number) => Promise<Outcome>
  /** Applies a batch of instructions under a single acquisition of the lock. */
  readonly settle: (instructions: readonly Instruction[]) => Promise<readonly Outcome[]>
}

export function createLedger(store: Store): Ledger {
  const mutex = createMutex()
  const reads = new Map<string, Promise<number>>()

  const balance = async (account: string): Promise<number> => {
    const inFlight = reads.get(account)

    if (inFlight !== undefined) {
      return await inFlight
    }

    const pending = store.read(account).then((value) => value ?? 0)

    reads.set(account, pending)

    try {
      return await pending
    } finally {
      reads.delete(account)
    }
  }

  const deposit = async (account: string, amount: number): Promise<void> => {
    await mutex.acquire()

    try {
      const current = (await store.read(account)) ?? 0

      await store.write(account, current + amount)
    } finally {
      mutex.release()
    }
  }

  /** The body of a transfer, assuming the caller already holds the lock. */
  const apply = async (from: string, to: string, amount: number): Promise<Outcome> => {
    const source = (await store.read(from)) ?? 0

    if (source < amount) {
      return { ok: false, reason: INSUFFICIENT_FUNDS }
    }

    const target = (await store.read(to)) ?? 0

    await store.write(from, source - amount)
    await store.write(to, target + amount)

    return { ok: true }
  }

  const transfer = async (from: string, to: string, amount: number): Promise<Outcome> => {
    await mutex.acquire()

    try {
      return await apply(from, to, amount)
    } finally {
      mutex.release()
    }
  }

  const settle = async (instructions: readonly Instruction[]): Promise<readonly Outcome[]> => {
    await mutex.acquire()

    try {
      const outcomes: Outcome[] = []

      for (const instruction of instructions) {
        outcomes.push(await apply(instruction.from, instruction.to, instruction.amount))
      }

      return outcomes
    } finally {
      mutex.release()
    }
  }

  return { balance, deposit, transfer, settle }
}
