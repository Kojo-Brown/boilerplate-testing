/**
 * The seven scenarios every strategy runs, and the twelve invariants they are
 * judged by.
 *
 * ---------------------------------------------------------------------------
 * Why the invariants are shared
 * ---------------------------------------------------------------------------
 * The same argument `determinism/contract.ts` and `tdd/schools/orderContract.ts`
 * make. Six suites written freehand differ in a hundred ways at once, and the
 * one difference under study — how much of the interleaving space the strategy
 * reaches — vanishes into the noise. So the assertions are written once, here,
 * and a strategy is nothing but a way of running the same seven scenarios.
 *
 * That is a stronger constraint than it was for the determinism comparison,
 * where a probe could be *unable* to state a behaviour. Here every strategy can
 * state every invariant. What differs is whether it ever produces the run that
 * violates one, which is why the output of this directory is a detection
 * *rate* rather than a reach table.
 *
 * ---------------------------------------------------------------------------
 * Why some scenarios have one task
 * ---------------------------------------------------------------------------
 * `batch-settlement` and `read-after-write` start a single task, which looks
 * like a mistake in a directory about concurrency. It is the control for the
 * most common wrong belief about it: that concurrency is something that arrives
 * from outside, with a second request. `settle` applies a batch inside one call,
 * and a version of it that maps the batch through `Promise.all` races itself
 * with nobody else on the machine. A test that never starts two tasks catches
 * that one, and `detection.test.ts` reports exactly which faults have that
 * shape.
 *
 * ---------------------------------------------------------------------------
 * On what an invariant may look at
 * ---------------------------------------------------------------------------
 * Balances, the operations the store saw, and whether the tasks finished.
 * Deliberately not the *order* of operations in general: an assertion over the
 * full call sequence goes red for reorderings that broke nothing, which is the
 * failure mode `snapshot/README.md` measures for markup, and it would make
 * every strategy look brilliant at the cost of a suite nobody can refactor
 * under. The one ordering claim below, `waiters-are-served-in-arrival-order`,
 * is about the lock's documented fairness and reads only the first operation of
 * each task.
 */

import type { Instruction, Outcome } from './ledger.ts'
import type { Observation, Plan } from './runtime.ts'

export const SCENARIO_IDS = [
  'two-deposits',
  'race-to-empty',
  'batch-settlement',
  'shared-read',
  'read-after-write',
  'queued-writers',
  'late-arrival',
  'failing-store',
] as const

export type ScenarioId = (typeof SCENARIO_IDS)[number]

export interface Scenario {
  readonly id: ScenarioId
  /** What the scenario puts the ledger through, in one sentence. */
  readonly summary: string
  readonly plan: Plan
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'two-deposits',
    summary: 'Two deposits of 10 into an empty account at the same time.',
    plan: {
      opening: { a: 0 },
      tasks: (ledger) => [
        () => ledger.deposit('a', 10),
        () => ledger.deposit('a', 10),
      ],
    },
  },
  {
    id: 'race-to-empty',
    summary: 'Two transfers of the whole balance out of one account, to different accounts.',
    plan: {
      opening: { a: 100, b: 0, c: 0 },
      tasks: (ledger) => [
        () => ledger.transfer('a', 'b', 100),
        () => ledger.transfer('a', 'c', 100),
      ],
    },
  },
  {
    id: 'batch-settlement',
    summary: 'One batch of two instructions drawn on the same account, in a single call.',
    plan: {
      opening: { a: 100, b: 0 },
      tasks: (ledger) => [
        (): Promise<readonly Outcome[]> =>
          ledger.settle([
            { from: 'a', to: 'b', amount: 40 },
            { from: 'a', to: 'b', amount: 30 },
          ] satisfies readonly Instruction[]),
      ],
    },
  },
  {
    id: 'shared-read',
    summary: 'Three callers ask for the same balance while the first read is still outstanding.',
    plan: {
      opening: { a: 7 },
      tasks: (ledger) => [
        () => ledger.balance('a'),
        () => ledger.balance('a'),
        () => ledger.balance('a'),
      ],
    },
  },
  {
    id: 'read-after-write',
    summary: 'One caller reads a balance, deposits into it, and reads it again.',
    plan: {
      opening: { a: 7 },
      tasks: (ledger) => [
        async (): Promise<number> => {
          await ledger.balance('a')
          await ledger.deposit('a', 5)

          return await ledger.balance('a')
        },
      ],
    },
  },
  {
    id: 'queued-writers',
    summary: 'Three deposits arrive together, so two of them queue behind the lock.',
    plan: {
      opening: { a: 0 },
      tasks: (ledger) => [
        () => ledger.deposit('a', 1),
        () => ledger.deposit('a', 2),
        () => ledger.deposit('a', 4),
      ],
    },
  },
  {
    // The one scenario where a task reaches the lock *after* another has
    // already released it to a waiter. Nothing else here can produce that,
    // because tasks started together all queue before the first release — and
    // `MUTEX_RELEASE_ALWAYS_CLEARS_HELD` is invisible until somebody arrives
    // into a lock that was handed over rather than freed.
    id: 'late-arrival',
    summary: 'Two deposits start together and a third arrives after a read of another account.',
    plan: {
      opening: { a: 0, z: 0 },
      tasks: (ledger) => [
        () => ledger.deposit('a', 1),
        () => ledger.deposit('a', 2),
        async (): Promise<void> => {
          await ledger.balance('z')
          await ledger.deposit('a', 4)
        },
      ],
    },
  },
  {
    id: 'failing-store',
    summary: 'A transfer whose second write is rejected by the store, with a deposit behind it.',
    plan: {
      opening: { a: 100, b: 0 },
      failure: { kind: 'write', account: 'b', occurrence: 1 },
      tasks: (ledger) => [
        () => ledger.transfer('a', 'b', 50),
        () => ledger.deposit('a', 5),
      ],
    },
  },
]

export const scenarioNamed = (id: ScenarioId): Scenario => {
  const found = SCENARIOS.find((scenario) => scenario.id === id)

  if (found === undefined) {
    throw new Error(`no scenario named ${id}`)
  }

  return found
}

export const INVARIANT_IDS = [
  'every-task-settles',
  'both-deposits-land',
  'no-account-is-overdrawn',
  'money-is-conserved',
  'exactly-one-transfer-succeeds',
  'a-batch-applies-every-line',
  'a-batch-conserves-money',
  'overlapping-reads-hit-the-store-once',
  'every-reader-sees-the-stored-balance',
  'a-read-after-a-write-sees-the-write',
  'waiters-are-served-in-arrival-order',
  'every-queued-deposit-lands',
  'a-late-arrival-does-not-overwrite-the-holder',
] as const

export type InvariantId = (typeof INVARIANT_IDS)[number]

export interface Invariant {
  readonly id: InvariantId
  /** The claim, as a sentence about the system. */
  readonly claim: string
  /** The scenarios it is checked in. */
  readonly scenarios: readonly ScenarioId[]
  /**
   * Whether the claim says anything at all when the tasks cannot overlap.
   *
   * Exactly one invariant sets this, and it is not a loophole for a strategy
   * that finds the property inconvenient. Coalescing is a statement about calls
   * that are outstanding at the same time; with one call in flight at a time
   * there is nothing to coalesce, and asserting "the store saw one read" of a
   * suite that made three sequential calls would fail the *correct* subject.
   * A strategy with no overlap does not miss the stampede fault — it cannot
   * express the property being broken, which is worth reporting as a different
   * thing.
   */
  readonly needsOverlap?: true
  readonly holds: (observation: Observation) => boolean
}

const total = (observation: Observation): number =>
  Object.values(observation.balances).reduce((sum, balance) => sum + balance, 0)

const readsOf = (observation: Observation, account: string): number =>
  observation.operations.filter(
    (operation) => operation.kind === 'read' && operation.account === account,
  ).length

/** The tasks in the order they first reached the store. */
const arrivalOrder = (observation: Observation): readonly number[] => {
  const seen: number[] = []

  for (const operation of observation.operations) {
    if (!seen.includes(operation.task)) {
      seen.push(operation.task)
    }
  }

  return seen
}

const succeeded = (observation: Observation): number =>
  observation.results.filter(
    (result) => result.status === 'fulfilled' && (result.value as Outcome | undefined)?.ok === true,
  ).length

export const INVARIANTS: readonly Invariant[] = [
  {
    id: 'every-task-settles',
    claim: 'Every task finishes, one way or another, within the run budget.',
    scenarios: [...SCENARIO_IDS],
    holds: (observation) => observation.settled,
  },
  {
    id: 'both-deposits-land',
    claim: 'Two concurrent deposits of 10 leave the account holding 20.',
    scenarios: ['two-deposits'],
    holds: (observation) => observation.balances['a'] === 20,
  },
  {
    id: 'no-account-is-overdrawn',
    claim: 'No account is left holding less than nothing.',
    scenarios: ['race-to-empty'],
    holds: (observation) => Object.values(observation.balances).every((balance) => balance >= 0),
  },
  {
    id: 'money-is-conserved',
    claim: 'A transfer moves money; it never creates or destroys any.',
    scenarios: ['race-to-empty'],
    holds: (observation) => total(observation) === 100,
  },
  {
    id: 'exactly-one-transfer-succeeds',
    claim: 'Only one of two transfers drawing the whole balance can be accepted.',
    scenarios: ['race-to-empty'],
    holds: (observation) => succeeded(observation) === 1,
  },
  {
    id: 'a-batch-applies-every-line',
    claim: 'Every instruction in a batch is applied, on top of the ones before it.',
    scenarios: ['batch-settlement'],
    holds: (observation) => observation.balances['a'] === 30 && observation.balances['b'] === 70,
  },
  {
    id: 'a-batch-conserves-money',
    claim: 'A batch moves money between accounts without changing the total.',
    scenarios: ['batch-settlement'],
    holds: (observation) => total(observation) === 100,
  },
  {
    id: 'overlapping-reads-hit-the-store-once',
    claim: 'Callers who ask for a balance while a read is outstanding share that read.',
    scenarios: ['shared-read'],
    needsOverlap: true,
    holds: (observation) => readsOf(observation, 'a') === 1,
  },
  {
    id: 'every-reader-sees-the-stored-balance',
    claim: 'Every caller of a coalesced read gets the value in the store.',
    scenarios: ['shared-read'],
    holds: (observation) =>
      observation.results.every((result) => result.status === 'fulfilled' && result.value === 7),
  },
  {
    id: 'a-read-after-a-write-sees-the-write',
    claim: 'A balance read after a deposit reflects the deposit.',
    scenarios: ['read-after-write'],
    holds: (observation) =>
      observation.results.every((result) => result.status === 'fulfilled' && result.value === 12),
  },
  {
    id: 'waiters-are-served-in-arrival-order',
    claim: 'Tasks queued behind the lock enter it in the order they arrived.',
    scenarios: ['queued-writers'],
    holds: (observation) => {
      const order = arrivalOrder(observation)

      return order.every((task, index) => task === index)
    },
  },
  {
    id: 'every-queued-deposit-lands',
    claim: 'Three deposits queued behind one another all reach the store.',
    scenarios: ['queued-writers'],
    holds: (observation) => observation.balances['a'] === 7,
  },
  {
    id: 'a-late-arrival-does-not-overwrite-the-holder',
    claim: 'A deposit arriving mid-flight waits its turn instead of joining the current holder.',
    scenarios: ['late-arrival'],
    holds: (observation) => observation.balances['a'] === 7,
  },
]

export const invariantNamed = (id: InvariantId): Invariant => {
  const found = INVARIANTS.find((invariant) => invariant.id === id)

  if (found === undefined) {
    throw new Error(`no invariant named ${id}`)
  }

  return found
}

/**
 * The invariants checked in one scenario, in declaration order.
 *
 * `overlapping` is the one thing about the strategy that reaches in here.
 */
export const invariantsFor = (
  scenario: ScenarioId,
  overlapping: boolean,
): readonly Invariant[] =>
  INVARIANTS.filter(
    (invariant) =>
      invariant.scenarios.includes(scenario) && (overlapping || invariant.needsOverlap !== true),
  )

/** The invariants one observation of one scenario violates. */
export function violations(
  scenario: ScenarioId,
  observation: Observation,
  overlapping: boolean,
): readonly InvariantId[] {
  return invariantsFor(scenario, overlapping)
    .filter((invariant) => !invariant.holds(observation))
    .map((invariant) => invariant.id)
}
