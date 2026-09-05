/**
 * The two ways a scenario can be run: leave the interleaving to the runtime, or
 * decide it.
 *
 * ---------------------------------------------------------------------------
 * Why the store is the seam
 * ---------------------------------------------------------------------------
 * In a language with threads, controlling an interleaving means controlling the
 * scheduler, which means a runtime nobody has. In JavaScript a task can only
 * lose control at an `await`, and every `await` in `ledger.ts` is waiting on the
 * store. So the store *is* the scheduler: hand the subject a store whose
 * promises settle when this module says they settle, and the interleaving
 * becomes a value a test can choose, record, print and replay.
 *
 * That is the whole trick, and it is worth being clear about what it costs.
 * This is not a general concurrency model checker: it explores the orderings
 * reachable by permuting *store operations*, not every ordering the engine
 * could produce. Two `await`s on something other than the store — a fetch, a
 * timer, another service's client — are invisible to it and settle in whatever
 * order the runtime picks. The honest statement of what `systematic` covers is
 * "every interleaving of the awaits the seam owns", and a subject that awaits
 * things outside the seam has interleavings this cannot reach.
 *
 * ---------------------------------------------------------------------------
 * Why the free runner still needs a budget
 * ---------------------------------------------------------------------------
 * Two of the bugs in `faults.ts` do not produce a wrong answer. They produce no
 * answer: a lock that is never released leaves every later operation waiting
 * forever. `await Promise.all(tasks)` on that subject never resolves, so a test
 * written the ordinary way does not fail — it hangs until the runner's timeout
 * kills the whole file, which is the least useful failure a suite can produce.
 *
 * {@link runFree} therefore never awaits the work directly. It awaits *event
 * loop turns*, up to a budget, and reports whether the tasks finished. A
 * deadlock comes back as `settled: false` in a few hundred microseconds instead
 * of as a five-second timeout with no attribution.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import type { Ledger, Mutex, Store } from './ledger.ts'

/** What a subject module has to export for the harness to drive it. */
export interface Subject {
  readonly createLedger: (store: Store) => Ledger
  readonly createMutex: () => Mutex
}

/** One store call, as the harness saw it. */
export interface Operation {
  readonly kind: 'read' | 'write'
  readonly account: string
  /** Index of the task the call was made from. */
  readonly task: number
}

/** A store call that is made to reject, to exercise an error path. */
export interface Failure {
  readonly kind: 'read' | 'write'
  readonly account: string
  /** Which matching call fails, counting from 1. */
  readonly occurrence: number
}

export interface TaskResult {
  readonly status: 'fulfilled' | 'rejected' | 'pending'
  readonly value?: unknown
}

/** Everything an invariant is allowed to look at. */
export interface Observation {
  readonly balances: Readonly<Record<string, number>>
  readonly operations: readonly Operation[]
  readonly results: readonly TaskResult[]
  /** False when the tasks were still waiting when the budget ran out. */
  readonly settled: boolean
  /** How many scheduling decisions the run took. Zero for a free run. */
  readonly decisions: number
}

/** A task is one concurrent caller of the ledger. */
export type Task = () => Promise<unknown>

export interface Plan {
  readonly opening: Readonly<Record<string, number>>
  readonly failure?: Failure
  readonly tasks: (ledger: Ledger) => readonly Task[]
}

/**
 * How many event-loop turns a free run waits before calling the work stuck.
 *
 * Generous on purpose: every store here settles on the microtask queue, so a
 * healthy run finishes on the first turn and the other turns are only spent by
 * a subject that is genuinely blocked. The cost of the budget being too large
 * is a few microseconds on the deadlocked runs; the cost of it being too small
 * is a false alarm on every run, which `detection.test.ts` would catch on the
 * control.
 */
const TURN_BUDGET = 20

/**
 * How many operations a scheduled run will settle before giving up.
 *
 * A bound rather than a timeout because a scheduled run has no wall clock in
 * it: the number of store operations a scenario can produce is a property of
 * the scenario, and one that loops forever is a bug in the subject.
 */
const STEP_BUDGET = 200

/** One turn of the event loop: every pending microtask runs before this settles. */
export const turn = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

/** One microtask. The unit of latency the jittered store is measured in. */
const tick = (): Promise<void> => Promise.resolve()

/**
 * Which task the code calling the store belongs to.
 *
 * `AsyncLocalStorage` and not a mutable "current task" variable, because with
 * several tasks in flight there is no single current anything — the context has
 * to follow each task across its own awaits, which is exactly what an async
 * context does. It is also the only attribution that stays correct when the
 * coalescing cache makes one task await a read another task issued: the read
 * belongs to whoever called the store, and that is the number the stampede
 * invariant counts.
 */
const currentTask = new AsyncLocalStorage<number>()

interface Recorder {
  readonly balances: Map<string, number>
  readonly operations: Operation[]
  /** Matching calls seen so far, for the failure injector. */
  readonly counts: Map<string, number>
}

const createRecorder = (opening: Readonly<Record<string, number>>): Recorder => ({
  balances: new Map(Object.entries(opening)),
  operations: [],
  counts: new Map(),
})

const failureKey = (kind: 'read' | 'write', account: string): string => `${kind}:${account}`

function record(
  recorder: Recorder,
  kind: 'read' | 'write',
  account: string,
  failure: Failure | undefined,
): void {
  recorder.operations.push({ kind, account, task: currentTask.getStore() ?? -1 })

  if (failure === undefined || failure.kind !== kind || failure.account !== account) {
    return
  }

  const key = failureKey(kind, account)
  const seen = (recorder.counts.get(key) ?? 0) + 1

  recorder.counts.set(key, seen)

  if (seen === failure.occurrence) {
    throw new Error(`store ${kind} of ${account} failed`)
  }
}

const balancesOf = (recorder: Recorder): Readonly<Record<string, number>> =>
  Object.fromEntries([...recorder.balances.entries()].sort(([a], [b]) => a.localeCompare(b)))

/**
 * A store whose calls settle on their own, after a number of microtasks.
 *
 * Microtasks rather than `setTimeout` for the reason `CLAUDE.md` gives: a suite
 * with sleeps in it is slow and still not deterministic. A draw of zero is not
 * "no delay" either — an `async` function that returns a value still hands
 * control back at the `await`, which is the smallest interleaving there is and
 * the one `concurrent` runs on.
 */
function freeStore(
  recorder: Recorder,
  latency: () => number,
  failure: Failure | undefined,
): Store {
  const wait = async (): Promise<void> => {
    for (let remaining = latency(); remaining > 0; remaining -= 1) {
      await tick()
    }
  }

  return {
    read: async (account: string): Promise<number | undefined> => {
      record(recorder, 'read', account, failure)
      await wait()

      return recorder.balances.get(account)
    },
    write: async (account: string, balance: number): Promise<void> => {
      record(recorder, 'write', account, failure)
      await wait()

      recorder.balances.set(account, balance)
    },
  }
}

async function drive(
  running: Promise<unknown>,
  recorder: Recorder,
  decisions: number,
  results: TaskResult[],
): Promise<Observation> {
  let finished = false

  void running.then(() => {
    finished = true
  })

  for (let spent = 0; !finished && spent < TURN_BUDGET; spent += 1) {
    await turn()
  }

  return {
    balances: balancesOf(recorder),
    operations: recorder.operations,
    results,
    settled: finished,
    decisions,
  }
}

function collect(tasks: readonly Task[]): {
  readonly results: TaskResult[]
  readonly wrapped: readonly Task[]
} {
  const results: TaskResult[] = tasks.map(() => ({ status: 'pending' }))

  const wrapped = tasks.map(
    (task, index): Task =>
      () =>
        currentTask.run(index, task).then(
          (value: unknown) => {
            results[index] = { status: 'fulfilled', value }

            return value
          },
          (error: unknown) => {
            results[index] = { status: 'rejected', value: String(error) }

            return undefined
          },
        ),
  )

  return { results, wrapped }
}

export type Shape = 'sequential' | 'overlapping'

/**
 * Runs a plan and lets the runtime decide the interleaving.
 *
 * `shape: 'sequential'` is the ordinary test — one operation at a time, each
 * awaited to completion. It is in the same runner as the concurrent shape
 * deliberately: the two differ in one line, so a difference in the matrix is a
 * difference in the interleaving and not in the harness.
 */
export async function runFree(
  subject: Subject,
  plan: Plan,
  shape: Shape,
  latency: () => number,
): Promise<Observation> {
  const recorder = createRecorder(plan.opening)
  const ledger = subject.createLedger(freeStore(recorder, latency, plan.failure))
  const { results, wrapped } = collect(plan.tasks(ledger))

  const running =
    shape === 'sequential'
      ? (async (): Promise<void> => {
          for (const task of wrapped) {
            await task()
          }
        })()
      : Promise.all(wrapped.map((task) => task()))

  return await drive(running, recorder, 0, results)
}

/** What a scheduled run was asked, and what it answered. */
export interface Schedule {
  /** The index chosen at each decision point. */
  readonly choices: readonly number[]
  /** How many operations were pending at each decision point. */
  readonly options: readonly number[]
}

/** Picks which of `count` pending operations settles next. */
export type Chooser = (count: number, step: number) => number

export interface ScheduledRun {
  readonly observation: Observation
  readonly schedule: Schedule
}

interface Suspended {
  readonly resume: () => void
}

/**
 * Runs a plan with every store operation suspended until the chooser picks it.
 *
 * The loop is the whole of the deterministic scheduler: start the tasks, let
 * the microtask queue go quiet, then repeatedly pick one of the operations
 * waiting to settle and let the queue go quiet again. Nothing else can move in
 * between, so the sequence of choices is a complete description of the run —
 * which is what makes a failure here reproducible from six integers rather than
 * from a seed and a promise about the machine.
 */
export async function runScheduled(
  subject: Subject,
  plan: Plan,
  choose: Chooser,
): Promise<ScheduledRun> {
  const recorder = createRecorder(plan.opening)
  const suspended: Suspended[] = []

  const hold = (): Promise<void> =>
    new Promise<void>((resume) => {
      suspended.push({ resume })
    })

  const store: Store = {
    read: async (account: string): Promise<number | undefined> => {
      record(recorder, 'read', account, plan.failure)
      await hold()

      return recorder.balances.get(account)
    },
    write: async (account: string, balance: number): Promise<void> => {
      record(recorder, 'write', account, plan.failure)
      await hold()

      recorder.balances.set(account, balance)
    },
  }

  const ledger = subject.createLedger(store)
  const { results, wrapped } = collect(plan.tasks(ledger))

  let finished = false

  void Promise.all(wrapped.map((task) => task())).then(() => {
    finished = true
  })

  const choices: number[] = []
  const options: number[] = []

  await turn()

  while (suspended.length > 0 && choices.length < STEP_BUDGET) {
    const count = suspended.length
    const index = Math.min(Math.max(choose(count, choices.length), 0), count - 1)

    options.push(count)
    choices.push(index)
    suspended.splice(index, 1)[0]?.resume()

    await turn()
  }

  return {
    observation: {
      balances: balancesOf(recorder),
      operations: recorder.operations,
      results,
      settled: finished,
      decisions: choices.length,
    },
    schedule: { choices, options },
  }
}

/** A chooser that replays a recorded schedule, then takes the first option. */
export const replaying =
  (choices: readonly number[]): Chooser =>
  (_count: number, step: number): number =>
    choices[step] ?? 0
