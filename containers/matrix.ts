/**
 * The experiment: run the same suite twice against one container, with one
 * isolation strategy between the two, and record what the second run does.
 *
 * ---------------------------------------------------------------------------
 * Two suites, not two hundred
 * ---------------------------------------------------------------------------
 * Every cell here is a boolean, and unlike `concurrency/` that is the right
 * shape: none of these outcomes is a race. A row left behind is left behind on
 * every run, a committed offset is committed on every run, and a strategy that
 * neutralises one neutralises it every time. Repeating the pair a hundred times
 * would produce a hundred identical answers and a slower gate.
 *
 * What the pair does need is a *first* suite that passes. Every cell records
 * both runs, and `residue.test.ts` asserts that the first is green everywhere —
 * a strategy whose first suite already fails is not isolating anything, it is
 * broken, and its clean-looking second column would be meaningless.
 *
 * ---------------------------------------------------------------------------
 * What a cell means
 * ---------------------------------------------------------------------------
 *   - `passed` — the behaviour held on the second suite. The strategy covered
 *     whatever that behaviour depends on.
 *   - `failed` — an assertion did not hold, and the message says which.
 *   - `timed-out` — no answer at all. This one is not a worse `failed`: a suite
 *     of these is a pipeline that hangs until the runner kills it, and a
 *     developer whose first move is to raise the timeout.
 */

import type { StartedStore } from './stores.ts'
import type { StoreName } from './images.ts'
import { KAFKA_STRATEGIES, POSTGRES_STRATEGIES, REDIS_STRATEGIES } from './isolation.ts'
import type { KafkaContext, PostgresContext, RedisContext } from './isolation.ts'
import { BehaviourTimeout, KAFKA_BEHAVIOURS, POSTGRES_BEHAVIOURS, REDIS_BEHAVIOURS } from './workload.ts'
import type { Behaviour } from './workload.ts'

export const OUTCOMES = ['passed', 'failed', 'timed-out'] as const

export type Outcome = (typeof OUTCOMES)[number]

/** One (strategy, behaviour) pair, run twice. */
export interface Cell {
  readonly store: StoreName
  readonly strategy: string
  readonly behaviour: string
  readonly firstSuite: Outcome
  readonly secondSuite: Outcome
  /** The failure message from the second suite, when there was one. */
  readonly detail: string | null
}

/** What one strategy's `beforeAll` cost, per suite. */
export interface EnterCost {
  readonly store: StoreName
  readonly strategy: string
  /** Milliseconds spent in `enter`, one entry per suite run. */
  readonly perRunMs: readonly number[]
}

export interface StoreMatrix {
  readonly store: StoreName
  readonly cells: readonly Cell[]
  readonly costs: readonly EnterCost[]
}

/**
 * A store's half of the experiment, with the two typed halves joined.
 *
 * The generic is what keeps `any` out of this file: a plan pairs strategies
 * that produce a context with behaviours that consume the same one, and the
 * three plans below are the only place the store's context type is named.
 */
interface Plan<Ctx> {
  readonly store: StoreName
  readonly strategies: readonly {
    readonly key: string
    enter(started: StartedStore, run: number, slot: number): Promise<Ctx>
  }[]
  readonly behaviours: readonly Behaviour<Ctx>[]
}

const POSTGRES_PLAN: Plan<PostgresContext> = {
  store: 'postgres',
  strategies: POSTGRES_STRATEGIES,
  behaviours: POSTGRES_BEHAVIOURS,
}

const REDIS_PLAN: Plan<RedisContext> = {
  store: 'redis',
  strategies: REDIS_STRATEGIES,
  behaviours: REDIS_BEHAVIOURS,
}

const KAFKA_PLAN: Plan<KafkaContext> = {
  store: 'kafka',
  strategies: KAFKA_STRATEGIES,
  behaviours: KAFKA_BEHAVIOURS,
}

/** How many suites each strategy runs. Two: one to leave state, one to find it. */
export const SUITES_PER_STRATEGY = 2

async function execute<Ctx>(
  behaviour: Behaviour<Ctx>,
  started: StartedStore,
  context: Ctx,
  run: number,
): Promise<{ readonly outcome: Outcome; readonly detail: string | null }> {
  try {
    await behaviour.run(started, context, run)

    return { outcome: 'passed', detail: null }
  } catch (error) {
    if (error instanceof BehaviourTimeout) {
      return { outcome: 'timed-out', detail: error.message }
    }

    return { outcome: 'failed', detail: error instanceof Error ? error.message : String(error) }
  }
}

async function runPlan<Ctx>(plan: Plan<Ctx>, started: StartedStore): Promise<StoreMatrix> {
  const cells: Cell[] = []
  const costs: EnterCost[] = []

  for (const [slot, strategy] of plan.strategies.entries()) {
    const outcomes = new Map<string, { outcome: Outcome; detail: string | null }[]>()
    const perRunMs: number[] = []

    for (let run = 1; run <= SUITES_PER_STRATEGY; run += 1) {
      const enteredAt = performance.now()
      const context = await strategy.enter(started, run, slot)

      perRunMs.push(Math.round(performance.now() - enteredAt))

      for (const behaviour of plan.behaviours) {
        const result = await execute(behaviour, started, context, run)

        outcomes.set(behaviour.key, [...(outcomes.get(behaviour.key) ?? []), result])
      }
    }

    for (const behaviour of plan.behaviours) {
      const [first, second] = outcomes.get(behaviour.key) ?? []

      if (first === undefined || second === undefined) {
        throw new Error(`${plan.store}/${strategy.key}/${behaviour.key} produced fewer than two runs`)
      }

      cells.push({
        store: plan.store,
        strategy: strategy.key,
        behaviour: behaviour.key,
        firstSuite: first.outcome,
        secondSuite: second.outcome,
        detail: second.detail,
      })
    }

    costs.push({ store: plan.store, strategy: strategy.key, perRunMs })
  }

  return { store: plan.store, cells, costs }
}

/** Run the experiment for one store against an already-usable container. */
export async function runStoreMatrix(store: StoreName, started: StartedStore): Promise<StoreMatrix> {
  if (store === 'postgres') {
    return runPlan(POSTGRES_PLAN, started)
  }

  if (store === 'redis') {
    return runPlan(REDIS_PLAN, started)
  }

  return runPlan(KAFKA_PLAN, started)
}

/** Look one cell up, for assertions that name a pair rather than an index. */
export function cellFor(matrix: StoreMatrix, strategy: string, behaviour: string): Cell {
  const cell = matrix.cells.find((candidate) => candidate.strategy === strategy && candidate.behaviour === behaviour)

  if (cell === undefined) {
    throw new Error(`No cell for ${matrix.store}/${strategy}/${behaviour}`)
  }

  return cell
}

/** The strategies whose second suite was entirely green. */
export function completeStrategies(matrix: StoreMatrix): readonly string[] {
  const byStrategy = new Map<string, boolean>()

  for (const cell of matrix.cells) {
    byStrategy.set(cell.strategy, (byStrategy.get(cell.strategy) ?? true) && cell.secondSuite === 'passed')
  }

  return [...byStrategy].filter(([, complete]) => complete).map(([strategy]) => strategy)
}
