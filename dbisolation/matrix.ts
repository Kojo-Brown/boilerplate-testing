/**
 * The experiment: run the whole suite under each strategy, once on the correct
 * subject and once per fault.
 *
 * ---------------------------------------------------------------------------
 * A control run is not optional here
 * ---------------------------------------------------------------------------
 * Two of these strategies fail some behaviours on a subject with nothing wrong
 * with it, and a matrix that only ran the faulted subjects would score those
 * cells as detections. That is not a small distortion — it is the difference
 * between "rollback isolation catches the missing notification" and the truth,
 * which is that under rollback isolation *every* run of that behaviour is red
 * and the suite has simply stopped being able to ask.
 *
 * So every (strategy, fault) pair is scored against that strategy's own control
 * run, and a fault counts as caught only when some behaviour was **green on the
 * correct subject and red with the fault**. A behaviour that was already red is
 * reported separately, as a false alarm, which is the honest name for a test
 * whose outcome no longer depends on the code.
 *
 * ---------------------------------------------------------------------------
 * One database per run, and why the runs can overlap
 * ---------------------------------------------------------------------------
 * Every (strategy, fault) pair gets a database of its own, created and dropped
 * by {@link runMatrix}. That is what lets the pairs run concurrently: there is
 * no shared state between two runs at all, not even a `LISTEN` channel, because
 * `NOTIFY` is scoped to a database. Concurrency is capped rather than unbounded
 * because the point of the cap is the CI runner's two cores and Postgres's
 * connection limit, not the correctness of the result — every cell is a
 * deterministic property of one database and nothing in this file measures
 * time.
 *
 * What is measured in time is `cost.ts`, and it is deliberately not computed
 * here: a per-test cost taken while seven other runs are hammering the same
 * server is a measurement of the harness.
 */

import type { Fault } from './faults.ts'
import { FAULTS, only } from './faults.ts'
import { BEHAVIOURS } from './behaviours.ts'
import type { Server, Strategy } from './strategies.ts'
import { connect, STRATEGIES } from './strategies.ts'
import type { BehaviourResult, StrategyReport, SuiteRun } from './scoring.ts'
import { scoreStrategy } from './scoring.ts'

export type { BehaviourResult, Detection, StrategyReport, SuiteRun } from './scoring.ts'

export interface Matrix {
  readonly runs: readonly SuiteRun[]
  readonly reports: readonly StrategyReport[]
}

/** Control plus one run per fault, in the order the README reports them. */
export const SUBJECTS: readonly (Fault | null)[] = [null, ...FAULTS]

/** How many suite runs the matrix performs. */
export const RUN_COUNT = STRATEGIES.length * SUBJECTS.length

const databaseName = (strategy: Strategy, subject: Fault | null, nonce: string): string =>
  `iso_${strategy.key}_${subject ?? 'control'}_${nonce}`.toLowerCase().replace(/[^a-z0-9_]/g, '_')

/** Run every behaviour once under one strategy against one subject. */
export async function runSuite(
  server: Server,
  strategy: Strategy,
  subject: Fault | null,
  nonce: string,
): Promise<SuiteRun> {
  const database = databaseName(strategy, subject, nonce)
  const admin = await connect(server.adminUri)

  await admin.client.query(`create database ${database}`)

  const faults = subject === null ? new Set<Fault>() : only(subject)
  const results: BehaviourResult[] = []

  try {
    const run = await strategy.open(server, database)

    try {
      for (const behaviour of BEHAVIOURS) {
        const env = await run.beginTest()

        try {
          await behaviour.run(env, faults)
          results.push({ behaviour: behaviour.key, red: false, detail: null })
        } catch (error) {
          results.push({
            behaviour: behaviour.key,
            red: true,
            detail: error instanceof Error ? error.message : String(error),
          })
        } finally {
          await run.endTest()
        }
      }
    } finally {
      await run.close()
    }
  } finally {
    await admin.client.query(`drop database if exists ${database} with (force)`)
    await admin.end()
  }

  return { strategy: strategy.key, fault: subject, results }
}

/**
 * Run the whole matrix.
 *
 * `concurrency` caps how many suite runs are in flight. Each holds two or three
 * Postgres connections, so the default sits well inside a stock
 * `max_connections` of 100 while keeping a two-core runner busy.
 */
export async function runMatrix(server: Server, nonce: string, concurrency = 4): Promise<Matrix> {
  const pending: { readonly strategy: Strategy; readonly subject: Fault | null }[] = STRATEGIES.flatMap((strategy) =>
    SUBJECTS.map((subject) => ({ strategy, subject })),
  )
  const runs: SuiteRun[] = []
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next

      next += 1

      const job = pending[index]

      if (job === undefined) {
        return
      }

      runs.push(await runSuite(server, job.strategy, job.subject, nonce))
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()))

  return { runs, reports: STRATEGIES.map((strategy) => scoreStrategy(strategy.key, runs)) }
}
