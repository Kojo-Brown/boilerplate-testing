/**
 * Thirteen single-behaviour changes to `ledger.ts`, one per fault.
 *
 * ---------------------------------------------------------------------------
 * Why edits to the real source
 * ---------------------------------------------------------------------------
 * The argument `determinism/faults.ts`, `fuzz/edits.ts`, `snapshot/edits.ts`
 * and `tdd/characterisation/mutants.ts` all make. A second copy of the subject
 * rots the first time the original changes and nothing says so; a flag threaded
 * through the real implementation puts the fault list into production code.
 * {@link applyEdits} requires every `from` below to match exactly once in the
 * file on disk, so a change to `ledger.ts` that invalidates one of these fails
 * `pnpm test` loudly rather than quietly measuring nothing.
 *
 * ---------------------------------------------------------------------------
 * How the corpus is chosen
 * ---------------------------------------------------------------------------
 * Every fault is anchored to a {@link Hazard}, and the hazards are the ones a
 * reviewer is actually looking for when they read concurrent code. That
 * ordering matters more here than in the other directories, because the
 * headline of this one is not *which* faults a strategy catches but *how often*
 * it catches them — and a corpus of only wide-open bugs would report that every
 * strategy is equally good, which is a fact about the corpus.
 *
 * So the corpus is built with a deliberate spread of window sizes:
 *
 *   - `DEPOSIT_NOT_LOCKED` removes the lock from a read-modify-write. The
 *     window is the whole operation and almost any overlap loses an update.
 *   - `DEPOSIT_UNLOCKS_BEFORE_WRITING` keeps the lock and shortens the critical
 *     section by one statement. Same bug, a window of one await.
 *   - `MUTEX_RELEASE_ALWAYS_CLEARS_HELD` needs a task to arrive at the lock in
 *     the moment between a hand-off and the new holder's first await, which is
 *     why `scenarios.ts` has a scenario whose only job is to produce a late
 *     arrival.
 *
 * The last three faults have no concurrency in them at all. They are not
 * filler: without them the matrix has no baseline, and a strategy that misses
 * one of *those* is broken rather than limited.
 */

/** What kind of concurrency bug a fault is an instance of. */
export const HAZARDS = [
  'mutual-exclusion',
  'fairness',
  'deadlock',
  'lost-update',
  'self-interference',
  'stampede',
  'staleness',
  'sequential',
] as const

export type Hazard = (typeof HAZARDS)[number]

export const HAZARD_NOTES: Readonly<Record<Hazard, string>> = {
  'mutual-exclusion':
    'The lock stops excluding. Two tasks are inside a critical section that was ' +
    'written on the assumption that one is.',
  fairness:
    'The lock still excludes, and hands the next turn to the wrong waiter. ' +
    'Nothing is corrupted; a queue has become a scramble, and the tail of the ' +
    'latency distribution is where it shows up in production.',
  deadlock:
    'The lock is never released, so every later operation waits forever. The ' +
    'only fault class here that produces no answer rather than a wrong one.',
  'lost-update':
    'A read-modify-write is not serialised end to end, so one update overwrites ' +
    'another that was computed from the same starting value.',
  'self-interference':
    'One call races itself. No second caller is involved, which is what makes ' +
    'this the class a single-task test can catch.',
  stampede:
    'Work that was meant to be shared between overlapping callers is done once ' +
    'per caller. Correct answers, N times the load.',
  staleness:
    'A cached value outlives what it was cached for, so a caller is told ' +
    'something that used to be true.',
  sequential:
    'A plain bug, reachable with one caller and no interleaving. The baseline ' +
    'the rest of the matrix is measured against.',
}

export const FAULT_IDS = [
  // ---- mutual exclusion ---------------------------------------------------
  'MUTEX_NEVER_MARKED_HELD',
  'MUTEX_ACQUIRE_DOES_NOT_WAIT',
  'MUTEX_RELEASE_ALWAYS_CLEARS_HELD',
  // ---- fairness -----------------------------------------------------------
  'MUTEX_WAKES_THE_NEWEST_WAITER',
  // ---- deadlock -----------------------------------------------------------
  'LOCK_RELEASED_ONLY_ON_SUCCESS',
  // ---- lost update --------------------------------------------------------
  'DEPOSIT_NOT_LOCKED',
  'DEPOSIT_UNLOCKS_BEFORE_WRITING',
  // ---- self-interference --------------------------------------------------
  'SETTLE_APPLIES_IN_PARALLEL',
  // ---- stampede -----------------------------------------------------------
  'READ_NEVER_COALESCED',
  // ---- staleness ----------------------------------------------------------
  'READ_STAYS_IN_FLIGHT',
  // ---- no concurrency required --------------------------------------------
  'OVERDRAFT_CHECK_SOFTENED',
  'TRANSFER_CREDITS_WITHOUT_DEBITING',
  'DEPOSIT_WRITES_THE_AMOUNT_NOT_THE_SUM',
] as const

export type FaultId = (typeof FAULT_IDS)[number]

interface Edit {
  readonly from: string
  readonly to: string
}

export interface Fault {
  readonly id: FaultId
  readonly hazard: Hazard
  /** One line, as it would read in a pull request. */
  readonly description: string
  readonly edits: readonly Edit[]
}

export const FAULTS: readonly Fault[] = [
  {
    id: 'MUTEX_NEVER_MARKED_HELD',
    hazard: 'mutual-exclusion',
    description: 'An uncontended acquire never marks the lock held, so it is never contended.',
    edits: [{ from: 'held = true\n\n      return', to: 'return' }],
  },
  {
    id: 'MUTEX_ACQUIRE_DOES_NOT_WAIT',
    hazard: 'mutual-exclusion',
    description: 'A contended acquire joins the queue and carries on without waiting to be woken.',
    edits: [
      {
        from: 'await new Promise<void>((resume) => {\n      waiting.push(resume)\n    })',
        to: 'waiting.push(() => {})',
      },
    ],
  },
  {
    id: 'MUTEX_RELEASE_ALWAYS_CLEARS_HELD',
    hazard: 'mutual-exclusion',
    description: 'Handing the lock to a waiter also marks it free, so a newcomer can walk in beside them.',
    edits: [
      {
        from: 'const next = waiting.shift()\n\n    if (next === undefined) {\n      held = false\n\n      return\n    }\n\n    next()',
        to: 'const next = waiting.shift()\n\n    held = false\n\n    if (next !== undefined) {\n      next()\n    }',
      },
    ],
  },
  {
    id: 'MUTEX_WAKES_THE_NEWEST_WAITER',
    hazard: 'fairness',
    description: 'The queue is drained from the wrong end, so the newest waiter is served first.',
    edits: [{ from: 'const next = waiting.shift()', to: 'const next = waiting.pop()' }],
  },
  {
    id: 'LOCK_RELEASED_ONLY_ON_SUCCESS',
    hazard: 'deadlock',
    description: 'The release moves out of the `finally`, so a failed transfer keeps the lock forever.',
    edits: [
      {
        from: '    try {\n      return await apply(from, to, amount)\n    } finally {\n      mutex.release()\n    }',
        to: '    const outcome = await apply(from, to, amount)\n\n    mutex.release()\n\n    return outcome',
      },
    ],
  },
  {
    id: 'DEPOSIT_NOT_LOCKED',
    hazard: 'lost-update',
    description: 'A deposit does its read-modify-write without taking the lock at all.',
    edits: [
      {
        from: '    await mutex.acquire()\n\n    try {\n      const current = (await store.read(account)) ?? 0\n\n      await store.write(account, current + amount)\n    } finally {\n      mutex.release()\n    }',
        to: '    const current = (await store.read(account)) ?? 0\n\n    await store.write(account, current + amount)',
      },
    ],
  },
  {
    id: 'DEPOSIT_UNLOCKS_BEFORE_WRITING',
    hazard: 'lost-update',
    description: 'The critical section ends after the read, leaving the write outside it.',
    edits: [
      {
        from: '    await mutex.acquire()\n\n    try {\n      const current = (await store.read(account)) ?? 0\n\n      await store.write(account, current + amount)\n    } finally {\n      mutex.release()\n    }',
        to: '    await mutex.acquire()\n\n    const current = (await store.read(account)) ?? 0\n\n    mutex.release()\n\n    await store.write(account, current + amount)',
      },
    ],
  },
  {
    id: 'SETTLE_APPLIES_IN_PARALLEL',
    hazard: 'self-interference',
    description: 'A batch is applied through `Promise.all`, so its own instructions race each other.',
    edits: [
      {
        from: '      const outcomes: Outcome[] = []\n\n      for (const instruction of instructions) {\n        outcomes.push(await apply(instruction.from, instruction.to, instruction.amount))\n      }\n\n      return outcomes',
        to: '      return await Promise.all(\n        instructions.map((instruction) =>\n          apply(instruction.from, instruction.to, instruction.amount),\n        ),\n      )',
      },
    ],
  },
  {
    id: 'READ_NEVER_COALESCED',
    hazard: 'stampede',
    description: 'The in-flight read is never reused, so every overlapping caller hits the store.',
    edits: [
      {
        from: '    const inFlight = reads.get(account)\n\n    if (inFlight !== undefined) {\n      return await inFlight\n    }\n\n    const pending',
        to: '    const pending',
      },
    ],
  },
  {
    id: 'READ_STAYS_IN_FLIGHT',
    hazard: 'staleness',
    description: 'A settled read is left in the map, so every later caller is served the old value.',
    edits: [
      {
        from: '    try {\n      return await pending\n    } finally {\n      reads.delete(account)\n    }',
        to: '    return await pending',
      },
    ],
  },
  {
    id: 'OVERDRAFT_CHECK_SOFTENED',
    hazard: 'sequential',
    description: 'The affordability check only refuses a negative balance, so any transfer is affordable.',
    edits: [{ from: 'if (source < amount) {', to: 'if (source < 0) {' }],
  },
  {
    id: 'TRANSFER_CREDITS_WITHOUT_DEBITING',
    hazard: 'sequential',
    description: 'The debit is dropped, so a transfer creates money instead of moving it.',
    edits: [
      {
        from: '    await store.write(from, source - amount)\n    await store.write(to, target + amount)',
        to: '    await store.write(to, target + amount)',
      },
    ],
  },
  {
    id: 'DEPOSIT_WRITES_THE_AMOUNT_NOT_THE_SUM',
    hazard: 'sequential',
    description: 'A deposit writes the amount over the balance instead of adding to it.',
    edits: [
      {
        from: 'await store.write(account, current + amount)',
        to: 'await store.write(account, amount)',
      },
    ],
  },
]

export const faultNamed = (id: FaultId): Fault => {
  const found = FAULTS.find((fault) => fault.id === id)

  if (found === undefined) {
    throw new Error(`no fault named ${id}`)
  }

  return found
}

/**
 * Applies every edit, refusing anything that does not match exactly once.
 *
 * "Exactly once" and not "at least once" is the load-bearing part, and it is
 * the same rule `determinism/faults.ts` states: an edit that matches twice
 * changes two things and stops being a single-behaviour fault, and an edit that
 * matches zero times changes nothing, which would report every strategy as
 * catching everything.
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  let result = source

  for (const edit of edits) {
    const occurrences = result.split(edit.from).length - 1

    if (occurrences !== 1) {
      throw new Error(
        `edit anchor matched ${occurrences} times, expected exactly 1: ${JSON.stringify(edit.from)}`,
      )
    }

    result = result.replace(edit.from, edit.to)
  }

  return result
}
